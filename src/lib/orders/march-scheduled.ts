import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { routeOrderToCocina } from "./route-to-cocina";
import { MAX_MARCH_LEAD_MIN, marchAtForOrder } from "./scheduled";

export type MarchDueResult = {
  considered: number;
  marched: number;
  failed: number;
  /**
   * Marchados sin una sola comanda porque ningún ítem resolvió sector (spec 093
   * · H-22). El cron descartaba `items_without_station` del resultado, así que
   * un pedido que "marchaba" sin que saliera un papel en cocina era
   * indistinguible de uno sano. El aviso al encargado lo emite
   * `routeOrderToCocina`; esto es el contador para el log del cron.
   */
  withoutComanda: number;
  /** Marchados a los que no se les pudo emitir el control de pedido. */
  controlFailed: number;
  /**
   * Encargues de hoy a los que sólo hubo que avanzarles el estado (spec 127):
   * su comanda ya se había impreso al cargarlos, así que por `routeOrderToCocina`
   * pasaron como no-op. No son un problema — son el camino normal del encargue
   * telefónico— pero conviene verlos separados en el log del cron.
   */
  advancedOnly: number;
};

type DueRow = {
  id: string;
  business_id: string;
  delivery_type: string;
  scheduled_at: string | null;
  /** Spec 127: la hora de cocina, cuando el encargado la escribió. */
  kitchen_at: string | null;
  business: {
    scheduled_march_lead_pickup_min: number | null;
    scheduled_march_lead_delivery_min: number | null;
    scheduled_march_lead_kitchen_min: number | null;
  } | null;
};

/**
 * Marcha los pedidos diferidos que ya entran en ventana. La ventana es **por
 * negocio y por tipo** (spec 061): `scheduled_at - lead <= now`, con el lead de
 * `businesses.scheduled_march_lead_{pickup,delivery}_min`.
 *
 * Qué entra (spec 047 intacto — "imprime solo lo que el local ya avaló"):
 * - `status = 'pending'` **y** `payment_status = 'paid'` → pagado por
 *   adelantado (MP aprobado), no necesita gesto humano.
 * - `status = 'confirmed'` → el encargado lo aceptó desde «Próximos»
 *   (`aceptarPedidoProgramado`). Es el camino del programado en efectivo.
 *
 * Un `pending` impago **no** se marcha nunca: se queda esperando que alguien lo
 * acepte. Sin eso, abrir el delivery programado al efectivo produciría pedidos
 * que jamás llegan a cocina.
 *
 * Multi-tenant en una pasada (service client, todos los negocios) — el patrón
 * "una función, todos los tenants" del auto-`no_show` (spec 22). A diferencia
 * de aquél (UPDATE puro en SQL), marchar crea comandas con routing por sector
 * (lógica TS), así que la dispara el cron vía un endpoint, no SQL puro
 * (`march-scheduled` route + `pg_cron`/`pg_net`). Reusa `routeOrderToCocina`,
 * que es **idempotente**: si un pedido ya tiene comandas (lo marchó "marchar
 * ahora"), es no-op.
 */
export async function marchDueScheduledOrders(
  now: Date = new Date(),
): Promise<MarchDueResult> {
  const service = createSupabaseServiceClient();

  // El filtro SQL acota con el techo del lead configurable: nada más allá de
  // `now + 240min` puede estar en ventana para ningún negocio. El corte exacto
  // se hace después, en TS, con el lead de cada pedido. El índice parcial
  // (business_id, scheduled_at) where scheduled_at is not null sirve el `lte`.
  const cutoff = new Date(
    now.getTime() + MAX_MARCH_LEAD_MIN * 60_000,
  ).toISOString();

  const { data: due } = await service
    .from("orders")
    .select(
      "id, business_id, delivery_type, scheduled_at, kitchen_at, business:businesses(scheduled_march_lead_pickup_min, scheduled_march_lead_delivery_min, scheduled_march_lead_kitchen_min)",
    )
    .in("delivery_type", ["pickup", "delivery"])
    .or("and(status.eq.pending,payment_status.eq.paid),status.eq.confirmed")
    // Spec 127 — la ventana la manda la hora de COCINA cuando está; si no, la
    // del pedido, que es el canal web. Escrito como `or` en vez de un
    // `coalesce` porque así cada rama usa su índice parcial.
    .or(
      `kitchen_at.lte.${cutoff},and(kitchen_at.is.null,scheduled_at.lte.${cutoff})`,
    );

  const rows = (due ?? []) as unknown as DueRow[];
  // `considered` = los que efectivamente entraron en ventana, no los que trajo
  // la query: el `cutoff` es deliberadamente ancho.
  const inWindow = rows.filter((o) => {
    const at = marchAtForOrder(o, o.business);
    return at !== null && at.getTime() <= now.getTime();
  });

  let marched = 0;
  let failed = 0;
  let withoutComanda = 0;
  let controlFailed = 0;
  let advancedOnly = 0;
  for (const o of inWindow) {
    try {
      const res = await routeOrderToCocina(o.id, o.business_id);
      if (!res.ok) {
        failed += 1;
        continue;
      }
      marched += 1;
      if (
        res.data.comanda_ids.length === 0 &&
        res.data.items_without_station > 0
      ) {
        withoutComanda += 1;
      }
      if (res.data.control_failed) controlFailed += 1;

      // Spec 127 — el encargue de HOY ya imprimió su comanda al cargarse, así
      // que la llamada de arriba fue no-op por idempotencia y **no le movió el
      // estado**. Lo que le falta es justamente eso: entrar al kanban. Misma
      // guarda optimista que usa `routeOrderToCocina`, para que un pedido
      // cancelado entre el SELECT y esto no reviva.
      if (res.data.already_had_comandas) {
        const { data: advanced, error } = await service
          .from("orders")
          .update({ status: "preparing" })
          .eq("id", o.id)
          .in("status", ["pending", "confirmed"])
          .select("id");
        if (error) {
          console.error("marchDueScheduledOrders · avanzar estado", o.id, error);
          failed += 1;
          marched -= 1;
        } else if ((advanced ?? []).length > 0) {
          advancedOnly += 1;
        }
      }
    } catch (e) {
      console.error("marchDueScheduledOrders · routeOrderToCocina", o.id, e);
      failed += 1;
    }
  }

  return {
    considered: inWindow.length,
    marched,
    failed,
    withoutComanda,
    controlFailed,
    advancedOnly,
  };
}
