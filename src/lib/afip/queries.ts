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
  totalCents: number;
  count: number;
  countA: number;
  countB: number;
  countFailed: number;
  countPending: number;
};

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

  for (const row of rows) {
    if (row.status === "authorized") {
      totalCents += row.total_cents;
      count++;
      if (row.tipo_comprobante === "factura_a" || row.tipo_comprobante === "nota_credito_a") countA++;
      else countB++;
    } else if (row.status === "failed") {
      countFailed++;
    } else if (row.status === "pending") {
      countPending++;
    }
  }

  return { totalCents, count, countA, countB, countFailed, countPending };
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
