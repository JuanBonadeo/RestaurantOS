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
import {
  AnularInput,
  ExpenseConceptInput,
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

  const { data: allocations } = await service
    .from("supplier_payment_allocations")
    .select("payment_id, supplier_payments!inner(cancelled_at)")
    .eq("invoice_id", parsed.data.id);

  // PostgREST devuelve el embed como array aunque el FK sea a-uno: normalizar
  // acá evita que un `.cancelled_at` sobre un array dé `undefined` y deje pasar
  // la anulación de un comprobante que sí está pago.
  const conPagoVivo = ((allocations ?? []) as unknown as Array<{
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
    const { data: invoices } = await service
      .from("supplier_invoices")
      .select("id, total_cents, invoice_date, due_date, document_type, cancelled_at")
      .eq("business_id", business.id)
      .eq("supplier_id", data.supplier_id)
      .in("id", data.invoice_ids);

    const ids = (invoices ?? []).map((i) => (i as { id: string }).id);
    if (ids.length !== data.invoice_ids.length) {
      return actionError("Alguno de los comprobantes no es de este proveedor.");
    }

    const { data: allocs } = await service
      .from("supplier_payment_allocations")
      .select("payment_id, invoice_id, amount_cents")
      .in("invoice_id", ids);

    const { data: pagos } = await service
      .from("supplier_payments")
      .select("id, amount_cents, paid_at, method, cancelled_at")
      .eq("business_id", business.id)
      .eq("supplier_id", data.supplier_id);

    const impagos = comprobantesImpagos(
      (invoices ?? []) as unknown as ComprobanteCompra[],
      (allocs ?? []) as unknown as ImputacionPago[],
      (pagos ?? []) as unknown as PagoProveedor[],
    );

    const reparto = repartirPago(data.amount_cents, impagos);
    imputaciones = reparto.imputaciones;
    aCuenta = reparto.a_cuenta_cents;
  }

  // ── el egreso de caja, si sale efectivo ──
  //
  // spec 160 · la caja la resuelve el SERVER, no la elige el usuario. El egreso va
  // siempre a la caja administrativa: en el cajón del turno una orden de pago
  // descuadra el arqueo por su monto entero y el encargado no puede cerrar. En
  // MaxiRest ese escape existe y se usó 2 veces en 8 años; acá se cierra.
  let cajaMovimientoId: string | null = null;
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

    const { data: mov, error: movErr } = await service
      .from("caja_movimientos")
      .insert({
        caja_id: cajaAdmin.id,
        business_id: business.id,
        // `sangria` y no un kind propio: el arqueo resta filtrando este valor
        // literal (158 · D5). Lo que cambia en la 160 no es el kind, es la caja.
        kind: "sangria",
        amount_cents: data.amount_cents,
        reason: `Pago a proveedor · ${(supplier as { name: string }).name}`,
        created_by: ctx.userId,
      })
      .select("id")
      .single();

    if (movErr || !mov) return actionError("No se pudo registrar el egreso de caja.");
    cajaMovimientoId = (mov as { id: string }).id;
  }

  // ── el pago ──
  const { data: payment, error } = await service
    .from("supplier_payments")
    .insert({
      business_id: business.id,
      supplier_id: data.supplier_id,
      amount_cents: data.amount_cents,
      method: data.method,
      caja_id: cajaAdminId,
      caja_movimiento_id: cajaMovimientoId,
      paid_at: data.paid_at ?? hoyAR(),
      notes: data.notes ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !payment) {
    // El egreso ya salió: dejarlo vivo sin pago descuadraría la caja contra una
    // deuda que sigue entera. Se revierte anulándolo, con motivo.
    if (cajaMovimientoId) {
      await service
        .from("caja_movimientos")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: ctx.userId,
          cancelled_reason: "Revertido: falló el registro del pago a proveedor",
        })
        .eq("id", cajaMovimientoId);
    }
    console.error("registrarPagoProveedor", error);
    return actionError("No pudimos registrar el pago.");
  }

  const paymentId = (payment as { id: string }).id;

  if (imputaciones.length > 0) {
    const { error: allocErr } = await service
      .from("supplier_payment_allocations")
      .insert(
        imputaciones.map((i) => ({
          business_id: business.id,
          payment_id: paymentId,
          invoice_id: i.invoice_id,
          amount_cents: i.amount_cents,
        })),
      );
    // El pago vale igual: sin imputación es un pago a cuenta, y el saldo total
    // del proveedor —que es el número que importa— ya está bien.
    if (allocErr) console.error("registrarPagoProveedor · imputaciones", allocErr);
  }

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
