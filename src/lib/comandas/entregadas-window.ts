/**
 * Ventana de visibilidad de las comandas ENTREGADAS en el KDS (spec 082).
 *
 * La columna "Entregadas" mostraba todo lo que salió en el día operativo (tope
 * 100). En un servicio real eso la convierte en un archivo: a media tarde son
 * decenas de cards que nadie mira y que empujan hacia abajo lo único accionable
 * (una entrega recién marcada, un fallo de impresión). Una comanda entregada
 * sirve como acuse de recibo — "sí, eso ya salió" — y ese valor se agota a los
 * minutos. Pasada la ventana se oculta sola.
 *
 * Funciones puras, sin reloj propio: el `now` entra por parámetro. Así el
 * cliente re-evalúa con su ticker (la card se va sin esperar refetch) y el
 * server aplica el mismo corte en la query, sin que las dos mitades se
 * contradigan.
 */

/** Minutos que una comanda entregada sigue visible en el kanban. */
export const ENTREGADAS_VISIBLE_MINUTES = 30;

const ENTREGADAS_VISIBLE_MS = ENTREGADAS_VISIBLE_MINUTES * 60_000;

/**
 * Momento a partir del cual una comanda entregada sigue siendo visible.
 * Ventana RODANTE, no del día: a las 00:10 sigue mostrando lo que salió 23:55
 * (el local sirve pasada la medianoche; el KDS no tiene por qué vaciarse ahí).
 */
export function entregadasCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ENTREGADAS_VISIBLE_MS);
}

/**
 * ¿Esta comanda entregada sigue dentro de la ventana?
 *
 * `delivered_at` nulo o inválido = no visible: la columna se ordena y se corta
 * por esa hora, así que sin ella no hay forma de saber si es de recién. Justo
 * en el límite sigue visible — se oculta al PASARSE de la ventana, no al
 * llegar.
 */
export function isEntregadaVisible(
  deliveredAt: string | null,
  now: number,
): boolean {
  if (!deliveredAt) return false;
  const t = new Date(deliveredAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t <= ENTREGADAS_VISIBLE_MS;
}
