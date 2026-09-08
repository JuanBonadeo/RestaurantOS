import "server-only";

import { acumularLibroIva, type FilaComprobante } from "@/lib/afip/libro-iva";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── Facturación fiscal (AFIP) ─────────────────────────────────────

export type FiscalSummary = {
  invoicedCents: number; // total autorizado (facturado)
  ivaCents: number; // IVA generado
  netSalesCents: number; // ventas del período (base de comparación)
  invoicedRatePct: number | null; // facturado / ventas
  authorizedCount: number;
  pendingCount: number;
  failedCount: number;
};

export async function getFiscalSummary(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<FiscalSummary> {
  const supabase = await createSupabaseServerClient();

  const [invoicesRes, ordersRes] = await Promise.all([
    supabase
      .from("invoices")
      // `tipo_comprobante` es lo que faltaba: sin él una nota de crédito es
      // indistinguible de una factura y suma con signo positivo.
      .select("total_cents, iva_cents, status, tipo_comprobante")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase
      .from("orders")
      .select("total_cents, tip_cents")
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      // spec 091 — sin el segundo eje el denominador incluía las mesas anuladas
      // (que quedan en `pending` y conservan su `total_cents`): «Facturaste el
      // 68% de tus ventas» cuando el real era 82%.
      .neq("lifecycle_status", "cancelled")
      .gte("created_at", startIso)
      .lt("created_at", endIso),
  ]);

  // #274·5, la mitad que quedó viva: esto agregaba por `status === 'authorized'`
  // sin mirar nunca el tipo, así que **cada nota de crédito sumaba en vez de
  // restar** — en el facturado y en el IVA. Y como el denominador (las ventas)
  // estaba bien, el ratio facturado/ventas de /admin/reportes daba arriba de
  // 100% en cualquier período con una anulación, que se lee como «facturamos
  // todo» y no como «esto está mal sumado».
  //
  // `getInvoiceKPIs` tenía el mismo bug y se arregló en la ronda anterior. La
  // regla ahora vive una sola vez, en `libro-iva.ts`, y la usan los dos.
  const libro = acumularLibroIva((invoicesRes.data ?? []) as FilaComprobante[]);
  const invoicedCents = libro.netoCents;
  const ivaCents = libro.ivaCents;
  const authorizedCount = libro.count;
  const pendingCount = libro.countPending;
  const failedCount = libro.countFailed;

  let netSalesCents = 0;
  for (const o of ordersRes.data ?? []) {
    const row = o as { total_cents: number; tip_cents: number | null };
    netSalesCents += (Number(row.total_cents) || 0) - (Number(row.tip_cents) || 0);
  }

  return {
    invoicedCents,
    ivaCents,
    netSalesCents,
    invoicedRatePct:
      netSalesCents > 0 ? (invoicedCents / netSalesCents) * 100 : null,
    authorizedCount,
    pendingCount,
    failedCount,
  };
}

// ── Marketing ROI ─────────────────────────────────────────────────

export type MarketingSummary = {
  discountsCents: number; // total resignado en descuentos
  ordersWithPromo: number;
  revenueWithPromoCents: number;
  campaignsSent: number;
  campaignsRedeemed: number;
  redemptionRatePct: number | null;
};

export async function getMarketingSummary(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<MarketingSummary> {
  const supabase = await createSupabaseServerClient();

  const [ordersRes, campaignsRes, redemptionsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("discount_cents, total_cents, tip_cents, promo_code_id")
      .eq("business_id", businessId)
      .neq("status", "cancelled")
      // spec 091 — sin el segundo eje el denominador incluía las mesas anuladas
      // (que quedan en `pending` y conservan su `total_cents`): «Facturaste el
      // 68% de tus ventas» cuando el real era 82%.
      .neq("lifecycle_status", "cancelled")
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase
      .from("campaigns")
      .select("sent_count")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase
      .from("campaign_messages")
      .select("id, campaigns!inner(business_id)")
      .eq("campaigns.business_id", businessId)
      .not("redeemed_at", "is", null)
      .gte("redeemed_at", startIso)
      .lt("redeemed_at", endIso),
  ]);

  let discountsCents = 0;
  let ordersWithPromo = 0;
  let revenueWithPromoCents = 0;
  for (const o of ordersRes.data ?? []) {
    const row = o as {
      discount_cents: number | null;
      total_cents: number;
      tip_cents: number | null;
      promo_code_id: string | null;
    };
    discountsCents += Number(row.discount_cents) || 0;
    if (row.promo_code_id) {
      ordersWithPromo += 1;
      revenueWithPromoCents +=
        Number(row.total_cents) - (Number(row.tip_cents) || 0);
    }
  }

  let campaignsSent = 0;
  for (const c of campaignsRes.data ?? []) {
    campaignsSent += Number((c as { sent_count: number }).sent_count) || 0;
  }
  const campaignsRedeemed = redemptionsRes.data?.length ?? 0;

  return {
    discountsCents,
    ordersWithPromo,
    revenueWithPromoCents,
    campaignsSent,
    campaignsRedeemed,
    redemptionRatePct:
      campaignsSent > 0 ? (campaignsRedeemed / campaignsSent) * 100 : null,
  };
}

// ── Tiempos de cocina por sector ──────────────────────────────────

export type StationTiming = {
  stationId: string;
  stationName: string;
  ticketCount: number; // comandas entregadas con tiempo medible
  avgMinutes: number;
  isBottleneck: boolean;
};

export type StationTimings = {
  stations: StationTiming[];
  overallAvgMinutes: number;
};

export async function getStationTimings(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<StationTimings> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("comandas")
    .select(
      "station_id, emitted_at, delivered_at, stations(name), orders!inner(business_id, created_at)",
    )
    .eq("orders.business_id", businessId)
    .gte("orders.created_at", startIso)
    .lt("orders.created_at", endIso)
    .not("delivered_at", "is", null);

  const agg = new Map<
    string,
    { name: string; sum: number; count: number }
  >();
  let totalSum = 0;
  let totalCount = 0;

  for (const row of data ?? []) {
    const r = row as {
      station_id: string;
      emitted_at: string;
      delivered_at: string;
      stations: { name: string } | { name: string }[] | null;
    };
    const emitted = new Date(r.emitted_at).getTime();
    const delivered = new Date(r.delivered_at).getTime();
    const minutes = (delivered - emitted) / 60000;
    if (minutes <= 0 || minutes > 240) continue; // descartar outliers
    const station = Array.isArray(r.stations) ? r.stations[0] : r.stations;
    const name = station?.name ?? "Sin sector";
    const existing = agg.get(r.station_id) ?? { name, sum: 0, count: 0 };
    existing.sum += minutes;
    existing.count += 1;
    agg.set(r.station_id, existing);
    totalSum += minutes;
    totalCount += 1;
  }

  const stationsRaw = [...agg.entries()].map(([stationId, v]) => ({
    stationId,
    stationName: v.name,
    ticketCount: v.count,
    avgMinutes: v.count > 0 ? v.sum / v.count : 0,
  }));

  const maxAvg = stationsRaw.reduce((m, s) => Math.max(m, s.avgMinutes), 0);
  const stations: StationTiming[] = stationsRaw
    .map((s) => ({ ...s, isBottleneck: s.avgMinutes === maxAvg && maxAvg > 0 }))
    .sort((a, b) => b.avgMinutes - a.avgMinutes);

  return {
    stations,
    overallAvgMinutes: totalCount > 0 ? totalSum / totalCount : 0,
  };
}
