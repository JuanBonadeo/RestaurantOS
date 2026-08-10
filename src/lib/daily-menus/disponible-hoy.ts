/**
 * ¿El menú del día se ofrece hoy? (spec 109)
 *
 * Un solo predicado para los dos caminos que crean pedidos —el del cliente
 * online (`persist-order`) y el del mozo (`enviarComanda`)—, porque la
 * asimetría entre ellos fue justamente el bug: el online validaba el día y el
 * del mozo no, así que una tablet abierta desde ayer, o un payload armado a
 * mano, metía el combo de otro día al precio del combo.
 *
 * Dos reglas, las dos con historia:
 *
 * 1. **El día se toma en la TZ del negocio**, nunca la del server. Con las
 *    funciones en Virginia, un sábado a las 21:00 en Argentina ya es domingo en
 *    UTC: el server ofrecería (y aceptaría) el menú del domingo mientras en el
 *    local todavía es sábado.
 * 2. **Sin días configurados, no se ofrece.** La columna arranca en `'{}'` y el
 *    listado filtra con `contains`, que sobre un array vacío no matchea nada:
 *    si acá dijéramos "sin restricción" el server aceptaría un menú que la
 *    pantalla nunca mostró.
 */
export function menuDisponibleHoy(
  availableDays: number[] | null | undefined,
  todayDow: number,
): boolean {
  return (availableDays ?? []).includes(todayDow);
}
