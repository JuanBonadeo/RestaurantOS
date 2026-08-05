/**
 * ¿Este pedido está muerto? (spec 091)
 *
 * `orders` tiene **dos ejes de estado ortogonales y nadie los sincroniza**:
 *
 *   - `status` — pending → confirmed → preparing → ready → on_the_way →
 *     delivered / cancelled. Mide **producción y entrega**.
 *   - `lifecycle_status` — open | closed | cancelled. Mide el **ciclo comercial
 *     de la cuenta**.
 *
 * Hasta la spec 090, cada camino de cancelación escribía uno solo: el salón
 * marcaba `lifecycle_status` y nunca `status`; el canal online, al revés. En el
 * cloud eso dejó 23 mesas anuladas que la analítica contaba como venta y 4
 * pedidos cancelados con la cuenta abierta.
 *
 * La 090 hace que de acá en adelante se escriban los dos. Este predicado es el
 * cinturón: cubre los datos históricos hasta que corra el backfill, y blinda
 * contra el próximo write-site que se olvide de un eje. Es el mismo criterio que
 * `shift-summary-loader.ts` venía usando — era **la única** lectura del repo que
 * combinaba bien los dos ejes, y de ahí salió esto.
 *
 * En consultas SQL el equivalente es encadenar los dos filtros, que se combinan
 * con AND:
 *
 * ```ts
 * .neq("status", "cancelled").neq("lifecycle_status", "cancelled")
 * ```
 */
export function isOrderDead(order: {
  status?: string | null;
  lifecycle_status?: string | null;
}): boolean {
  return order.status === "cancelled" || order.lifecycle_status === "cancelled";
}

/** Azúcar para filtros: `rows.filter(isOrderAlive)`. */
export function isOrderAlive(order: {
  status?: string | null;
  lifecycle_status?: string | null;
}): boolean {
  return !isOrderDead(order);
}
