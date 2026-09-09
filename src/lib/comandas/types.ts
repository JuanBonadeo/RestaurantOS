/**
 * Estados de una comanda. El `listo` se quitó tras la decisión 2026-05-07
 * (cocina no usa el sistema en MVP — reciben ticket impreso, manejan
 * internamente el "listo para retirar"). Ver `wiki/decisiones/roles-mvp.md`.
 *
 *   pendiente       → recién creada, ticket todavía no impreso.
 *   en_preparacion  → impresión confirmó OK; cocina la tiene en mano.
 *   entregado       → el mozo levantó el plato y lo llevó a la mesa.
 */
export type ComandaStatus = "pendiente" | "en_preparacion" | "entregado";

export type KitchenItemStatus = "pending" | "preparing" | "ready" | "delivered";

export type Station = {
  id: string;
  business_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type Comanda = {
  id: string;
  order_id: string;
  station_id: string;
  batch: number;
  status: ComandaStatus;
  emitted_at: string;
  delivered_at: string | null;
};

/**
 * Snapshot de un order_item tal como se renderiza en el tab Comandas del panel
 * (kanban de /admin/operacion). La pantalla /cocina fue eliminada (decisión d3);
 * no es la fila completa de DB — es la proyección que necesita ese kanban.
 */
export type ComandaItemSnapshot = {
  order_item_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  notes: string | null;
  modifiers: { modifier_name: string }[];
  station_id: string | null;
  /** Precio unitario **snapshot** al cargarse (ya con el override de la spec
   *  069 aplicado, si lo hubo). La comanda de cocina no lo muestra; lo usa la
   *  columna «Lo pedido» del panel de carga (spec 111), que necesita saber
   *  cuánto va la mesa sin salir a la cuenta. */
  unit_price_cents: number;
  /** `unit_price_cents * quantity` + modificadores, como quedó guardado. */
  subtotal_cents: number;
  /**
   * Precio de CARTA de la línea si se le pisó el precio (spec 069), o `null`
   * si se cobra el de catálogo. Como `unit_price_cents`: la comanda de cocina
   * no lo imprime, lo usan las pantallas de la mesa —que muestran el cambio y
   * ofrecen deshacerlo (issue #283).
   */
  price_original_cents: number | null;
  price_override_reason: string | null;
  /** De qué menú del día viene la línea. Con valor, el precio vive en el
   *  combo y `editarItemComanda` no la deja tocar. */
  daily_menu_id: string | null;
  /** Cubierto al que va el ítem, si el pedido se cargó por comensal. */
  seat_number: number | null;
  kitchen_status: KitchenItemStatus;
  cancelled_at: string | null;
  cancelled_reason: string | null;
};

export type ComandaConItems = Comanda & {
  /** Items propios de esta comanda (mismo station_id). */
  items: ComandaItemSnapshot[];
  /**
   * Items de la misma order + mismo batch que van a OTROS sectores. Permite
   * al cocinero saber con qué se sincroniza su pieza dentro de la tanda.
   */
  combina_con: ComandaItemSnapshot[];
};
