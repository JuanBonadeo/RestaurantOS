"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { getCajasForBusiness, getPaymentMethodConfigs } from "@/lib/caja/queries";
import type { Caja, PaymentMethod, PaymentMethodConfig } from "@/lib/caja/types";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCancelItem } from "@/lib/permissions/can";
import { createPreference } from "@/lib/payments/mercadopago";
import { formatCurrency } from "@/lib/currency";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { isCashShortPayment, sumActiveItems } from "./totals";
import type { OrderSplit, Payment } from "./types";

type GenericClient = SupabaseClient;

// ── Helpers ────────────────────────────────────────────────────

function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const proto = rootDomain.includes("localhost") ? "http" : "https";
  return `${proto}://${rootDomain}`;
}

type LoadedOrder = {
  id: string;
  business_id: string;
  order_number: number;
  table_id: string | null;
  lifecycle_status: "open" | "closed" | "cancelled";
  status: string;
  total_cents: number;
  total_paid_cents: number;
  tip_cents: number;
  discount_cents: number;
};

async function loadOrder(
  service: GenericClient,
  orderId: string,
  businessId: string,
): Promise<LoadedOrder | null> {
  const { data } = await service
    .from("orders")
    .select(
      "id, business_id, order_number, table_id, lifecycle_status, status, total_cents, total_paid_cents, tip_cents, discount_cents",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;
  const row = data as LoadedOrder;
  if (row.business_id !== businessId) return null;
  return row;
}

async function loadSplit(
  service: GenericClient,
  splitId: string,
  businessId: string,
): Promise<OrderSplit | null> {
  const { data } = await service
    .from("order_splits")
    .select(
      "id, order_id, business_id, split_mode, split_index, expected_amount_cents, paid_amount_cents, status, label",
    )
    .eq("id", splitId)
    .maybeSingle();
  if (!data) return null;
  const row = data as OrderSplit;
  if (row.business_id !== businessId) return null;
  return row;
}

async function loadCaja(
  service: GenericClient,
  cajaId: string,
  businessId: string,
): Promise<{ id: string; is_active: boolean } | null> {
  const { data } = await service
    .from("cajas")
    .select("id, business_id, is_active")
    .eq("id", cajaId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; business_id: string; is_active: boolean };
  if (row.business_id !== businessId) return null;
  return { id: row.id, is_active: row.is_active };
}

/**
 * Atribuye la propina al mozo que atendió: derivado server-side desde
 * order_items.loaded_by del último item activo cargado en la order
 * (R10 de CU-03). Fallback: mozo_id de la mesa asociada a la order.
 */
async function deriveAttributedMozo(
  service: GenericClient,
  orderId: string,
): Promise<string | null> {
  // 1. Intentar loaded_by del último item activo.
  const { data } = await service
    .from("order_items")
    .select("loaded_by, cancelled_at")
    .eq("order_id", orderId)
    .not("loaded_by", "is", null)
    .is("cancelled_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) {
    const mozoId = (data as { loaded_by: string | null }).loaded_by;
    if (mozoId) return mozoId;
  }

  // 2. Fallback: mozo_id de la mesa de la order.
  const { data: orderRow } = await service
    .from("orders")
    .select("table_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!orderRow?.table_id) return null;
  const { data: tableRow } = await service
    .from("tables")
    .select("mozo_id")
    .eq("id", (orderRow as { table_id: string }).table_id)
    .maybeSingle();
  return (tableRow as { mozo_id: string | null } | null)?.mozo_id ?? null;
}

/**
 * Si todos los splits no cancelados están paid (o si no hay splits y
 * total_paid_cents >= total_cents), cierra la order y transiciona la mesa.
 */
export async function closeOrderIfFullyPaid(
  service: GenericClient,
  orderId: string,
  businessSlug: string,
): Promise<{ orderClosed: boolean }> {
  const business = await getBusiness(businessSlug);
  if (!business) return { orderClosed: false };

  const order = await loadOrder(service, orderId, business.id);
  if (!order) return { orderClosed: false };
  if (order.lifecycle_status !== "open") return { orderClosed: false };

  // Suma de payments paid del order.
  const { data: paid } = await service
    .from("payments")
    .select("amount_cents")
    .eq("order_id", orderId)
    .eq("payment_status", "paid");
  const total_paid = (paid ?? []).reduce(
    (acc, p) => acc + (p as { amount_cents: number }).amount_cents,
    0,
  );

  // Splits no cancelados.
  const { data: splits } = await service
    .from("order_splits")
    .select("id, expected_amount_cents, paid_amount_cents, status")
    .eq("order_id", orderId);
  const splitsActivos = (splits ?? []).filter(
    (s) => (s as { status: string }).status !== "cancelled",
  );

  let fullyPaid: boolean;
  if (splitsActivos.length === 0) {
    // Sin splits: total_paid debe cubrir total_cents.
    fullyPaid = total_paid >= order.total_cents && order.total_cents > 0;
  } else {
    fullyPaid = splitsActivos.every(
      (s) =>
        (s as { paid_amount_cents: number }).paid_amount_cents >=
        (s as { expected_amount_cents: number }).expected_amount_cents,
    );
  }

  if (!fullyPaid) return { orderClosed: false };

  // `payment_status` también: hasta ahora sólo lo escribían el webhook de MP y
  // `reconcile`, así que un delivery cobrado en efectivo por el encargado
  // quedaba `pending` para siempre y el board lo seguía mostrando como impago.
  // Es la misma verdad que `lifecycle_status: closed` — la orden está saldada.
  await service
    .from("orders")
    .update({
      lifecycle_status: "closed",
      closed_at: new Date().toISOString(),
      total_paid_cents: total_paid,
      payment_status: "paid",
      // spec 091 — el eje de producción también llega a su estado terminal.
      // Ninguna orden de salón lo tocaba nunca: nacían `pending` y se cobraban
      // `pending`, así que el dashboard las contaba como «pedidos activos» —el
      // dueño abría el panel un martes a las 4 con el local vacío y leía 47— y
      // en el historial cada mesa cobrada aparecía con badge «Pendiente».
      status: "delivered",
    })
    .eq("id", orderId);

  // Post-cobro: mesa va directo a `libre`. Eliminamos la transición
  // intermedia `limpiar` con la simplificación de estados (migración 0038).
  //
  // La mesa a liberar es la que ACTUALMENTE es dueña de la orden
  // (tables.current_order_id = orderId), NO order.table_id: si un traslado
  // concurrente (spec 048) movió la orden a otra mesa entre este loadOrder y
  // acá, order.table_id quedó stale y liberaríamos la mesa equivocada, dejando
  // la mesa destino "ocupada" apuntando a una orden ya cerrada (mesa fantasma).
  // Keyear por current_order_id es idempotente y sigue a la orden. Fallback a
  // order.table_id solo si nadie la referencia por current_order_id — eso
  // implica que NO hubo traslado (un move siempre setea current_order_id en el
  // destino), así que en ese caso order.table_id no está stale.
  const { data: ownerRow } = await service
    .from("tables")
    .select("id, operational_status")
    .eq("current_order_id", orderId)
    .maybeSingle();
  const ownerTableId =
    (ownerRow as { id: string } | null)?.id ?? order.table_id;

  if (ownerTableId) {
    const fromStatus =
      (ownerRow as { operational_status: string } | null)?.operational_status ??
      null;

    // mozo_id se preserva: la asignación es fija hasta que el encargado la
    // cambie manualmente desde "Distribuir mozos". Cobrar una mesa no la
    // saca del mozo que la atiende.
    await service
      .from("tables")
      .update({
        operational_status: "libre",
        opened_at: null,
        current_order_id: null,
      })
      .eq("id", ownerTableId);

    await service.from("tables_audit_log").insert({
      table_id: ownerTableId,
      business_id: business.id,
      kind: "status",
      from_value: fromStatus,
      to_value: "libre",
      by_user_id: null,
      reason: `cobro completo order ${order.order_number}`,
    });

    // La reserva seated asociada (si la hubo) pasa a completed: el cliente
    // consumió y pagó. Si no, queda pegada a la mesa libre (orphan).
    const { error: resErr } = await service
      .from("reservations")
      .update({ status: "completed" })
      .eq("table_id", ownerTableId)
      .eq("business_id", business.id)
      .eq("status", "seated");
    if (resErr) console.error("cobro: completar reserva seated", resErr);
  }

  return { orderClosed: true };
}

// ── Iniciar cobro ─────────────────────────────────────────────

export type IniciarCobroResult = {
  order: LoadedOrder;
  splits: OrderSplit[];
  hasImplicitSplit: boolean;
  cajas: Caja[];
  methodConfigs: PaymentMethodConfig[];
};

export async function iniciarCobro(
  orderId: string,
  businessSlug: string,
): Promise<ActionResult<IniciarCobroResult>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const order = await loadOrder(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  // spec 092 · H-41 — el módulo de cobro guardaba SÓLO por `lifecycle_status`
  // y ni siquiera traía `status`. Como los pedidos online quedaban `open`
  // eternamente (H-40), esa guarda no protegía nada en ese canal: el encargado
  // tenía abierto «Cobrar pedido #312» para pasar el efectivo del cadete, el
  // cliente cancelaba desde la app en ese momento, y el pago entraba a la caja
  // con factura fiscal contra un pedido cancelado.
  if (order.status === "cancelled") {
    return actionError("El pedido está cancelado — no se puede cobrar.");
  }
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  const [cajas, methodConfigs] = await Promise.all([
    getCajasForBusiness(business.id),
    getPaymentMethodConfigs(business.id),
  ]);
  if (cajas.length === 0) {
    return actionError("No hay caja configurada. Pedile al admin que cree una.");
  }

  const { data: splitsData } = await service
    .from("order_splits")
    .select(
      "id, order_id, business_id, split_mode, split_index, expected_amount_cents, paid_amount_cents, status, label",
    )
    .eq("order_id", orderId)
    .order("split_index", { ascending: true });
  const splits = (splitsData ?? []) as OrderSplit[];

  // Si no hay splits, devolvemos uno virtual con expected = total.
  const hasImplicitSplit = splits.length === 0;

  return actionOk({
    order,
    splits,
    hasImplicitSplit,
    cajas,
    methodConfigs,
  });
}

// ── Registrar pago ────────────────────────────────────────────

export type RegistrarPagoInput = {
  orderId: string;
  splitId: string | null;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  caja_id: string;
  last_four?: string;
  card_brand?: "visa" | "mastercard" | "amex" | "otro";
  notes?: string;
  adjustment_percent?: number;
  adjustment_cents?: number;
  slug: string;
  /** Idempotency key por intento de cobro (issue #58). Dedup en la RPC. */
  requestId?: string;
};

/**
 * Mapea los errores que levanta la RPC `registrar_pago_tx` (raise exception en
 * plpgsql → texto crudo en error.message) a mensajes de usuario.
 */
function mapRegistrarPagoError(message: string): string {
  if (message.includes("SPLIT_ALREADY_PAID")) return "Este split ya fue cobrado.";
  if (message.includes("ORDER_ALREADY_PAID")) return "La orden ya fue cobrada.";
  if (message.includes("ORDER_CLOSED")) return "La orden ya está cerrada.";
  if (message.includes("SPLIT_CANCELLED")) return "El split fue cancelado.";
  if (message.includes("SPLIT_ORDER_MISMATCH"))
    return "El split no corresponde a esta orden.";
  if (message.includes("ORDER_NOT_FOUND")) return "Orden no encontrada.";
  if (message.includes("SPLIT_NOT_FOUND")) return "Split no encontrado.";
  if (message.includes("payments_business_request_uidx"))
    return "El pago ya se estaba registrando. Refrescá para ver el estado.";
  return `No se pudo registrar el pago: ${message}`;
}

export async function registrarPago(
  input: RegistrarPagoInput,
): Promise<ActionResult<{ payment: Payment; splitDone: boolean; orderClosed: boolean }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (input.amount_cents < 0) return actionError("El monto no puede ser negativo.");
  if (input.tip_cents < 0) return actionError("La propina no puede ser negativa.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Cross-tenant: order, split (si hay), caja.
  const order = await loadOrder(service, input.orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  // spec 092 · H-41 — el módulo de cobro guardaba SÓLO por `lifecycle_status`
  // y ni siquiera traía `status`. Como los pedidos online quedaban `open`
  // eternamente (H-40), esa guarda no protegía nada en ese canal: el encargado
  // tenía abierto «Cobrar pedido #312» para pasar el efectivo del cadete, el
  // cliente cancelaba desde la app en ese momento, y el pago entraba a la caja
  // con factura fiscal contra un pedido cancelado.
  if (order.status === "cancelled") {
    return actionError("El pedido está cancelado — no se puede cobrar.");
  }
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  let split: OrderSplit | null = null;
  if (input.splitId) {
    split = await loadSplit(service, input.splitId, business.id);
    if (!split) return actionError("Split no encontrado.");
    if (split.order_id !== order.id) {
      return actionError("El split no corresponde a esta orden.");
    }
    if (split.status === "cancelled") {
      return actionError("El split fue cancelado.");
    }
  }

  const caja = await loadCaja(service, input.caja_id, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) return actionError("La caja está inactiva.");

  // Validación específica por método.
  if (input.method === "card_manual") {
    if (input.last_four && input.last_four.length !== 4) {
      return actionError("Los últimos 4 dígitos deben ser 4.");
    }
  }
  if (
    (input.method === "other" || input.method === "transfer") &&
    (!input.notes || input.notes.trim() === "")
  ) {
    return actionError(
      input.method === "transfer"
        ? "Para transferencia, anotá el alias o referencia."
        : 'Para método "otro", se requiere una nota.',
    );
  }

  if (input.method === "mp_link" || input.method === "mp_qr") {
    return actionError(
      "Para MP, usá iniciarPagoMp para generar la preference primero.",
    );
  }

  // En efectivo no se cobra de menos: si falta plata, el cobro no está cerrado
  // y la caja quedaría diciendo que entró algo que no alcanzó. De más sí (es
  // vuelto). Para partir un pago está dividir la cuenta por monto.
  const remainingCents = split
    ? split.expected_amount_cents - split.paid_amount_cents
    : order.total_cents - order.total_paid_cents;
  if (
    isCashShortPayment({
      method: input.method,
      amount_cents: input.amount_cents,
      adjustment_cents: input.adjustment_cents ?? 0,
      remaining_cents: remainingCents,
    })
  ) {
    return actionError(
      `En efectivo no se puede cobrar menos de lo que falta (${formatCurrency(remainingCents)}). Si van a pagar en partes, dividí la cuenta por monto.`,
    );
  }

  const attributed = await deriveAttributedMozo(service, order.id);

  // El registro del pago va por una RPC transaccional (migración 0007): lock
  // FOR UPDATE de la orden/split + guarda anti-duplicado (split/orden ya
  // saldada) + insert idempotente por request_id. Cierra de raíz el
  // doble-submit que inflaba la caja (issue #58 / spec 42). En este path el
  // pago siempre entra 'paid' (cash/card_manual/transfer/other; MP va aparte).
  const { data: rpcData, error } = await service.rpc("registrar_pago_tx", {
    p_order_id: order.id,
    p_business_id: business.id,
    p_split_id: input.splitId,
    p_caja_id: input.caja_id,
    p_operated_by: ctx.userId,
    p_attributed_mozo_id: attributed,
    p_method: input.method,
    p_amount_cents: input.amount_cents,
    p_tip_cents: input.tip_cents,
    p_last_four: input.last_four ?? null,
    p_card_brand: input.card_brand ?? null,
    p_notes: input.notes?.trim() || null,
    p_adjustment_percent: input.adjustment_percent ?? 0,
    p_adjustment_cents: input.adjustment_cents ?? 0,
    p_request_id: input.requestId ?? null,
  });

  if (error) return actionError(mapRegistrarPagoError(error.message));

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { payment: Payment; split_done: boolean; fully_paid: boolean; idempotent: boolean }
    | undefined;
  if (!row) return actionError("No se pudo registrar el pago.");

  const payment = row.payment;
  const splitDone = row.split_done;

  // El cierre de la orden + liberación de mesa se mantienen en TS
  // (closeOrderIfFullyPaid, guardado por lifecycle_status e idempotente): no se
  // duplica esa lógica en SQL. En un retry idempotente la orden ya está cerrada.
  let orderClosed = false;
  if (row.fully_paid && !row.idempotent) {
    const r = await closeOrderIfFullyPaid(service, order.id, input.slug);
    orderClosed = r.orderClosed;
  }

  revalidatePath(`/${input.slug}/mozo`);
  revalidatePath(`/${input.slug}/admin/operacion`);
  return actionOk({ payment, splitDone, orderClosed });
}

// ── Iniciar pago MP ───────────────────────────────────────────

export type IniciarPagoMpInput = {
  orderId: string;
  splitId: string | null;
  method: "mp_link" | "mp_qr";
  amount_cents: number;
  tip_cents: number;
  caja_id: string;
  slug: string;
};

export async function iniciarPagoMp(
  input: IniciarPagoMpInput,
): Promise<ActionResult<{ paymentId: string; initPoint: string; preferenceId: string }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (input.amount_cents <= 0) return actionError("El monto debe ser mayor a 0.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: bizRow } = await service
    .from("businesses")
    .select("id, slug, mp_access_token, mp_accepts_payments")
    .eq("id", business.id)
    .single();
  if (!bizRow?.mp_access_token || !bizRow.mp_accepts_payments) {
    return actionError("MP no está configurado o habilitado en este negocio.");
  }

  const order = await loadOrder(service, input.orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");
  // spec 092 · H-41 — el módulo de cobro guardaba SÓLO por `lifecycle_status`
  // y ni siquiera traía `status`. Como los pedidos online quedaban `open`
  // eternamente (H-40), esa guarda no protegía nada en ese canal: el encargado
  // tenía abierto «Cobrar pedido #312» para pasar el efectivo del cadete, el
  // cliente cancelaba desde la app en ese momento, y el pago entraba a la caja
  // con factura fiscal contra un pedido cancelado.
  if (order.status === "cancelled") {
    return actionError("El pedido está cancelado — no se puede cobrar.");
  }
  if (order.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }

  if (input.splitId) {
    const split = await loadSplit(service, input.splitId, business.id);
    if (!split) return actionError("Split no encontrado.");
    if (split.order_id !== order.id) return actionError("El split no corresponde a esta orden.");
    if (split.status === "cancelled") return actionError("El split fue cancelado.");
  }

  const cajaForMp = await loadCaja(service, input.caja_id, business.id);
  if (!cajaForMp || !cajaForMp.is_active) {
    return actionError("Caja inválida o inactiva.");
  }

  // Insert payment row pendiente para que el webhook pueda asociar el id.
  const attributed = await deriveAttributedMozo(service, order.id);
  const { data: inserted, error: insErr } = await service
    .from("payments")
    .insert({
      order_id: order.id,
      business_id: business.id,
      split_id: input.splitId,
      caja_id: input.caja_id,
      operated_by: ctx.userId,
      attributed_mozo_id: attributed,
      method: input.method,
      amount_cents: input.amount_cents,
      tip_cents: input.tip_cents,
      payment_status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return actionError(`No se pudo iniciar el pago MP: ${insErr?.message}`);
  }
  const paymentId = (inserted as { id: string }).id;

  let pref;
  try {
    const totalPesos = (input.amount_cents + input.tip_cents) / 100;
    pref = await createPreference({
      accessToken: bizRow.mp_access_token,
      siteUrl: getSiteUrl(),
      businessId: business.id,
      businessSlug: bizRow.slug as string,
      orderId: paymentId, // external_reference = paymentRowId para que el webhook lo identifique
      orderNumber: order.order_number,
      items: [
        {
          id: paymentId,
          title: `Mesa orden #${order.order_number}`,
          quantity: 1,
          unit_price: totalPesos,
        },
      ],
    });
  } catch (e) {
    // Rollback del payment row.
    await service.from("payments").delete().eq("id", paymentId);
    return actionError(`MP rechazó la creación: ${(e as Error).message}`);
  }

  await service
    .from("payments")
    .update({ mp_preference_id: pref.preferenceId })
    .eq("id", paymentId);

  revalidatePath(`/${input.slug}/mozo`);
  return actionOk({
    paymentId,
    initPoint: pref.initPoint,
    preferenceId: pref.preferenceId,
  });
}

// ── Forzar pago (admin/encargado) ─────────────────────────────

export async function forzarPago(
  paymentId: string,
  motivo: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo encargado o admin pueden forzar un pago.");
  }
  if (!motivo || motivo.trim() === "") {
    return actionError("Forzar el pago requiere un motivo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: paymentRow } = await service
    .from("payments")
    .select(
      "id, order_id, business_id, split_id, amount_cents, payment_status, notes",
    )
    .eq("id", paymentId)
    .maybeSingle();
  if (!paymentRow || (paymentRow as { business_id: string }).business_id !== business.id) {
    return actionError("Pago no encontrado.");
  }
  const p = paymentRow as {
    id: string;
    order_id: string;
    split_id: string | null;
    amount_cents: number;
    payment_status: string;
    notes: string | null;
  };
  if (p.payment_status === "paid") {
    return actionError("El pago ya está marcado como cobrado.");
  }

  await service
    .from("payments")
    .update({
      payment_status: "paid",
      notes: `${p.notes ?? ""}\n[forzado: ${motivo.trim()}]`.trim(),
    })
    .eq("id", paymentId);

  if (p.split_id) {
    const split = await loadSplit(service, p.split_id, business.id);
    if (split) {
      const newPaid = split.paid_amount_cents + p.amount_cents;
      const splitDone = newPaid >= split.expected_amount_cents;
      await service
        .from("order_splits")
        .update({
          paid_amount_cents: newPaid,
          status: splitDone ? "paid" : "pending",
        })
        .eq("id", split.id);
    }
  }

  await closeOrderIfFullyPaid(service, p.order_id, businessSlug);
  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk(undefined);
}

// ── Cancelar split ────────────────────────────────────────────

export async function cancelarSplit(
  splitId: string,
  motivo: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo encargado o admin pueden cancelar un split.");
  }
  if (!motivo || motivo.trim() === "") {
    return actionError("Cancelar split requiere un motivo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const split = await loadSplit(service, splitId, business.id);
  if (!split) return actionError("Split no encontrado.");
  if (split.status === "cancelled") {
    return actionError("El split ya fue cancelado.");
  }
  if (split.paid_amount_cents > 0) {
    return actionError(
      "El split tiene pagos. Anulá los pagos primero o anulá el cobro completo.",
    );
  }

  await service
    .from("order_splits")
    .update({ status: "cancelled", label: `cancelado: ${motivo.trim()}` })
    .eq("id", splitId);

  // Redistribuir expected entre splits activos restantes.
  const { data: activos } = await service
    .from("order_splits")
    .select("id, expected_amount_cents, status")
    .eq("order_id", split.order_id)
    .neq("status", "cancelled");

  const totalActivo = (activos ?? []).reduce(
    (acc, s) =>
      acc + (s as { expected_amount_cents: number }).expected_amount_cents,
    0,
  );
  // Solo redistribuimos si quedan splits activos y el cancelado tenía monto.
  if ((activos ?? []).length > 0 && split.expected_amount_cents > 0) {
    const extraTotal = split.expected_amount_cents;
    const N = (activos ?? []).length;
    const base = Math.floor(extraTotal / N);
    const remainder = extraTotal - base * N;
    for (let i = 0; i < N; i++) {
      const s = (activos ?? [])[i] as {
        id: string;
        expected_amount_cents: number;
      };
      const add = base + (i === 0 ? remainder : 0);
      await service
        .from("order_splits")
        .update({ expected_amount_cents: s.expected_amount_cents + add })
        .eq("id", s.id);
    }
  } else if ((activos ?? []).length === 0) {
    // No queda nada activo: cerrar la order vacía si total = 0.
    void totalActivo;
  }

  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk(undefined);
}

// ── Anular cobro completo ─────────────────────────────────────

export async function anularCobro(
  orderId: string,
  motivo: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canCancelItem(ctx.role)) {
    return actionError("Solo encargado o admin pueden anular cobros.");
  }
  if (!motivo || motivo.trim() === "") {
    return actionError("Anular cobro requiere un motivo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const order = await loadOrder(service, orderId, business.id);
  if (!order) return actionError("Orden no encontrada.");

  // spec 092 · H-08 — **reabrir primero, refundar después.**
  //
  // El orden estaba al revés: se refundaban los pagos, se borraban los
  // pendientes, se reseteaban los splits, y recién al final se reabría la orden
  // — sin `.select()` y **sin capturar el error**. Si alguien había sentado
  // gente nueva en esa mesa, ese UPDATE violaba el índice único parcial
  // `orders_one_open_per_table` y no hacía nada, pero la action devolvía
  // `actionOk` igual. Resultado: «Cobro anulado», la cuenta seguía cerrada **y
  // paga**, con todos sus pagos reembolsados. La plata desaparecía del arqueo y
  // ya no se podía re-cobrar (`iniciarCobro` → «La orden ya está cerrada»).
  //
  // Reabriendo primero, si la reapertura falla no se toca un solo peso.
  if (order.lifecycle_status === "closed") {
    const { data: reopened, error: reopenErr } = await service
      .from("orders")
      .update({
        lifecycle_status: "open",
        closed_at: null,
        total_paid_cents: 0,
        // La contracara de `closeOrderIfFullyPaid`: si la orden vuelve a estar
        // abierta, no está paga.
        payment_status: "pending",
        // spec 091 — y vuelve al eje de producción que tenía antes de cobrarse.
        status: "preparing",
      })
      .eq("id", orderId)
      .select("id");
    if (reopenErr || ((reopened ?? []) as { id: string }[]).length === 0) {
      console.error("anularCobro · reapertura", reopenErr);
      return actionError(
        "No pudimos reabrir la cuenta: la mesa ya tiene otra cuenta abierta. Anulá esa primero.",
      );
    }
  }

  // Marcar payments paid como refunded (no borrar para auditoría).
  await service
    .from("payments")
    .update({
      payment_status: "refunded",
      refunded_at: new Date().toISOString(),
      refunded_reason: motivo.trim(),
    })
    .eq("order_id", orderId)
    .eq("payment_status", "paid");

  // Borrar payments pending (MP en curso, etc).
  await service
    .from("payments")
    .delete()
    .eq("order_id", orderId)
    .eq("payment_status", "pending");

  // Reset splits — pero NO resucitar los cancelados (spec 36 · R-C4). Un split
  // ya `cancelled` (via cancelarSplit, que redistribuyó su expected a los
  // activos) volvía a `pending` con su expected intacto → total esperado
  // inflado y la order no cerraba al re-cobrar.
  await service
    .from("order_splits")
    .update({ paid_amount_cents: 0, status: "pending" })
    .eq("order_id", orderId)
    .neq("status", "cancelled");

  // (La reapertura de la orden se movió arriba — ver H-08.)

  // Volver mesa a `pidio_cuenta` si estaba `libre` tras el cobro (queremos
  // que el flow vuelva al estado pre-cobro). También reabrimos la order y
  // re-marcamos `bill_requested_at`.
  if (order.table_id) {
    const { data: tableRow } = await service
      .from("tables")
      .select("id, operational_status")
      .eq("id", order.table_id)
      .single();
    const fromStatus = tableRow?.operational_status as string;
    if (fromStatus === "libre") {
      await service
        .from("tables")
        .update({
          operational_status: "pidio_cuenta",
          opened_at: new Date().toISOString(),
        })
        .eq("id", order.table_id);
      await service
        .from("orders")
        .update({ bill_requested_at: new Date().toISOString() })
        .eq("id", orderId);
      await service.from("tables_audit_log").insert({
        table_id: order.table_id,
        business_id: business.id,
        kind: "status",
        from_value: fromStatus,
        to_value: "pidio_cuenta",
        by_user_id: ctx.userId,
        reason: `anular cobro: ${motivo.trim()}`,
      });
    }
  }

  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk(undefined);
}

// Suprimir warning de import sin uso si el helper llega a no llamarse.
void sumActiveItems;
