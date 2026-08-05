export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "on_the_way",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const FORWARD: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "preparing", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "delivered", "cancelled"],
  ready: ["on_the_way", "delivered", "cancelled"],
  on_the_way: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function isValidTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return FORWARD[from].includes(to);
}

/**
 * spec 047 — un pedido online (no dine-in) solo se manda a cocina con
 * `confirmarPedido()` → `routeOrderToCocina` (crea comandas + dispara la
 * impresión). Avanzarlo por `updateOrderStatus` (cambio de columna) lo dejaría
 * en `preparing` SIN comandas ni impresión: pérdida silenciosa. Cancelar sí se
 * permite. Devuelve true cuando el avance debe rechazarse por este motivo.
 *
 * **spec 093 — también desde `confirmed`.** La guarda original sólo miraba
 * `pending`, y eso dejaba un agujero por el que se caían los programados:
 * cuando pasa la hora, un pedido `confirmed` sale de «Próximos» y aparece en
 * «Nuevos» con un botón «Preparar». `confirmed → preparing` es una transición
 * FORWARD válida, así que el avance pasaba — y el pedido quedaba
 * **irrecuperable**: sin comandas, descartado por el cron (que ya no lo ve
 * `confirmed`) y rechazado por «Marchar ahora». El encargado apretaba el botón
 * obvio y rompía el pedido, con aviso al cliente incluido.
 */
export function isOnlinePendingAdvance(
  from: OrderStatus,
  deliveryType: string,
  to: OrderStatus,
): boolean {
  if (deliveryType === "dine_in" || to === "cancelled") return false;
  return from === "pending" || from === "confirmed";
}
