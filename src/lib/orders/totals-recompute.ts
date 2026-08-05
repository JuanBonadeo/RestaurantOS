import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Recalcula `orders.subtotal_cents` (suma de ítems vivos) y `total_cents`
 * (subtotal + tip + fee − discount, sin bajar de 0).
 *
 * Vivía como función privada de `comandas/actions.ts`, que es un módulo
 * `'use server'`: ahí adentro **no se puede exportar** sin convertirla en una
 * server action invocable por cualquiera desde el browser. Se mudó acá, a un
 * módulo `server-only` común, para que la use también `cancelarOrden` (spec 090)
 * sin abrir esa puerta.
 */
export async function recomputeOrderTotals(
  service: GenericClient,
  orderId: string,
): Promise<void> {
  const { data: items } = await service
    .from("order_items")
    .select("subtotal_cents, cancelled_at")
    .eq("order_id", orderId);
  const subtotal = (
    (items ?? []) as { subtotal_cents: number; cancelled_at: string | null }[]
  )
    .filter((it) => !it.cancelled_at)
    .reduce((a, it) => a + Number(it.subtotal_cents), 0);

  const { data: orderRow } = await service
    .from("orders")
    .select("tip_cents, discount_cents, delivery_fee_cents")
    .eq("id", orderId)
    .single();
  const tip = Number((orderRow as { tip_cents: number } | null)?.tip_cents ?? 0);
  const discount = Number(
    (orderRow as { discount_cents: number } | null)?.discount_cents ?? 0,
  );
  const fee = Number(
    (orderRow as { delivery_fee_cents: number } | null)?.delivery_fee_cents ?? 0,
  );
  const total = Math.max(0, subtotal + tip + fee - discount);

  await service
    .from("orders")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ subtotal_cents: subtotal, total_cents: total } as any)
    .eq("id", orderId);
}
