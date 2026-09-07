"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canMakeSangria, canManageProveedores } from "@/lib/permissions/can";
import { getCajaAdministrativa } from "@/lib/caja/queries";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  comprobantesImpagos,
  repartirPago,
  type ComprobanteCompra,
  type ImputacionPago,
  type PagoProveedor,
} from "./cuenta-corriente";
import { unwrap } from "./unwrap";
import {
  AnularInput,
  ExpenseConceptInput,
  SupplierInvoiceEditInput,
  SupplierPaymentInput,
} from "./schema";

// Las tablas de la spec 158 (`expense_concepts`, `supplier_payments`,
// `supplier_payment_allocations`) todavía no están en `database.types.ts` — el
// `pnpm db:types` del repo necesita el CLI linkeado. Mismo escape hatch que usa
// `caja/cuenta-corriente-actions.ts` de la spec 141.
type GenericClient = SupabaseClient;
const db = () => createSupabaseServiceClient() as unknown as GenericClient;

/** Hoy en Buenos Aires, `YYYY-MM-DD`. Nunca `new Date()` pelado. */
function hoyAR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

async function requireProveedorCtx(businessId: string) {
  const ctxResult = await requireMozoActionContext(businessId);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (!canManageProveedores(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo admin o encargado pueden gestionar proveedores.");
  }
  return actionOk(ctx);
}

// ═══════════════════════════════════════════════════════════════════
// CONCEPTOS DE GASTO
// ═══════════════════════════════════════════════════════════════════

export async function createExpenseConcept(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = ExpenseConceptInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const ctx = await requireProveedorCtx(business.id);
  if (!ctx.ok) return ctx;

  const { data, error } = await db()
    .from("expense_concepts")
    .insert({
      business_id: business.id,
      name: parsed.data.name.trim(),
      rubro: parsed.data.rubro,
      is_active: parsed.data.is_active,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return actionError("Ya existe un concepto con ese nombre.");
    console.error("createExpenseConcept", error);
    return actionError("No pudimos crear el concepto.");
  }

  revalidatePath(`/${slug}/admin/proveedores`);
  return actionOk({ id: (data as { id: string }).id });
}

export async function updateExpenseConcept(
  slug: string,
  conceptId: string,
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = ExpenseConceptInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const ctx = await requireProveedorCtx(business.id);
  if (!ctx.ok) return ctx;

  const { error } = await db()
    .from("expense_concepts")
    .update({
      name: parsed.data.name.trim(),
      rubro: parsed.data.rubro,
      is_active: parsed.data.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conceptId)
    .eq("business_id", business.id);

  if (error) {
    if (error.code === "23505") return actionError("Ya existe un concepto con ese nombre.");
    return actionError("No pudimos guardar el concepto.");
  }

  revalidatePath(`/${slug}/admin/proveedores`);
  return actionOk(undefined);
}

// ═══════════════════════════════════════════════════════════════════
// ANULAR UN COMPROBANTE
// ═══════════════════════════════════════════════════════════════════

/**
 * Anula un comprobante de compra — spec 158 · D7.
 *
 * **Un comprobante con pagos vivos imputados no se anula.** Es la regla textual
 * de MaxiRest ("primero deberán ser anuladas las órdenes de pago asociadas") y
 * acá es lo que sostiene el saldo derivado: sin la guarda, queda un pago
 * imputado a un comprobante que ya no existe y el saldo empieza a mentir.
 *
 * No se borra: se anula con motivo, como un movimiento de caja (spec 070). Lo
 * anulado sigue visible en el libro.
 */
export async function anularComprobante(
  slug: string,
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = AnularInput.safeParse(input);
  if (!parsed.success) return actionError("Escribí un motivo para anular.");

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const ctx = await requireProveedorCtx(business.id);
  if (!ctx.ok) return ctx;

  const service = db();

  const { data: invoice } = await service
    .from("supplier_invoices")
    .select("id, cancelled_at")
    .eq("id", parsed.data.id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!invoice) return actionError("Comprobante no encontrado.");
  if ((invoice as { cancelled_at: string | null }).cancelled_at) {
    return actionError("El comprobante ya estaba anulado.");
  }

  // Spec 161 · D3 — esta guarda fallaba ABIERTA: sin destructurar `error`, una
  // lectura caída dejaba `allocations` en null, `conPagoVivo` en false, y el
  // comprobante pago **se anulaba igual**. No hay red abajo: el FK
  // `ON DELETE RESTRICT` protege el borrado, no la anulación lógica.
  //
  // Si no se puede saber si hay pagos vivos, no se anula. Anular de más ensucia
  // el informe y descuadra el saldo; anular de menos le pide al encargado que
  // reintente.
  const { data: allocations, error: allocErr } = await service
    .from("supplier_payment_allocations")
    .select("payment_id, supplier_payments!inner(cancelled_at)")
    .eq("invoice_id", parsed.data.id);

  if (allocErr || !allocations) {
    console.error("anularComprobante · imputaciones", allocErr);
    return actionError(
      "No pudimos verificar si el comprobante tiene pagos. Probá de nuevo en un momento.",
    );
  }

  // PostgREST devuelve el embed como array aunque el FK sea a-uno: normalizar
  // acá evita que un `.cancelled_at` sobre un array dé `undefined` y deje pasar
  // la anulación de un comprobante que sí está pago.
  const conPagoVivo = (allocations as unknown as Array<{
    supplier_payments: { cancelled_at: string | null } | Array<{ cancelled_at: string | null }> | null;
  }>).some((a) => {
    const emb = a.supplier_payments;
    const pagos = emb == null ? [] : Array.isArray(emb) ? emb : [emb];
    return pagos.some((p) => p.cancelled_at == null);
  });

  if (conPagoVivo) {
    return actionError(
      "El comprobante tiene pagos imputados: anulá primero el pago y después el comprobante.",
    );
  }

  const { error } = await service
    .from("supplier_invoices")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_by: ctx.data.userId,
      cancelled_reason: parsed.data.reason.trim(),
    })
    .eq("id", parsed.data.id)
    .eq("business_id", business.id);

  if (error) return actionError("No pudimos anular el comprobante.");

  revalidatePath(`/${slug}/admin/proveedores`);
  return actionOk(undefined);
}

/**
 * Corrige un comprobante ya cargado — spec 163.
 *
 * El Alcance de la 158 decía «alta / edición / anulación», y la edición nunca
 * existió: cero `update` sobre `supplier_invoices` fuera de `anularComprobante`.
 * El botón «Editar» de la ficha es el del *proveedor*.
 *
 * **La guarda va partida** (D1): la plata (total, fecha, tipo) sólo se toca sin
 * pagos vivos; la clasificación (concepto, vencimiento, número, notas) siempre.
 * El caso frecuente es el segundo — el concepto mal puesto que se descubre a fin
 * de mes con la compra ya paga— y hoy obliga a anular el pago, que marca la
 * sangría que el arqueo ya contó. Nadie lo hace, y el informe queda sucio.
 */
export async function editarComprobante(
  slug: string,
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = SupplierInvoiceEditInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const ctx = await requireProveedorCtx(business.id);
  if (!ctx.ok) return ctx;

  const service = db();
  const { id, ...campos } = parsed.data;

  const { data: invoice, error: invErr } = await service
    .from("supplier_invoices")
    .select("id, cancelled_at, total_cents, document_type")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (invErr) return actionError("No pudimos leer el comprobante.");
  if (!invoice) return actionError("Comprobante no encontrado.");
  if ((invoice as { cancelled_at: string | null }).cancelled_at) {
    return actionError("Un comprobante anulado no se edita.");
  }

  const tocaPlata =
    campos.total_cents !== undefined ||
    campos.invoice_date !== undefined ||
    campos.document_type !== undefined;

  if (tocaPlata) {
    // Misma lectura y misma política que `anularComprobante`: si no se puede
    // saber si hay pagos vivos, no se toca la plata (spec 161 · D3).
    const { data: allocations, error: allocErr } = await service
      .from("supplier_payment_allocations")
      .select("payment_id, supplier_payments!inner(cancelled_at)")
      .eq("invoice_id", id);

    if (allocErr || !allocations) {
      console.error("editarComprobante · imputaciones", allocErr);
      return actionError(
        "No pudimos verificar si el comprobante tiene pagos. Probá de nuevo en un momento.",
      );
    }

    const conPagoVivo = (allocations as unknown as Array<{
      supplier_payments:
        | { cancelled_at: string | null }
        | Array<{ cancelled_at: string | null }>
        | null;
    }>).some((a) => {
      const emb = a.supplier_payments;
      const pagos = emb == null ? [] : Array.isArray(emb) ? emb : [emb];
      return pagos.some((p) => p.cancelled_at == null);
    });

    if (conPagoVivo) {
      return actionError(
        "El comprobante ya tiene pagos: podés corregir el concepto, el número y las notas, pero no el importe ni la fecha.",
      );
    }

    // El mismo signo que exige la base (158 · D4), acá para dar el mensaje bueno.
    const tipo = campos.document_type ?? (invoice as { document_type: string }).document_type;
    const total = campos.total_cents ?? (invoice as { total_cents: number }).total_cents;
    if (tipo === "nota_credito" ? total > 0 : total < 0) {
      return actionError(
        "La nota de crédito va en negativo; el resto de los comprobantes, en positivo.",
      );
    }
  }

  const { error } = await service
    .from("supplier_invoices")
    .update(campos)
    .eq("id", id)
    .eq("business_id", business.id);

  if (error) {
    console.error("editarComprobante", error);
    return actionError("No pudimos guardar los cambios.");
  }

  revalidatePath(`/${slug}/admin/proveedores`);
  return actionOk(undefined);
}

// ═══════════════════════════════════════════════════════════════════
// PAGAR
// ═══════════════════════════════════════════════════════════════════

/**
 * Registra un pago a un proveedor — spec 158 · D5/D6.
 *
 * Si el medio es **efectivo**, escribe además una `sangria` en
 * `caja_movimientos`: así el egreso entra solo al arqueo, al corte (spec 139) y
 * al libro de caja, sin que ningún cálculo de caja tenga que aprender un `kind`
 * nuevo. El resto de los medios baja la deuda sin tocar el cajón.
 *
 * Las imputaciones se calculan del vencimiento más viejo al más nuevo; lo que
 * sobra queda como **pago a cuenta** (saldo a favor), no forzado contra un
 * comprobante que no lo debe.
 */
export async function registrarPagoProveedor(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ id: string; imputado_cents: number; a_cuenta_cents: number }>> {
  const parsed = SupplierPaymentInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const data = parsed.data;

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageProveedores(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo admin o encargado pueden pagar a proveedores.");
  }
  // Sacar plata del cajón no puede tener un techo más bajo por entrar desde otra
  // pantalla: el pago en efectivo exige lo mismo que una sangría.
  if (data.method === "cash" && !canMakeSangria(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo encargado o admin pueden sacar efectivo de la caja.");
  }

  const service = db();

  const { data: supplier } = await service
    .from("suppliers")
    .select("id, name")
    .eq("id", data.supplier_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!supplier) return actionError("Proveedor no encontrado.");

  // ── qué comprobantes cancela ──
  let imputaciones: Array<{ invoice_id: string; amount_cents: number }> = [];
  let aCuenta = data.amount_cents;

  if (data.invoice_ids.length > 0) {
    // Spec 161 · D1 — estas tres lecturas deciden CONTRA QUÉ se imputa la plata,
    // y las tres descartaban el error. La peor era la de `allocs`: si fallaba,
    // los comprobantes ya pagados aparecían impagos y `repartirPago` imputaba
    // contra ellos.
    let invoices: ComprobanteCompra[];
    let allocs: ImputacionPago[];
    let pagos: PagoProveedor[];
    try {
      const [invRes, allocRes, pagosRes] = await Promise.all([
        service
          .from("supplier_invoices")
          .select("id, total_cents, invoice_date, due_date, document_type, cancelled_at")
          .eq("business_id", business.id)
          .eq("supplier_id", data.supplier_id)
          .in("id", data.invoice_ids),
        service
          .from("supplier_payment_allocations")
          .select("payment_id, invoice_id, amount_cents")
          .in("invoice_id", data.invoice_ids),
        service
          .from("supplier_payments")
          .select("id, amount_cents, paid_at, method, cancelled_at")
          .eq("business_id", business.id)
          .eq("supplier_id", data.supplier_id),
      ]);
      invoices = unwrap(invRes, "supplier_invoices") as unknown as ComprobanteCompra[];
      allocs = unwrap(allocRes, "supplier_payment_allocations") as unknown as ImputacionPago[];
      pagos = unwrap(pagosRes, "supplier_payments") as unknown as PagoProveedor[];
    } catch (e) {
      console.error("registrarPagoProveedor · lectura del reparto", e);
      return actionError("No pudimos leer los comprobantes del proveedor. Probá de nuevo.");
    }

    if (invoices.length !== data.invoice_ids.length) {
      return actionError("Alguno de los comprobantes no es de este proveedor.");
    }

    const reparto = repartirPago(data.amount_cents, comprobantesImpagos(invoices, allocs, pagos));
    imputaciones = reparto.imputaciones;
    aCuenta = reparto.a_cuenta_cents;
  }

  // ── el egreso de caja, si sale efectivo ──
  //
  // spec 160 · la caja la resuelve el SERVER, no la elige el usuario. El egreso va
  // siempre a la caja administrativa: en el cajón del turno una orden de pago
  // descuadra el arqueo por su monto entero y el encargado no puede cerrar. En
  // MaxiRest ese escape existe y se usó 2 veces en 8 años; acá se cierra.
  let cajaAdminId: string | null = null;

  if (data.method === "cash") {
    const cajaAdmin = await getCajaAdministrativa(business.id);
    if (!cajaAdmin) {
      return actionError(
        "Este negocio todavía no tiene Caja Mayor. Avisale al equipo para que la cree.",
      );
    }
    if (!cajaAdmin.is_active) {
      return actionError("La Caja Mayor está inactiva.");
    }
    cajaAdminId = cajaAdmin.id;
  }

  // ── sangría + pago + imputaciones, en UNA transacción ──
  //
  // Spec 161 · D4. Antes eran tres escrituras en secuencia y sólo la segunda
  // revertía algo: si fallaba el insert de imputaciones, la action hacía
  // `console.error` y devolvía OK. La caja quedaba con la plata de menos, el
  // saldo bajaba, el comprobante seguía impago en las tres pantallas, y el
  // toast decía «Pago registrado.».
  //
  // Ahora el rollback lo hace Postgres. La RPC además serializa con FOR UPDATE
  // y rechaza el comprobante sobre-imputado: la carrera entre el cálculo del
  // reparto y la escritura no se podía ver desde acá.
  const { data: rpc, error } = await service.rpc("registrar_pago_proveedor_tx", {
    p_business_id: business.id,
    p_supplier_id: data.supplier_id,
    p_amount_cents: data.amount_cents,
    p_method: data.method,
    p_paid_at: data.paid_at ?? hoyAR(),
    p_notes: data.notes ?? null,
    p_created_by: ctx.userId,
    p_caja_id: cajaAdminId,
    p_caja_reason: `Pago a proveedor · ${(supplier as { name: string }).name}`,
    p_imputaciones: imputaciones,
  });

  const fila = (rpc as Array<{ payment_id: string }> | null)?.[0];
  if (error || !fila) {
    console.error("registrarPagoProveedor", error);
    if (error?.message?.includes("COMPROBANTE_SOBRE_IMPUTADO")) {
      return actionError(
        "Alguien más pagó uno de estos comprobantes recién. Refrescá y volvé a intentar.",
      );
    }
    if (error?.message?.includes("COMPROBANTE_NO_DISPONIBLE")) {
      return actionError("Uno de los comprobantes se anuló mientras cargabas el pago.");
    }
    return actionError("No pudimos registrar el pago.");
  }

  const paymentId = fila.payment_id;

  revalidatePath(`/${slug}/admin/proveedores`);
  // spec 160 · el egreso ya no toca el board del turno; el lugar donde se audita
  // es el libro, que es justamente adonde manda el error de `anularPagoProveedor`.
  revalidatePath(`/${slug}/admin/caja/movimientos`);
  return actionOk({
    id: paymentId,
    imputado_cents: data.amount_cents - aCuenta,
    a_cuenta_cents: aCuenta,
  });
}

/**
 * Anula un pago — spec 158 · escenario 6.
 *
 * La deuda vuelve (el pago deja de estar vivo y el saldo lo recalcula solo), y
 * el egreso de caja se anula con el mismo motivo. Los dos siguen visibles
 * tachados: un movimiento que desaparece es un movimiento que nadie audita.
 */
export async function anularPagoProveedor(
  slug: string,
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = AnularInput.safeParse(input);
  if (!parsed.success) return actionError("Escribí un motivo para anular.");

  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (!canManageProveedores(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo admin o encargado pueden anular un pago.");
  }

  const service = db();

  const { data: pago } = await service
    .from("supplier_payments")
    .select("id, caja_movimiento_id, cancelled_at, method")
    .eq("id", parsed.data.id)
    .eq("business_id", business.id)
    .maybeSingle();

  const row = pago as {
    id: string;
    caja_movimiento_id: string | null;
    cancelled_at: string | null;
    method: string;
  } | null;

  if (!row) return actionError("Pago no encontrado.");
  if (row.cancelled_at) return actionError("El pago ya estaba anulado.");
  if (row.method === "cash" && !canMakeSangria(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo encargado o admin pueden revertir un egreso de caja.");
  }

  const now = new Date().toISOString();
  const reason = parsed.data.reason.trim();

  const { error } = await service
    .from("supplier_payments")
    .update({ cancelled_at: now, cancelled_by: ctx.userId, cancelled_reason: reason })
    .eq("id", row.id)
    .eq("business_id", business.id);

  if (error) return actionError("No pudimos anular el pago.");

  if (row.caja_movimiento_id) {
    const { error: movErr } = await service
      .from("caja_movimientos")
      .update({
        cancelled_at: now,
        cancelled_by: ctx.userId,
        cancelled_reason: `Pago a proveedor anulado · ${reason}`,
      })
      .eq("id", row.caja_movimiento_id)
      .eq("business_id", business.id);

    // El pago ya quedó anulado; si el egreso no se pudo anular, la caja queda
    // con plata de menos y hay que arreglarlo a mano. Se avisa, no se silencia.
    if (movErr) {
      console.error("anularPagoProveedor · movimiento", movErr);
      return actionError(
        "El pago se anuló pero el egreso de caja quedó vivo: anulalo desde el libro de caja.",
      );
    }
  }

  revalidatePath(`/${slug}/admin/proveedores`);
  revalidatePath(`/${slug}/admin/caja/movimientos`);
  return actionOk(undefined);
}
