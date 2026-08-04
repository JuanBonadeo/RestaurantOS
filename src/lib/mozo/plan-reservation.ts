/**
 * Cuánto antes de su hora una reserva empieza a dibujarse sobre la mesa del
 * plano. El plano es la foto del **ahora**: una reserva de las 21 vista a las
 * 12 no dice nada útil y hace leer como "tomada" una mesa que está libre todo
 * el mediodía (pedido de Juan, issue #117).
 */
export const VENTANA_RESERVA_EN_PLANO_MS = 3 * 60 * 60 * 1000;

export type PlanReservationRef = {
  table_id: string | null;
  starts_at: string;
  status: string;
};

/**
 * Qué reserva le toca a cada mesa **en el plano**, si es que hay alguna que
 * mostrar todavía.
 *
 * Reglas:
 * - `seated` siempre se ve: es quien está sentado ahí, aunque lo hayan sentado
 *   horas antes de su hora.
 * - Una `confirmed` entra recién cuando falta la ventana o menos. Las que ya
 *   pasaron siguen mostrándose (vienen tarde; el cron de no-show las cierra).
 * - Con varias reservas del día sobre la misma mesa gana la **próxima**, no la
 *   última: si hay 13:00 y 21:00, a las 12:30 la mesa avisa por la de las 13.
 *   Sin ninguna próxima a la vista, gana la más reciente de las pasadas.
 * - `now === null` (SSR / primer render) devuelve vacío: el server y el primer
 *   render del cliente coinciden, y ninguna reserva "aparece" mal por un tick.
 *
 * El panel de reservas y la lista de mesas del sidebar NO usan esto — ahí el
 * encargado quiere el día entero.
 */
export function planReservationsByTable<R extends PlanReservationRef>(
  reservations: R[],
  now: number | null,
): Record<string, R> {
  const out: Record<string, R> = {};
  if (now == null) return out;

  for (const r of reservations) {
    if (!r.table_id) continue;

    const startsAt = new Date(r.starts_at).getTime();
    const sentada = r.status === "seated";
    if (!sentada && startsAt - now > VENTANA_RESERVA_EN_PLANO_MS) continue;

    const actual = out[r.table_id];
    if (!actual || ganaLaNueva(actual, r, now)) out[r.table_id] = r;
  }

  return out;
}

/** ¿La candidata describe mejor el estado de la mesa que la que ya está? */
function ganaLaNueva(
  actual: PlanReservationRef,
  nueva: PlanReservationRef,
  now: number,
): boolean {
  if (actual.status === "seated") return false;
  if (nueva.status === "seated") return true;

  const a = new Date(actual.starts_at).getTime();
  const n = new Date(nueva.starts_at).getTime();
  const aFutura = a >= now;
  const nFutura = n >= now;

  // Entre una futura y una pasada, la futura: es la que hay que preparar.
  if (aFutura !== nFutura) return nFutura;
  // Dos futuras → la más cercana. Dos pasadas → la más reciente.
  return nFutura ? n < a : n > a;
}
