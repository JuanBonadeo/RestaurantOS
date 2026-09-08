import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/proveedores/unwrap";

// ── Performance de mozos ──────────────────────────────────────────
//
// Cada cobro guarda `attributed_mozo_id` y `tip_cents` desagregado.
// Esto permite rankear mozos por ventas atribuidas, ticket y propina.

export type MozoPerformance = {
  mozoId: string;
  name: string;
  salesCents: number; // monto cobrado atribuido (sin propina)
  tipsCents: number;
  paymentCount: number;
  tipRatePct: number; // propina / ventas
};

export type StaffPerformance = {
  mozos: MozoPerformance[];
  totalTipsCents: number;
  totalSalesCents: number;
};

export async function getMozoPerformance(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<StaffPerformance> {
  const supabase = await createSupabaseServerClient();

  // Paginado (issue #272 · hallazgo 8): PostgREST corta en 1.000 filas y no
  // avisa. Un mes de cobros de Golf pasa ese techo y el ranking se quedaba
  // congelado en los primeros mil.
  const data = await fetchAll(
    () =>
      supabase
        .from("payments")
        .select("id, attributed_mozo_id, amount_cents, tip_cents")
        .eq("business_id", businessId)
        .eq("payment_status", "paid")
        .not("attributed_mozo_id", "is", null)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .order("id"),
    "payments",
  );

  const rows = data as Array<{
    attributed_mozo_id: string;
    amount_cents: number;
    tip_cents: number;
  }>;

  const agg = new Map<
    string,
    { salesCents: number; tipsCents: number; paymentCount: number }
  >();
  let totalTipsCents = 0;
  let totalSalesCents = 0;

  for (const r of rows) {
    const id = r.attributed_mozo_id;
    const tips = Number(r.tip_cents) || 0;
    // issue #272 · hallazgo 3 — la venta es `amount − tip` (spec 098).
    //
    // La propina viaja adentro de `amount_cents` porque es plata que pasó por
    // la caja, pero no es del negocio: es del mozo. Sumándola, dos mozos que
    // vendieron exactamente lo mismo aparecían separados por lo que dejaron sus
    // mesas encima del mantel, y con `salesCents` se corrían también el ticket
    // promedio y el largo de la barra de la tarjeta — las tres cifras derivan
    // de acá, así que eran internamente consistentes y por eso nadie las
    // cruzaba. El mismo cálculo ya se había arreglado en la liquidación del
    // mozo (`caja/liquidacion-mozo.ts`), que es la pantalla del encargado.
    //
    // Se pierde el «cuánta plata movió» del mozo: si algún día hace falta, es
    // `salesCents + tipsCents`, y los dos números siguen estando.
    const sales = (Number(r.amount_cents) || 0) - tips;
    const existing = agg.get(id) ?? {
      salesCents: 0,
      tipsCents: 0,
      paymentCount: 0,
    };
    existing.salesCents += sales;
    existing.tipsCents += tips;
    existing.paymentCount += 1;
    agg.set(id, existing);
    totalTipsCents += tips;
    totalSalesCents += sales;
  }

  const mozoIds = [...agg.keys()];
  const nameById = new Map<string, string>();
  if (mozoIds.length > 0) {
    const { data: bu } = await supabase
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .in("user_id", mozoIds);
    for (const m of (bu ?? []) as {
      user_id: string;
      full_name: string | null;
    }[]) {
      if (m.full_name) nameById.set(m.user_id, m.full_name);
    }
  }

  const mozos: MozoPerformance[] = mozoIds
    .map((id) => {
      const v = agg.get(id)!;
      return {
        mozoId: id,
        name: nameById.get(id) ?? "Sin nombre",
        salesCents: v.salesCents,
        tipsCents: v.tipsCents,
        paymentCount: v.paymentCount,
        tipRatePct: v.salesCents > 0 ? (v.tipsCents / v.salesCents) * 100 : 0,
      };
    })
    .sort((a, b) => b.salesCents - a.salesCents);

  return { mozos, totalTipsCents, totalSalesCents };
}
