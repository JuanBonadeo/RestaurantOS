import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Dada una agrupación de `order_item.id`s por `station_id`, crea una
 * comanda por sector con `batch` autoincremental dentro de (order, station)
 * y linkea cada item via `comanda_items`.
 *
 * Usado tanto por:
 * - `enviarComanda` (dine-in: el mozo manda items a cocina).
 * - `confirmarPedido` (delivery/take-away/web: el encargado valida y
 *   recién ahí se rutea a sectores).
 *
 * **Items sin station_id NO entran acá** — el caller los excluye del
 * `itemsByStation` y se gestionan aparte (ej: bebidas que el mozo lleva
 * directo, sin comanda impresa).
 *
 * Devuelve los ids de las comandas creadas, en el orden del Map.
 */
export async function createComandasForItems(
  service: GenericClient,
  orderId: string,
  itemsByStation: Map<string, string[]>,
): Promise<{ ok: true; comanda_ids: string[] } | { ok: false; error: string }> {
  const comandaIds: string[] = [];

  for (const [stationId, orderItemIds] of itemsByStation) {
    if (orderItemIds.length === 0) continue;

    const { data: lastBatch } = await service
      .from("comandas")
      .select("batch")
      .eq("order_id", orderId)
      .eq("station_id", stationId)
      .order("batch", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextBatch =
      ((lastBatch as { batch: number } | null)?.batch ?? 0) + 1;

    const { data: comanda, error: comandaErr } = await service
      .from("comandas")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        order_id: orderId,
        station_id: stationId,
        batch: nextBatch,
        status: "pendiente",
      } as any)
      .select("id")
      .single();
    if (comandaErr || !comanda) {
      console.error("createComandasForItems · comanda insert", comandaErr);
      return { ok: false, error: "No pudimos crear la comanda." };
    }
    const comandaId = (comanda as { id: string }).id;
    comandaIds.push(comandaId);

    const { error: linkErr } = await service.from("comanda_items").insert(
      orderItemIds.map((oid) => ({
        comanda_id: comandaId,
        order_item_id: oid,
      })),
    );
    if (linkErr) {
      console.error("createComandasForItems · link insert", linkErr);
      // La comanda ya está insertada: sin sus links queda como una comanda vacía
      // que cocina ve sin items y que el print-agent saltea (ver el filtro del
      // `GET /api/print-agent`). Se borra para sostener el invariante «toda
      // comanda tiene al menos un item».
      await service.from("comandas").delete().eq("id", comandaId);
      return { ok: false, error: "No pudimos vincular items a la comanda." };
    }
  }

  return { ok: true, comanda_ids: comandaIds };
}
