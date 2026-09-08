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
import { conceptoEsDelNegocio } from "./queries";
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

  // Issue #268 · TODO adentro de una transacción, bajo el mismo `for update`
  // que toma `registrar_pago_proveedor_tx` (0069).
  //
  // Antes esto eran tres round-trips: leer las imputaciones, revertir el stock
  // por RPC, y recién ahí marcar la anulación. En esa ventana —cientos de
  // milisegundos, no minutos— entra entero un pago: el comprobante todavía
  // figuraba vivo cuando la RPC del pago tomaba su lock, así que ganaban las
  // dos y quedaba un comprobante ANULADO con un pago VIVO imputado. Como el
  // saldo es derivado (Σ comprobantes vivos − Σ pagos vivos), el proveedor
  // quedaba con plata «a favor» que nadie le debe, y si el pago fue en efectivo
  // había además una sangría real sin comprobante que la justifique.
  //
  // La guarda no se duplica acá: leerla de nuevo desde TS volvería a leerla
  // fuera del lock, que es exactamente el bug.
  const { error } = await service.rpc("anular_comprobante_tx", {
    p_business_id: business.id,
    p_invoice_id: parsed.data.id,
    p_cancelled_by: ctx.data.userId,
    p_reason: parsed.data.reason.trim(),
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("COMPROBANTE_NO_ENCONTRADO")) {
      return actionError("Comprobante no encontrado.");
    }
    if (msg.includes("COMPROBANTE_YA_ANULADO")) {
      return actionError("El comprobante ya estaba anulado.");
    }
    if (msg.includes("COMPROBANTE_CON_PAGO_VIVO")) {
      return actionError(
        "El comprobante tiene pagos imputados: anulá primero el pago y después el comprobante.",
      );
    }
    console.error("anularComprobante", error);
    return actionError("No pudimos anular el comprobante.");
  }

  revalidatePath(`/${slug}/admin/proveedores`);
  revalidatePath(`/${slug}/admin/catalogo`);
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

  // Issue #268 · el concepto de gasto tiene que ser de ESTE negocio. Esta es la
  // puerta más expuesta de las dos: el concepto es el único campo declarado
  // «siempre editable», incluso con pagos vivos.
  if (
    "expense_concept_id" in campos &&
    !(await conceptoEsDelNegocio(service, business.id, campos.expense_concept_id))
  ) {
    return actionError("El concepto de gasto no es de este negocio.");
  }

  // Issue #268 · guarda y escritura en la MISMA transacción, igual que
  // `anularComprobante`. Acá la guarda de pagos vivos estaba copiada tal cual —
  // con la carrera copiada adentro—, así que arreglar sólo la anulación dejaba
  // el gemelo vivo: dos pestañas, una editando el importe y otra pagando, y el
  // comprobante terminaba con un total distinto al que se pagó.
  //
  // Sólo viajan las claves que el usuario mandó. Mandar el objeto entero con
  // `undefined` rellenados leería «borrar el concepto» y «no tocar el concepto»
  // como lo mismo.
  const { error } = await service.rpc("editar_comprobante_tx", {
    p_business_id: business.id,
    p_invoice_id: id,
    p_campos: campos,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("COMPROBANTE_NO_ENCONTRADO")) {
      return actionError("Comprobante no encontrado.");
    }
    if (msg.includes("COMPROBANTE_ANULADO")) {
      return actionError("Un comprobante anulado no se edita.");
    }
    if (msg.includes("COMPROBANTE_CON_PAGO_VIVO")) {
      return actionError(
        "El comprobante ya tiene pagos: podés corregir el concepto, el número y las notas, pero no el importe ni la fecha.",
      );
    }
    if (msg.includes("SIGNO_INVALIDO")) {
      return actionError(
        "La nota de crédito va en negativo; el resto de los comprobantes, en positivo.",
      );
    }
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

    // Issue #268 · el comprobante anulado no se «cae» del reparto en silencio.
    //
    // `comprobantesImpagos` filtra lo anulado, así que si alguien anuló el
    // comprobante mientras el otro tildaba y confirmaba el pago, el reparto
    // quedaba vacío y la plata entraba como PAGO A CUENTA — con toast de éxito y
    // sin que nadie hubiera pedido un pago a cuenta. La otra mitad de esta
    // carrera (la anulación que llega después) ya la corta la RPC con
    // COMPROBANTE_NO_DISPONIBLE; ésta no la veía nadie porque el resultado era
    // plausible: el proveedor queda con saldo a favor.
    if (invoices.some((i) => i.cancelled_at != null)) {
      return actionError("Uno de los comprobantes se anuló mientras cargabas el pago.");
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
