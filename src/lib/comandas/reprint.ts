import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Encola la reimpresión del ticket «ANULADA» de las comandas **activas** que
 * contienen este ítem (spec 095 · H-36).
 *
 * Best-effort: no puede tumbar la cancelación del ítem, que es la operación que
 * el encargado pidió. Si el papel no sale, el peor caso es el de hoy.
 */
export async function encolarReimpresionDeItem(
  service: GenericClient,
  orderItemId: string,
): Promise<void> {
  const { data: links } = await service
    .from("comanda_items")
    .select("comanda_id")
    .eq("order_item_id", orderItemId);
  const comandaIds = [
    ...new Set(
      ((links ?? []) as { comanda_id: string }[]).map((l) => l.comanda_id),
    ),
  ];
  if (comandaIds.length === 0) return;

  const { error } = await service
    .from("comandas")
    .update({
      reprint_requested_at: new Date().toISOString(),
      print_failed_at: null,
    })
    .in("id", comandaIds)
    .in("status", ["pendiente", "en_preparacion"])
    .is("cancelled_at", null);
  if (error) console.error("encolarReimpresionDeItem", error);
}
