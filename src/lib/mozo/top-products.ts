import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Devuelve los `product_id`s más pedidos del business en los últimos N días,
 * ordenados desc por cantidad de líneas (no cantidad de unidades — el contador
 * es 1 por línea de pedido, así un "10 cervezas" pesa lo mismo que "1 milanesa").
 *
 * - Solo cuenta items NO cancelados (`cancelled_at is null`).
 * - Se agrupa en memoria. Para un restaurant con tráfico moderado y 30 días el
 *   set queda en miles de filas, totalmente manejable. Si crece se mueve a una
 *   vista materializada.
 * - Si no hay data histórica devuelve `[]` — el cliente lo usa para ocultar el
 *   chip "Más pedidos" en lugar de mostrar un tab vacío.
 */
export async function getTopProductIds(
  businessId: string,
  opts: { limit?: number; daysBack?: number } = {},
): Promise<string[]> {
  const limit = opts.limit ?? 10;
  const daysBack = opts.daysBack ?? 30;
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("product_id, orders!inner(business_id, created_at)")
    .eq("orders.business_id", businessId)
    .gte("orders.created_at", since)
    .is("cancelled_at", null)
    // issue #269 — las líneas hijas de un menú del día no son ventas.
    // Entran con `subtotal_cents = 0` (el precio vive en el padre), así
    // que inflan las unidades sin mover la plata: la guarnición aparece
    // como un producto vendidísimo a $0.
    .not("is_combo_component", "is", true)
    .not("product_id", "is", null);

  if (error) {
    console.error("getTopProductIds", error);
    return [];
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { product_id: string | null }[]) {
    if (!row.product_id) continue;
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}
