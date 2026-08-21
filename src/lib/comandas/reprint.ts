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

/**
 * Encola la reimpresión del **control de pedido** (spec 125, fase C).
 *
 * El control es el papel que se lleva el repartidor: lo que hay que entregar y
 * cuánto hay que cobrar. Se emite una sola vez, al marchar (`print_jobs`, único
 * parcial `where kind = 'control'`), así que editar el pedido después lo dejaba
 * viejo y nadie lo volvía a emitir — el repartidor salía con el papel anterior.
 *
 * No hace falta reemitir nada: el contenido del control **se arma al vuelo**
 * desde `orders` + `order_items` en cada `GET /api/print-agent`, y ese GET ya
 * sirve los jobs con `reprint_requested_at` seteado. Alcanza con levantar el
 * flag.
 *
 * Una mesa no tiene control (`emitControlTicket` sólo lo emite para
 * delivery/pickup), así que ahí esto no encuentra fila y es un no-op.
 *
 * Best-effort, igual que su hermana: el papel no puede voltear la edición.
 */
export async function encolarReimpresionDeControl(
  service: GenericClient,
  orderId: string,
): Promise<void> {
  const { error } = await service
    .from("print_jobs")
    .update({
      reprint_requested_at: new Date().toISOString(),
      print_failed_at: null,
    })
    .eq("order_id", orderId)
    .eq("kind", "control");
  if (error) console.error("encolarReimpresionDeControl", error);
}
