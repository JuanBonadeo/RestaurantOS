import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type { Invoice, InvoiceStatus, TipoComprobante } from "./types";

// The invoices table was added in migration 0048 but Supabase types haven't
// been regenerated yet, so we use a generic client to bypass the typed schema.
type GenericClient = SupabaseClient;

const PAGE_SIZE = 20;

type InvoiceFilters = {
  businessId: string;
  /** Comprobantes emitidos a un receptor guardado (spec 150 · D5). */
  fiscalEntityId?: string;
  status?: InvoiceStatus;
  tipo?: TipoComprobante;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
  offset?: number;
};

export async function listInvoices(
  filters: InvoiceFilters,
): Promise<{ invoices: Invoice[]; count: number; page: number; totalPages: number }> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const limit = filters.limit ?? PAGE_SIZE;
  const page = Math.max(1, filters.page ?? 1);
  const offset = filters.offset ?? (page - 1) * limit;

  let query = service
    .from("invoices")
    .select("*", { count: "exact" })
    .eq("business_id", filters.businessId)
    .order("created_at", { ascending: false });

  if (filters.fiscalEntityId) {
    query = query.eq("fiscal_entity_id", filters.fiscalEntityId);
  }
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.tipo) query = query.eq("tipo_comprobante", filters.tipo);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(
      `numero::text.ilike.${term},cuit_receptor.ilike.${term},razon_social_receptor.ilike.${term}`,
    );
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count: totalCount } = await query;
  const count = totalCount ?? 0;

  return {
    invoices: (data ?? []) as Invoice[],
    count,
    page,
    totalPages: Math.max(1, Math.ceil(count / limit)),
  };
}

export type InvoiceKPIs = {
  /**
   * Facturado NETO del período, como el libro IVA: todas las facturas que
   * tomaron CAE (`authorized` + `cancelled`) menos las notas de crédito.
   */
  totalCents: number;
  /** Facturas (A + B) autorizadas. Las notas de crédito no cuentan acá. */
  count: number;
  countA: number;
  countB: number;
  countFailed: number;
  countPending: number;
  /** Notas de crédito autorizadas, en valor absoluto (lo que se restó). */
  notasCreditoCents: number;
  countNotasCredito: number;
};

/**
 * Los números del panel de Facturación (y del resumen de cierre de turno).
 *
 * #274 · 5 — **una nota de crédito resta.** Esto agregaba por
 * `status === 'authorized'` sin mirar nunca `tipo_comprobante`, así que cada NC
 * entraba con signo positivo y encima sumaba a `countA` cuando era
 * `nota_credito_a`.
 *
 * El caso que lo hace visible es el más común de los que generan NC: el cliente
 * pide la A al irse (spec 156 · D5). Quedan tres filas —la B `cancelled`, su NC
 * `authorized` y la A `authorized`— y el mismo ticket se contaba DOS veces:
 * $200.000 facturados y 2 comprobantes sobre una venta de $100.000. En la
 * anulación pura (spec 09, sin re-facturar) es peor en proporción: el panel
 * decía $100.000 donde lo correcto es $0.
 *
 * Nadie lo veía porque un reporte no falla: muestra un número más lindo que el
 * real. La única pista era el ratio facturado/ventas arriba de 100%, que se lee
 * como «buenísimo» y no como «esto está mal sumado».
 */
export async function getInvoiceKPIs(
  businessId: string,
  from?: string,
  to?: string,
): Promise<InvoiceKPIs> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  let query = service
    .from("invoices")
    .select("total_cents, status, tipo_comprobante")
    .eq("business_id", businessId);

  if (from) query = query.gte("created_at", from);
  if (to) query = query.lte("created_at", to);

  const { data } = await query;
  const rows = (data ?? []) as { total_cents: number; status: string; tipo_comprobante: string }[];

  let totalCents = 0;
  let count = 0;
  let countA = 0;
  let countB = 0;
  let countFailed = 0;
  let countPending = 0;
  let notasCreditoCents = 0;
  let countNotasCredito = 0;

  for (const row of rows) {
    const esNota =
      row.tipo_comprobante === "nota_credito_a" ||
      row.tipo_comprobante === "nota_credito_b";

    if (row.status === "authorized" && esNota) {
      // El importe de la NC se guarda positivo en la fila (es el mismo total
      // que la factura que anula); el signo lo pone la lectura, acá.
      notasCreditoCents += Number(row.total_cents) || 0;
      countNotasCredito++;
      continue;
    }

    // Una factura `cancelled` **tiene CAE**: `anularFactura` sólo la marca así
    // después de que la nota de crédito quedó autorizada, y anular no borra
    // nada ante ARCA — el comprobante sigue en Mis Comprobantes y en la
    // declaración. Excluirla del facturado mientras se incluía su NC era la
    // mitad que hacía dar cualquier cosa: en el flujo D5 (B anulada + NC + A)
    // el neto correcto es un ticket, y sin la B daba cero.
    if (row.status === "authorized" || row.status === "cancelled") {
      totalCents += Number(row.total_cents) || 0;
    }

    if (row.status === "authorized") {
      // Los conteos responden otra pregunta que el importe: «cuántos
      // comprobantes vigentes tengo», no «cuánto declaré». Una factura anulada
      // ya no es de nadie, así que no entra acá aunque sí entre en el neto.
      count++;
      if (row.tipo_comprobante === "factura_a") countA++;
      else countB++;
    } else if (row.status === "failed") {
      countFailed++;
    } else if (row.status === "pending") {
      countPending++;
    }
  }

  return {
    // Puede dar negativo si en el período se anuló más de lo que se facturó
    // (típico del primer día del mes con NC de ventas del mes anterior). Es un
    // dato, no un error: taparlo con un `Math.max(0, …)` sería volver a
    // maquillar el número, que es justo el bug.
    totalCents: totalCents - notasCreditoCents,
    count,
    countA,
    countB,
    countFailed,
    countPending,
    notasCreditoCents,
    countNotasCredito,
  };
}

export async function getInvoiceById(
  businessId: string,
  invoiceId: string,
): Promise<Invoice | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("invoices")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", invoiceId)
    .maybeSingle();
  return (data as Invoice) ?? null;
}

/**
 * La factura **vigente** de una orden: la que la pantalla de cobro muestra en
 * vez del formulario.
 *
 * spec 100 — antes traía cualquier comprobante `authorized` con `maybeSingle()`,
 * y una orden anulada y re-facturada tiene dos (la NC de la anulación + la
 * factura nueva). `maybeSingle()` con dos filas devuelve error y `data: null`:
 * la UI concluía "no hay comprobante" y volvía a ofrecer emitir, justo en la
 * orden que más comprobantes tenía. Una NC además nunca fue "la factura de la
 * orden".
 */
export async function getInvoiceForOrder(
  businessId: string,
  orderId: string,
): Promise<Invoice | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("invoices")
    .select("*")
    .eq("business_id", businessId)
    .eq("order_id", orderId)
    .eq("status", "authorized")
    .in("tipo_comprobante", ["factura_a", "factura_b"])
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as Invoice[])[0] ?? null;
}
