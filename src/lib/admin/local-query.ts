import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { entregadasCutoff } from "@/lib/comandas/entregadas-window";
import type { ComandaStatus, KitchenItemStatus } from "@/lib/comandas/types";

type GenericClient = SupabaseClient;

export type LocalComandaItem = {
  order_item_id: string;
  /** Producto actual del ítem (spec 049: prefill del picker "cambiar producto"). */
  product_id: string | null;
  product_name: string;
  quantity: number;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  modifiers: string[];
  kitchen_status: KitchenItemStatus;
  /** Ítem de combo / menú del día: no editable en fase 1 (spec 049). */
  is_combo: boolean;
  /**
   * Precio EFECTIVAMENTE cobrado por unidad (spec 069). El ticket de cocina no
   * lleva precios; esto es para el modal de edición del encargado.
   */
  unit_price_cents: number;
  /** Precio de catálogo si el encargado pisó el precio; null si nunca se tocó. */
  price_original_cents: number | null;
  price_override_reason: string | null;
};

export type LocalComanda = {
  id: string;
  order_id: string;
  order_number: number;
  station_id: string;
  station_name: string;
  /** Color slug del super_category (lime/orange/sky/...) si la categoría
   *  del primer item resuelve a una super con color asignado. Para el chip. */
  station_color_hint: string | null;
  batch: number;
  status: ComandaStatus;
  emitted_at: string;
  delivered_at: string | null;
  /** Spec 33: el print agent no pudo imprimir esta comanda. Se muestra como
   *  badge "⚠ No imprimió" en el kanban. Null = sin fallo pendiente. */
  print_failed_at: string | null;
  /** Spec 35: reimpresión pedida (aún no confirmada por el agente). Sostiene
   *  el estado optimista del botón Reimprimir/Reintentar. */
  reprint_requested_at: string | null;
  /** Spec 49: comanda anulada entera. Cuando está seteado, sus ítems ya están
   *  cancelados y la card se oculta (fantasma); el flag corta los botones en la
   *  ventana previa al refresh de realtime. */
  cancelled_at: string | null;
  /** Tipo de la order — "dine_in" / "delivery" / "pickup" (retiro en el local).
   *  El dine-in se rotula como Mesa N en la card. */
  delivery_type: string;
  table_label: string | null;
  /** Spec 065: salón (floor_plan) de la mesa. `null` en delivery / retiro /
   *  venta rápida de mostrador — esas comandas no pertenecen a ningún salón. */
  floor_plan_id: string | null;
  customer_name: string | null;
  /** Mozo asignado a la order (solo dine_in). El nombre se resuelve en
   *  cliente desde la lista de mozos del business. */
  mozo_id: string | null;
  items: LocalComandaItem[];
};

export type LocalStation = {
  id: string;
  name: string;
  sort_order: number;
};

/**
 * Comandas vivas del operativo. Usado por la tab "Comandas" del nuevo
 * `/admin/local`.
 *
 * No filtramos por mozo/encargado — esta vista es panorámica del operativo.
 *
 * "Activas" (pendiente | en_preparacion) se traen sin recorte temporal.
 * Las "entregado", sólo las de los últimos `ENTREGADAS_VISIBLE_MINUTES`
 * (spec 082): sirven como acuse de recibo de lo que acaba de salir, no como
 * archivo del día. El cliente aplica el MISMO corte con su reloj vivo, así que
 * una card no espera al próximo refetch para irse. El tope sigue como red de
 * seguridad para el DOM.
 */
export async function getActiveComandas(
  businessId: string,
): Promise<LocalComanda[]> {
  const supabase = (await createSupabaseServerClient()) as unknown as GenericClient;

  const entregadasDesde = entregadasCutoff().toISOString();

  // Dos queries paralelas: pendientes/en_preparacion + entregadas recientes.
  // Antes había una sola con `.or()` + `and()` anidado pero la sintaxis
  // PostgREST con timestamp ISO embebido era frágil.
  const select = `
    id, order_id, station_id, batch, status, emitted_at, delivered_at,
    print_failed_at, reprint_requested_at, cancelled_at,
    stations!inner ( name ),
    orders!inner (
      id, business_id, order_number, delivery_type, customer_name, mozo_id,
      tables!orders_table_id_fkey ( label, floor_plan_id )
    ),
    comanda_items (
      order_items (
        id, product_id, product_name, quantity, notes, cancelled_at, cancelled_reason,
        kitchen_status, is_combo_component, parent_order_item_id, daily_menu_id,
        unit_price_cents, price_original_cents, price_override_reason,
        order_item_modifiers ( modifier_name )
      )
    )
  `;

  const [activeRes, deliveredRes] = await Promise.all([
    supabase
      .from("comandas")
      .select(select)
      .eq("orders.business_id", businessId)
      .in("status", ["pendiente", "en_preparacion"])
      // spec 095 · H-32 — la columna de activas no tenía cutoff temporal (a
      // diferencia de la de entregadas) y el cobro no cierra comandas, así que
      // acumulaba tickets de mesas que pagaron hace días: en una semana «En
      // preparación» tenía 40 comandas fantasma y el cocinero dejaba de mirar la
      // pantalla. Y H-28: las anuladas no tienen nada que hacer en cocina.
      .eq("orders.lifecycle_status", "open")
      .is("cancelled_at", null)
      // FIFO: la comanda más vieja arriba. La cocina atiende por orden de
      // llegada; las recién marchadas caen al fondo de la columna.
      .order("emitted_at", { ascending: true }),
    supabase
      .from("comandas")
      .select(select)
      .eq("orders.business_id", businessId)
      .eq("status", "entregado")
      .gte("delivered_at", entregadasDesde)
      .order("delivered_at", { ascending: false })
      .limit(100),
  ]);

  if (activeRes.error) {
    console.error("getActiveComandas active", activeRes.error);
    return [];
  }
  if (deliveredRes.error) {
    console.error("getActiveComandas delivered", deliveredRes.error);
    return [];
  }
  const data = [...(activeRes.data ?? []), ...(deliveredRes.data ?? [])];

  type RawRow = {
    id: string;
    order_id: string;
    station_id: string;
    batch: number;
    status: ComandaStatus;
    emitted_at: string;
    delivered_at: string | null;
    print_failed_at: string | null;
    reprint_requested_at: string | null;
    cancelled_at: string | null;
    stations: { name: string };
    orders: {
      id: string;
      order_number: number;
      delivery_type: string;
      customer_name: string;
      mozo_id: string | null;
      tables: { label: string; floor_plan_id: string | null } | null;
    };
    comanda_items: {
      order_items: {
        id: string;
        product_id: string | null;
        product_name: string;
        quantity: number;
        notes: string | null;
        cancelled_at: string | null;
        cancelled_reason: string | null;
        kitchen_status: KitchenItemStatus;
        is_combo_component: boolean | null;
        parent_order_item_id: string | null;
        daily_menu_id: string | null;
        unit_price_cents: number;
        price_original_cents: number | null;
        price_override_reason: string | null;
        order_item_modifiers: { modifier_name: string }[] | null;
      } | null;
    }[] | null;
  };

  return ((data ?? []) as unknown as RawRow[]).map((c) => ({
    id: c.id,
    order_id: c.order_id,
    order_number: c.orders.order_number,
    station_id: c.station_id,
    station_name: c.stations.name,
    station_color_hint: null,
    batch: c.batch,
    status: c.status,
    emitted_at: c.emitted_at,
    delivered_at: c.delivered_at,
    print_failed_at: c.print_failed_at,
    reprint_requested_at: c.reprint_requested_at,
    cancelled_at: c.cancelled_at,
    delivery_type: c.orders.delivery_type,
    table_label: c.orders.tables?.label ?? null,
    floor_plan_id: c.orders.tables?.floor_plan_id ?? null,
    customer_name: c.orders.customer_name,
    mozo_id: c.orders.mozo_id,
    items: (c.comanda_items ?? [])
      .map((ci) => ci.order_items)
      .filter((it): it is NonNullable<typeof it> => Boolean(it))
      .map((it) => ({
        order_item_id: it.id,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        notes: it.notes,
        cancelled_at: it.cancelled_at,
        cancelled_reason: it.cancelled_reason,
        modifiers: (it.order_item_modifiers ?? []).map((m) => m.modifier_name),
        kitchen_status: it.kitchen_status,
        is_combo:
          Boolean(it.is_combo_component) ||
          Boolean(it.parent_order_item_id) ||
          Boolean(it.daily_menu_id),
        unit_price_cents: Number(it.unit_price_cents),
        price_original_cents:
          it.price_original_cents == null ? null : Number(it.price_original_cents),
        price_override_reason: it.price_override_reason,
      })),
  }));
}

export type PrintAgentHealth = {
  /** Último heartbeat del print agent del negocio, o `null` si nunca reportó. */
  lastSeenAt: string | null;
};

/**
 * Salud del print agent on-site (spec 35). Devuelve el último `last_seen_at`
 * del heartbeat; el cliente deriva "conectada" / "sin conexión hace X" con un
 * reloj vivo (para no depender del tiempo del server render) usando su propio
 * umbral (`PRINT_AGENT_OFFLINE_THRESHOLD_MS`, definido en `comandas-kanban.tsx`
 * para no arrastrar `server-only` al bundle). `null` = nunca reportó (agente
 * viejo sin heartbeat o nunca levantado).
 */
export async function getPrintAgentHealth(
  businessId: string,
): Promise<PrintAgentHealth> {
  const supabase = (await createSupabaseServerClient()) as unknown as GenericClient;
  const { data, error } = await supabase
    .from("print_agent_status")
    .select("last_seen_at")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) {
    console.error("getPrintAgentHealth", error);
    return { lastSeenAt: null };
  }
  return { lastSeenAt: (data as { last_seen_at: string } | null)?.last_seen_at ?? null };
}

export async function getStationsForLocal(
  businessId: string,
): Promise<LocalStation[]> {
  const supabase = (await createSupabaseServerClient()) as unknown as GenericClient;
  const { data } = await supabase
    .from("stations")
    .select("id, name, sort_order")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []) as LocalStation[];
}
