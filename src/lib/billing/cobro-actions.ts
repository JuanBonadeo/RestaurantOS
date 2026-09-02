"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { getCajasForBusiness, getPaymentMethodConfigs } from "@/lib/caja/queries";
import type { Caja, PaymentMethod, PaymentMethodConfig } from "@/lib/caja/types";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { bloqueoPorPeriodoCerrado } from "@/lib/caja/periodo-cerrado";
import { canCancelItem } from "@/lib/permissions/can";
import { createPreference } from "@/lib/payments/mercadopago";
import { formatCurrency } from "@/lib/currency";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { elegirMozoAtribuido } from "@/lib/billing/atribucion-mozo";
import { getBusiness } from "@/lib/tenant";

import { formatInvoiceNumber, tipoLabel } from "@/lib/afip/format";
import type { TipoComprobante } from "@/lib/afip/types";

import { restitucionMesa, type OperationalStatus } from "./restitucion-mesa";
import { cashCharge, isCashShortPayment, sumActiveItems } from "./totals";
import type { OrderSplit, Payment } from "./types";

type GenericClient = SupabaseClient;

/** Lo mínimo de un comprobante para nombrarlo en un mensaje de error. */
type InvoiceRef = {
  tipo_comprobante: TipoComprobante;
  punto_venta: number;
  numero: number | null;
};

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

/**
 * Lo que `loadOrder` trae de más y sólo usa la anulación (spec 100). Va aparte
 * porque `LoadedOrder` es el contrato público de `IniciarCobroResult`, que
 * `cobro-panel-data.ts` arma a mano desde la cuenta ya cargada.
 */
type LoadedOrderFull = LoadedOrder & {
  /** La mesa se restituye con estos dos, no con `now()`. */
  created_at: string;
  bill_requested_at: string | null;
  /** Momento del cobro que se anula: ancla para encontrar la reserva. */
  closed_at: string | null;
};

async function loadOrder(
  service: GenericClient,
  orderId: string,
  businessId: string,
): Promise<LoadedOrderFull | null> {
  const { data } = await service
    .from("orders")
    .select(
      "id, business_id, order_number, table_id, lifecycle_status, status, total_cents, total_paid_cents, tip_cents, discount_cents, created_at, bill_requested_at, closed_at",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!data) return null;
  const row = data as LoadedOrderFull;
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

async function deriveAttributedMozo(
  service: GenericClient,
  orderId: string,
): Promise<string | null> {
  // 1. El mozo de la mesa de la order — la fuente de verdad de la atribución.
  const { data: orderRow } = await service
    .from("orders")
    .select("table_id")
    .eq("id", orderId)
    .maybeSingle();
  let mesaMozoId: string | null = null;
  const tableId = (orderRow as { table_id: string | null } | null)?.table_id;
  if (tableId) {
    const { data: tableRow } = await service
      .from("tables")
      .select("mozo_id")
      .eq("id", tableId)
      .maybeSingle();
    mesaMozoId = (tableRow as { mozo_id: string | null } | null)?.mozo_id ?? null;
  }

  // 2. `loaded_by` del último item activo, para lo que no tiene mesa asignada.
  const { data } = await service
    .from("order_items")
    .select("loaded_by, cancelled_at")
    .eq("order_id", orderId)
    .not("loaded_by", "is", null)
    .is("cancelled_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastLoadedBy =
    (data as { loaded_by: string | null } | null)?.loaded_by ?? null;

  return elegirMozoAtribuido({ mesaMozoId, lastLoadedBy });
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
  // Sólo «otro» exige nota (spec 126). Transferencia la pedía y no servía de
  // auditoría: se contestaba con una letra para poder cerrar el pedido.
  if (input.method === "other" && (!input.notes || input.notes.trim() === "")) {
    return actionError('Para método "otro", se requiere una nota.');
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

  // …y de más se registra lo que se cobró, no el billete: el vuelto vuelve al
  // cliente y no puede quedar contado en la caja (issue #188). El tope lo
  // decide el server aunque la pantalla ya mande el monto acotado: es plata, y
  // esta action la llaman tres superficies distintas.
  const { chargeCents } = cashCharge({
    method: input.method,
    amount_cents: input.amount_cents,
    adjustment_cents: input.adjustment_cents ?? 0,
    remaining_cents: remainingCents,
  });

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
    p_amount_cents: chargeCents,
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

  // spec 098 · H-35 — un arqueo firmado no se reescribe.
  //
  // Este era el martillo más grande de la caja sin una sola guarda de período,
  // mientras que anular **una línea suelta** sí las tenía. La asimetría era al
  // revés de lo razonable: el camino con menos control era el que más plata
  // movía. Y encima el mensaje de la corrección fina («Anulá el cobro y volvé a
  // registrarlo») empujaba justo hacia acá.
  const cerrado = await bloqueoPorPeriodoCerrado(service, business.id, orderId);
  if (cerrado) return actionError(cerrado);

  // spec 100 — no se devuelve plata que ya tiene CAE.
  //
  // Esta action reembolsaba los pagos sin mirar `invoices` una sola vez: la
  // factura quedaba `authorized`, con su CAE vivo, por una venta que ya no
  // existía. Plata devuelta en caja e IVA declarado ante ARCA. En AR un
  // comprobante autorizado no se borra: se anula emitiendo la nota de crédito
  // (`anularFactura`), y recién ahí se toca la caja.
  //
  // Bloquear en vez de encadenar la NC: la NC puede fallar en ARCA, y no
  // querés haber devuelto la plata antes de saberlo.
  const { data: facturasVivas } = await service
    .from("invoices")
    .select("tipo_comprobante, punto_venta, numero")
    .eq("business_id", business.id)
    .eq("order_id", orderId)
    .eq("status", "authorized")
    .in("tipo_comprobante", ["factura_a", "factura_b"]);
  const factura = ((facturasVivas ?? []) as InvoiceRef[])[0];
  if (factura) {
    return actionError(
      `Esta cuenta tiene la ${tipoLabel(factura.tipo_comprobante)} ${formatInvoiceNumber(
        factura.punto_venta,
        factura.numero,
      )} autorizada. Anulá el comprobante primero (se emite la nota de crédito) y después anulá el cobro.`,
    );
  }

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
  const { data: refundados } = await service
    .from("payments")
    .update({
      payment_status: "refunded",
      refunded_at: new Date().toISOString(),
      refunded_reason: motivo.trim(),
    })
    .eq("order_id", orderId)
    .eq("payment_status", "paid")
    .select("id, caja_id, amount_cents");

  // spec 098 · H-35 — el rastro. Hasta acá anular un cobro no dejaba **nada**
  // en `caja_audit_log` (grep vacío) y `payments` no tiene `refunded_by`, así
  // que la plata desaparecía del arqueo sin que quedara quién la sacó. Es el
  // mismo libro donde ya escriben las correcciones de línea, así que el
  // encargado lo lee en el lugar donde ya mira.
  const filas = ((refundados ?? []) as Array<{
    id: string;
    caja_id: string | null;
    amount_cents: number;
  }>).map((p) => ({
    business_id: business.id,
    caja_id: p.caja_id,
    entity_type: "payment",
    entity_id: p.id,
    field: "payment_status",
    from_value: "paid",
    to_value: "refunded",
    by_user_id: ctx.userId,
    reason: motivo.trim(),
  }));
  if (filas.length > 0) {
    const { error: auditErr } = await service
      .from("caja_audit_log")
      .insert(filas);
    // El audit no bloquea la anulación, pero su ausencia sí se loguea fuerte:
    // un reembolso sin rastro es justo lo que esta spec vino a arreglar.
    if (auditErr) console.error("anularCobro · caja_audit_log", auditErr);
  }

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

  // issue #188 — la cuenta que sigue abierta también quedó en cero.
  //
  // El reset de `total_paid_cents` vivía sólo adentro de la rama de reapertura,
  // así que anular el cobro **parcial** de una sub-cuenta reembolsaba los pagos
  // y reseteaba los splits pero dejaba la orden diciendo que ya había cobrado
  // esa plata. El panel de cobro se salvaba porque recalcula, pero el ticket de
  // cuenta lo lee crudo (`cuenta-ticket.ts`) e imprimía "Pagado / RESTA" sobre
  // una mesa que no pagó un peso, y el guard de "en efectivo no se cobra de
  // menos" comparaba contra un resto de menos.
  //
  // Acá se refundaron **todos** los pagos de la orden, así que el cero es el
  // número correcto en las dos ramas.
  if (order.lifecycle_status !== "closed") {
    const { error: resetErr } = await service
      .from("orders")
      .update({ total_paid_cents: 0, payment_status: "pending" })
      .eq("id", orderId);
    if (resetErr) console.error("anularCobro · reset total_paid", resetErr);
  }

  // spec 100 — la mesa vuelve al plano tal como estaba, con sus ítems.
  //
  // El caso real: el mozo cobró la mesa equivocada. La gente sigue sentada y
  // su mesa desapareció del plano. Los `order_items` nunca se tocaron —lo que
  // faltaba era el puntero y un estado que no mintiera—. Antes esto corría
  // sólo `if (fromStatus === 'libre')`, volvía siempre a `pidio_cuenta` y
  // reescribía `opened_at`/`bill_requested_at` con `now()`. Las tres
  // decisiones viven ahora en `restitucion-mesa.ts`.
  //
  // `order.table_id` sigue al traslado (spec 048 lo reescribe), así que es la
  // mesa correcta incluso si la cuenta se movió antes de cobrarse.
  if (order.table_id) {
    const { data: tableRow } = await service
      .from("tables")
      .select("id, operational_status, current_order_id")
      .eq("id", order.table_id)
      .single();
    const mesa = tableRow as {
      operational_status: OperationalStatus;
      current_order_id: string | null;
    } | null;

    if (mesa) {
      const restitucion = restitucionMesa(
        {
          operationalStatus: mesa.operational_status,
          currentOrderId: mesa.current_order_id,
        },
        {
          id: orderId,
          createdAt: order.created_at,
          billRequestedAt: order.bill_requested_at,
        },
      );

      if (restitucion.kind === "patch") {
        await service
          .from("tables")
          .update({
            operational_status: restitucion.operationalStatus,
            opened_at: restitucion.openedAt,
            // spec 096 · H-33 — el puntero. El cobro lo nulea y la reapertura
            // escribía `operational_status` y `opened_at` pero nunca esto, y
            // `imprimirCuenta` resuelve la orden **exclusivamente** por acá: el
            // mozo tocaba «Imprimir cuenta» para llevar el papel corregido y le
            // salía «La mesa no tiene una cuenta abierta». Se "arreglaba solo" si
            // mandaba algo más a cocina, que es lo que reescribe el puntero.
            current_order_id: restitucion.currentOrderId,
          })
          .eq("id", order.table_id);

        if (mesa.operational_status !== restitucion.operationalStatus) {
          await service.from("tables_audit_log").insert({
            table_id: order.table_id,
            business_id: business.id,
            kind: "status",
            from_value: mesa.operational_status,
            to_value: restitucion.operationalStatus,
            by_user_id: ctx.userId,
            reason: `anular cobro: ${motivo.trim()}`,
          });
        }

        // La reserva que el cobro dio por `completed` vuelve a `seated`: si la
        // cuenta se reabre, esa gente sigue en la mesa. Se ancla al momento del
        // cobro y sólo mira ese servicio (la reserva empezó antes de cobrar y
        // no más de 12 h atrás), así no resucita el turno del mediodía cuando
        // se anula un cobro de la noche.
        if (order.closed_at) {
          const cobro = new Date(order.closed_at);
          const desde = new Date(cobro.getTime() - 12 * 60 * 60 * 1000);
          const { data: reservas } = await service
            .from("reservations")
            .select("id")
            .eq("business_id", business.id)
            .eq("table_id", order.table_id)
            .eq("status", "completed")
            .gte("starts_at", desde.toISOString())
            .lte("starts_at", cobro.toISOString())
            .order("starts_at", { ascending: false })
            .limit(1);
          const reserva = ((reservas ?? []) as { id: string }[])[0];
          if (reserva) {
            const { error: resErr } = await service
              .from("reservations")
              .update({ status: "seated" })
              .eq("id", reserva.id);
            if (resErr) console.error("anularCobro · reabrir reserva", resErr);
          }
        }
      }
    }
  }

  revalidatePath(`/${businessSlug}/mozo`);
  return actionOk(undefined);
}

// Suprimir warning de import sin uso si el helper llega a no llamarse.
void sumActiveItems;
