import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  buildPriceOverrideRows,
  summarizeOverrides,
  type OverridesSummary,
  type PriceOverrideRow,
  type RawOverrideRow,
} from "./price-overrides";

export type PriceOverridesReport = {
  rows: PriceOverrideRow[];
  summary: OverridesSummary;
};

/**
 * Spec 069 (FR-020) — las líneas cuyo precio pisó el encargado en el período.
 *
 * Dos diferencias deliberadas con sus queries hermanas de `/admin/reportes`:
 *
 * 1. **Filtra por `price_override_at`, no por `orders.created_at`.** El
 *    encargado puede corregir hoy el precio de una mesa de ayer (US2), y lo
 *    que el reporte controla es el ACTO de cambiar el precio, no la venta.
 * 2. **El nombre del actor sale de `business_users`, no de `users`.** La RLS de
 *    `public.users` sólo deja ver tu propia fila, así que un join a `users`
 *    devolvería `null` para todos los demás **en silencio** — el reporte se
 *    vería vacío de responsables sin ningún error.
 *
 * Corre con el server client (RLS del usuario real): la policy de `order_items`
 * ya scopea por `orders.business_id`, así que no hace falta service-role.
 */
export async function getPriceOverrides(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<PriceOverridesReport> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("order_items")
    .select(
      "id, product_name, quantity, unit_price_cents, price_original_cents, price_override_at, price_override_by, price_override_reason, orders!inner(order_number, table_id, business_id, status, lifecycle_status, tables(label))",
    )
    .eq("orders.business_id", businessId)
    // Las dos columnas, porque marcan cosas distintas y ninguna implica a la
    // otra: un pedido online cancelado por el cliente escribe `status`, pero
    // anular o liberar una mesa escribe SÓLO `lifecycle_status` (ver
    // `anularMesa` / `updateTableOperationalStatus`) y no hay trigger que las
    // sincronice. Filtrando sólo por `status`, una mesa anulada con un ítem a
    // mitad de precio sumaba a «se dejó de cobrar» plata que nunca se cobró
    // ni se resignó — la orden entera se había caído.
    .neq("orders.status", "cancelled")
    .neq("orders.lifecycle_status", "cancelled")
    // Un ítem anulado no es plata resignada: no se cobró en absoluto.
    .is("cancelled_at", null)
    .not("price_override_at", "is", null)
    // Rango semiabierto, igual que el resto del reporte: gte/lt, nunca lte.
    .gte("price_override_at", startIso)
    .lt("price_override_at", endIso);

  if (error) {
    console.error("getPriceOverrides", error);
    return { rows: [], summary: { resignedCents: 0, surchargedCents: 0 } };
  }

  const raw = (data ?? []) as unknown as RawOverrideRow[];
  const actorIds = [
    ...new Set(
      raw
        .map((r) => r.price_override_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const actorNameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: members } = await supabase
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .in("user_id", actorIds);
    for (const m of (members ?? []) as {
      user_id: string;
      full_name: string | null;
    }[]) {
      const name = m.full_name?.trim();
      if (name) actorNameById.set(m.user_id, name);
    }
  }

  const rows = buildPriceOverrideRows(raw, actorNameById);
  return { rows, summary: summarizeOverrides(rows) };
}
