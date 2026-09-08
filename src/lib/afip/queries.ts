import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { acumularLibroIva, type FilaComprobante } from "./libro-iva";
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
  const rows = (data ?? []) as FilaComprobante[];

  // La regla vive en `libro-iva.ts` y no acá: `getFiscalSummary` la tenía
  // copiada con el bug original (sumaba las NC en vez de restarlas, en el
  // importe y en el IVA). Escrita una vez, los dos lectores no se pueden
  // volver a desincronizar.
  const libro = acumularLibroIva(rows);

  const {
    netoCents: totalCents,
    notasCreditoCents,
    countNotasCredito,
    count,
    countA,
    countB,
    countFailed,
    countPending,
  } = libro;

  return {
    totalCents,
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
