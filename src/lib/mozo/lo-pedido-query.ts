import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { KitchenItemStatus } from "@/lib/comandas/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type { LoPedido, LoPedidoItem } from "./lo-pedido";

type GenericClient = SupabaseClient;

type RawRow = {
  id: string;
  product_name: string;
  quantity: number;
  notes: string | null;
  unit_price_cents: number;
  subtotal_cents: number;
  seat_number: number | null;
  station_id: string | null;
  kitchen_status: KitchenItemStatus;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  is_combo_component: boolean | null;
  order_item_modifiers: { modifier_name: string }[] | null;
  comanda_items:
    | {
        comanda_id: string;
        comandas: { batch: number; emitted_at: string | null } | null;
      }[]
    | null;
};

/**
 * Todo lo que la mesa ya tiene cargado, con la comanda al lado cuando la hay
 * (spec 111). Ver `lo-pedido.ts` para por qué la fuente es la **orden** y no
 * las comandas.
 *
 * Cross-tenant por `orders.business_id`: el `orderId` llega de un caller que ya
 * validó la mesa, pero acá se vuelve a filtrar igual.
 */
export async function getLoPedido(
  orderId: string,
  businessId: string,
): Promise<LoPedido | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: order, error: orderErr } = await service
    .from("orders")
    .select(
      // `order_number` es el número que el local canta en voz alta («la 25»).
      // Faltaba acá y el objeto se devuelve con un cast, así que el header de
      // la mesa mostraba "Orden #" a secas sin que el compilador dijera nada.
      "id, order_number, subtotal_cents, discount_cents, tip_cents, total_cents, party_size",
    )
    .eq("id", orderId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (orderErr) {
    console.error("getLoPedido order", orderErr);
    return null;
  }
  if (!order) return null;

  const { data, error } = await service
    .from("order_items")
    .select(
      `
      id, product_name, quantity, notes,
      unit_price_cents, subtotal_cents, seat_number, station_id,
      kitchen_status, cancelled_at, cancelled_reason, is_combo_component,
      order_item_modifiers ( modifier_name ),
      comanda_items ( comanda_id, comandas ( batch, emitted_at ) )
    `,
    )
    .eq("order_id", orderId);
  if (error) {
    console.error("getLoPedido items", error);
    return null;
  }

  const items: LoPedidoItem[] = ((data ?? []) as unknown as RawRow[])
    // Los componentes de un combo/menú del día no son líneas propias: ya están
    // adentro del padre y con precio 0. Mismo criterio que la cuenta y el
    // detalle de pedido.
    .filter((row) => !row.is_combo_component)
    .map((row) => {
      // Un `order_item` va a una sola comanda; el array es la forma que devuelve
      // PostgREST para la relación.
      const link = (row.comanda_items ?? [])[0] ?? null;
      return {
        order_item_id: row.id,
        product_name: row.product_name,
        quantity: row.quantity,
        notes: row.notes,
        modifiers: (row.order_item_modifiers ?? []).map((m) => m.modifier_name),
        unit_price_cents: Number(row.unit_price_cents),
        subtotal_cents: Number(row.subtotal_cents),
        seat_number: row.seat_number,
        station_id: row.station_id,
        kitchen_status: row.kitchen_status,
        cancelled_at: row.cancelled_at,
        cancelled_reason: row.cancelled_reason,
        comanda_id: link?.comanda_id ?? null,
        batch: link?.comandas?.batch ?? null,
        emitted_at: link?.comandas?.emitted_at ?? null,
      };
    });

  const o = order as unknown as {
    id: string;
    order_number: number;
    subtotal_cents: number;
    discount_cents: number | null;
    tip_cents: number | null;
    total_cents: number;
    party_size: number | null;
  };
  return {
    order_id: o.id,
    order_number: o.order_number,
    items,
    party_size: o.party_size,
    subtotal_cents: Number(o.subtotal_cents),
    discount_cents: Number(o.discount_cents ?? 0),
    tip_cents: Number(o.tip_cents ?? 0),
    total_cents: Number(o.total_cents),
  };
}
