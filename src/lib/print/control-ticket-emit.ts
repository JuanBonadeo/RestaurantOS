import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Emisión del "control de pedido" (spec 063).
 *
 * Se dispara desde `routeOrderToCocina`, que es el **único** punto por donde
 * pasa un pedido camino a cocina — las cuatro rutas (confirmar a mano, cron de
 * programados, webhook de MP, venta de mostrador) desembocan ahí. Emitir acá
 * cubre todas sin repetir la regla en cada una.
 *
 * Idempotente por el índice único parcial `print_jobs(order_id) where kind =
 * 'control'` (spec 080): marchar dos
 * veces (reintento, ticks solapados del cron, "marchar ahora" sobre algo que el
 * cron ya tomó) deja **un** solo papel.
 */
export async function emitControlTicket(
  service: SupabaseClient,
  orderId: string,
  businessId: string,
): Promise<{ emitted: boolean }> {
  const { data: order } = await service
    .from("orders")
    .select("id, business_id, delivery_type")
    .eq("id", orderId)
    .maybeSingle();

  const row = order as { business_id: string; delivery_type: string } | null;
  if (!row) return { emitted: false };
  // Defensa cross-tenant: el caller pasa el negocio, pero la verdad es la fila.
  if (row.business_id !== businessId) return { emitted: false };
  // El control es para lo que sale del local. Una venta de mostrador o un
  // pedido de mesa (`dine_in`) no lo necesita: no hay nada que llevar a ningún
  // lado ni plata que salir a cobrar.
  if (row.delivery_type !== "delivery" && row.delivery_type !== "pickup") {
    return { emitted: false };
  }

  const { error } = await service
    .from("print_jobs")
    .upsert(
      { order_id: orderId, business_id: businessId, kind: "control" },
      { onConflict: "order_id", ignoreDuplicates: true },
    );

  if (error) {
    console.error("emitControlTicket", orderId, error);
    return { emitted: false };
  }
  return { emitted: true };
}
