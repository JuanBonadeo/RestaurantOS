import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  armarLibroProveedor,
  calcularSaldoProveedor,
  comprobantesConSaldo,
  comprobantesImpagos,
  diasVencido,
  proyeccionPorDia,
  totalizarPorClave,
  type ComprobanteCompra,
  type ComprobanteConSaldo,
  type DiaDeProyeccion,
  type ImputacionPago,
  type MovimientoProveedor,
  type PagoProveedor,
} from "./cuenta-corriente";
import { enLotes, fetchAll, unwrap } from "./unwrap";

type GenericClient = SupabaseClient;
const db = () => createSupabaseServiceClient() as unknown as GenericClient;

const INVOICE_COLS =
  "id, supplier_id, total_cents, invoice_date, due_date, document_type, invoice_number, expense_concept_id, cancelled_at";
const PAYMENT_COLS = "id, supplier_id, amount_cents, paid_at, method, cancelled_at";

export type ExpenseConcept = {
  id: string;
  name: string;
  rubro: string;
  is_active: boolean;
};

export type SaldoProveedor = {
  supplierId: string;
  supplierName: string;
  saldo_cents: number;
  impagos: number;
  /** Días de atraso del impago más viejo. `null` si no debe nada vencido. */
  atraso_dias: number | null;
};

export type CuentaDeProveedor = {
  supplierId: string;
  supplierName: string;
  /** El saldo es SIEMPRE el total, no el del período que se esté mirando (159 · D3). */
  saldo_cents: number;
  impagos: ComprobanteConSaldo[];
  libro: MovimientoProveedor[];
  /** spec 159 · lo que necesita el master-detail, sin un fetch por fila (D2). */
  compras: ComprobanteConSaldo[];
  pagos: PagoProveedor[];
  imputaciones: ImputacionPago[];
};

export async function getExpenseConcepts(
  businessId: string,
  soloActivos = false,
): Promise<ExpenseConcept[]> {
  let q = db()
    .from("expense_concepts")
    .select("id, name, rubro, is_active")
    .eq("business_id", businessId)
    .order("rubro")
    .order("name");

  if (soloActivos) q = q.eq("is_active", true);

  return unwrap(await q, "expense_concepts") as unknown as ExpenseConcept[];
}

/**
 * Las cuatro lecturas que necesitan las tres pantallas de la 159 (saldos,
 * vencimientos y proyección): el negocio entero, paginado.
 *
 * Estaban copiadas en las tres, y las tres con `?? []`. Juntarlas no es sólo
 * DRY: garantiza que el saldo del encabezado, el de la lista de vencimientos y
 * el del calendario salgan **de los mismos datos**. Que difieran por una página
 * que le faltó a una y a otra no, sería el peor de los bugs posibles acá.
 *
 * El `.order("id")` no es decorativo: sin un orden estable, PostgREST puede
 * repetir o saltear filas entre páginas.
 */
async function leerCuentaCorriente(businessId: string) {
  const service = db();

  const [suppliers, invoices, payments, allocs] = await Promise.all([
    fetchAll(
      () => service.from("suppliers").select("id, name").eq("business_id", businessId).order("id"),
      "suppliers",
    ),
    fetchAll(
      () =>
        service
          .from("supplier_invoices")
          .select(INVOICE_COLS)
          .eq("business_id", businessId)
          .order("id"),
      "supplier_invoices",
    ),
    fetchAll(
      () =>
        service
          .from("supplier_payments")
          .select(PAYMENT_COLS)
          .eq("business_id", businessId)
          .order("id"),
      "supplier_payments",
    ),
    fetchAll(
      () =>
        service
          .from("supplier_payment_allocations")
          .select("payment_id, invoice_id, amount_cents")
          .eq("business_id", businessId)
          .order("payment_id"),
      "supplier_payment_allocations",
    ),
  ]);

  return {
    nombres: new Map(
      (suppliers as unknown as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
    ),
    invoices: invoices as unknown as Array<ComprobanteCompra & { supplier_id: string }>,
    payments: payments as unknown as Array<PagoProveedor & { supplier_id: string }>,
    allocs: allocs as unknown as ImputacionPago[],
  };
}

/**
 * El saldo de todos los proveedores del negocio, sólo los que deben algo.
 *
 * Una consulta por tabla y el cruce en memoria: son decenas de proveedores y
 * cientos de comprobantes por mes, no millones. El día que deje de alcanzar, el
 * lugar donde se arregla es acá y no en cada pantalla, porque el saldo lo
 * calcula una sola función pura.
 */
export async function getSaldosDeProveedores(
  businessId: string,
): Promise<SaldoProveedor[]> {
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  const { nombres, invoices, payments, allocs } = await leerCuentaCorriente(businessId);

  return [...nombres.entries()]
    .map(([id, name]) => {
      const s = { id, name };
      const mios = invoices.filter((i) => i.supplier_id === s.id);
      const pagos = payments.filter((p) => p.supplier_id === s.id);
      const impagos = comprobantesImpagos(mios, allocs, pagos);
      const vencidos = impagos
        .map((c) => diasVencido(c, hoy))
        .filter((d) => d > 0);

      return {
        supplierId: s.id,
        supplierName: s.name,
        saldo_cents: calcularSaldoProveedor(mios, pagos),
        impagos: impagos.length,
        atraso_dias: vencidos.length ? Math.max(...vencidos) : null,
      };
    })
    .filter((s) => s.saldo_cents !== 0 || s.impagos > 0)
    .sort((a, b) => b.saldo_cents - a.saldo_cents);
}

/** La ficha de un proveedor: saldo, qué debe y el libro completo. */
export async function getCuentaDeProveedor(
  businessId: string,
  supplierId: string,
): Promise<CuentaDeProveedor | null> {
  const service = db();

  const { data: supplier } = await service
    .from("suppliers")
    .select("id, name")
    .eq("id", supplierId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!supplier) return null;

  const [invoicesRaw, paymentsRaw] = await Promise.all([
    fetchAll(
      () =>
        service
          .from("supplier_invoices")
          .select(INVOICE_COLS)
          .eq("business_id", businessId)
          .eq("supplier_id", supplierId)
          .order("id"),
      "supplier_invoices",
    ),
    fetchAll(
      () =>
        service
          .from("supplier_payments")
          .select(PAYMENT_COLS)
          .eq("business_id", businessId)
          .eq("supplier_id", supplierId)
          .order("id"),
      "supplier_payments",
    ),
  ]);

  const invoices = invoicesRaw as unknown as ComprobanteCompra[];
  const payments = paymentsRaw as unknown as PagoProveedor[];

  // Por lotes: la lista de UUIDs no entra en la URL a partir de ~650
  // comprobantes, y la ficha de un proveedor grande del Golf devolvía
  // `Bad Request` en vez de abrir.
  const allocs = (await enLotes(
    invoices.map((i) => i.id),
    async (lote) =>
      unwrap(
        await service
          .from("supplier_payment_allocations")
          .select("payment_id, invoice_id, amount_cents")
          .in("invoice_id", lote),
        "supplier_payment_allocations",
      ),
  )) as unknown as ImputacionPago[];

  return {
    supplierId: (supplier as { id: string }).id,
    supplierName: (supplier as { name: string }).name,
    saldo_cents: calcularSaldoProveedor(invoices, payments),
    impagos: comprobantesImpagos(invoices, allocs, payments),
    libro: armarLibroProveedor(invoices, payments),
    compras: comprobantesConSaldo(invoices, allocs, payments).sort((a, b) =>
      b.invoice_date.localeCompare(a.invoice_date),
    ),
    pagos: payments,
    imputaciones: allocs,
  };
}

export type Vencimiento = ComprobanteConSaldo & {
  supplierName: string;
  atraso_dias: number;
};

/**
 * Qué vence y cuándo — el "Consulta de Vencimientos" de MaxiRest.
 *
 * Ordenado del más atrasado al que falta más: la lista se lee de arriba hacia
 * abajo y arriba está lo que hay que pagar hoy.
 */
export async function getVencimientos(
  businessId: string,
  hastaFecha?: string,
): Promise<Vencimiento[]> {
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  const { nombres, invoices, payments, allocs } = await leerCuentaCorriente(businessId);

  // `comprobantesImpagos` conserva las columnas que le entran, así que el
  // `supplier_id` viaja aunque el tipo público no lo declare.
  const deQuien = new Map(invoices.map((i) => [i.id, i.supplier_id]));

  return comprobantesImpagos(invoices, allocs, payments)
    .map((c) => ({
      ...c,
      supplierName: nombres.get(deQuien.get(c.id) ?? "") ?? "—",
      atraso_dias: diasVencido(c, hoy),
    }))
    .filter((c) => !hastaFecha || (c.due_date ?? c.invoice_date) <= hastaFecha)
    .sort((a, b) => b.atraso_dias - a.atraso_dias);
}

export type GastoPorClave = {
  clave: string;
  etiqueta: string;
  total_cents: number;
  comprobantes: number;
};

/**
 * En qué se fue la plata, agrupado por concepto o por rubro — la pregunta que
 * hoy no se puede responder.
 */
export async function getGastoPorConcepto(
  businessId: string,
  desde: string,
  hasta: string,
  agrupacion: "concepto" | "rubro" = "concepto",
): Promise<GastoPorClave[]> {
  const service = db();

  const [invoicesRaw, conceptsRaw] = await Promise.all([
    fetchAll(
      () =>
        service
          .from("supplier_invoices")
          .select("total_cents, expense_concept_id, cancelled_at")
          .eq("business_id", businessId)
          .gte("invoice_date", desde)
          .lte("invoice_date", hasta)
          .order("id"),
      "supplier_invoices",
    ),
    fetchAll(
      () =>
        service
          .from("expense_concepts")
          .select("id, name, rubro")
          .eq("business_id", businessId)
          .order("id"),
      "expense_concepts",
    ),
  ]);

  const conceptos = new Map(
    (conceptsRaw as unknown as Array<{ id: string; name: string; rubro: string }>).map((c) => [
      c.id,
      c,
    ]),
  );

  const invoices = invoicesRaw as unknown as Array<{
    total_cents: number;
    expense_concept_id: string | null;
    cancelled_at?: string | null;
  }>;

  const RUBROS: Record<string, string> = {
    mercaderias: "Mercaderías",
    servicios: "Servicios",
    mantenimiento: "Mantenimiento",
    personal: "Gastos en personal",
    impuestos: "Impuestos y tasas",
    vajilla: "Vajilla y mantelería",
    societarios: "Movimientos societarios",
    otros: "Otros gastos",
  };

  return totalizarPorClave(invoices, (i) => {
    const c = i.expense_concept_id ? conceptos.get(i.expense_concept_id) : undefined;
    if (!c) return "sin-concepto";
    return agrupacion === "rubro" ? c.rubro : c.id;
  }).map((t) => {
    if (t.clave === "sin-concepto") return { ...t, etiqueta: "Sin concepto" };
    const etiqueta =
      agrupacion === "rubro"
        ? (RUBROS[t.clave] ?? t.clave)
        : (conceptos.get(t.clave)?.name ?? "—");
    return { ...t, etiqueta };
  });
}

// ── spec 159 · proyección de pagos ─────────────────────────────────

export type ItemDeProyeccion = DiaDeProyeccion["items"][number] & {
  supplierName: string;
};

export type ProyeccionDelMes = {
  mes: string;
  total_cents: number;
  dias: Array<{ fecha: string; total_cents: number; items: ItemDeProyeccion[] }>;
};

/**
 * El calendario del mes: cuánta plata hay que pagar cada día — spec 159 · D4.
 *
 * Responde "¿cuánta plata necesito el jueves?", que es con lo que se decide si se
 * paga hoy o el lunes. La lista de vencimientos, ordenada por atraso, responde
 * otra cosa: "¿a quién le debo?".
 */
export async function getProyeccionPagos(
  businessId: string,
  mes: string,
): Promise<ProyeccionDelMes> {
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

  const { nombres, invoices, payments, allocs } = await leerCuentaCorriente(businessId);

  const deQuien = new Map(invoices.map((i) => [i.id, i.supplier_id]));
  const impagos = comprobantesImpagos(invoices, allocs, payments);

  const dias = proyeccionPorDia(impagos, mes, hoy).map((d) => ({
    ...d,
    items: d.items.map((it) => ({
      ...it,
      supplierName: nombres.get(deQuien.get(it.id) ?? "") ?? "—",
    })),
  }));

  return {
    mes,
    total_cents: dias.reduce((n, d) => n + d.total_cents, 0),
    dias,
  };
}
