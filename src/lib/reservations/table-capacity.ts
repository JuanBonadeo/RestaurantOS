/**
 * Spec 081 — cuántas MESAS consumen las reservas de un servicio.
 *
 * El modo flexible contaba cupo sólo en cubiertos, y las reservas genéricas
 * (las que crea la web, sin mesa asignada) no ocupaban ninguna mesa: un salón
 * de 10 mesas podía comprometer 30 reservas sin que nada avisara. Acá se
 * calcula la ocupación real que van a tener esas reservas cuando el local
 * arme el salón, para poder topearlas.
 *
 * Es un cálculo de **capacidad**, no una asignación: no crea vínculo entre
 * reserva y mesa (eso pasa al sentar). Por eso vive suelto de la base.
 */

export type TableSeat = { id: string; seats: number };

/** Reserva viva del servicio, reducida a lo que importa para contar mesas. */
export type ReservationSeatUsage = {
  /** Mesa puntual pedida, o null si es genérica. */
  tableId: string | null;
  partySize: number;
};

/**
 * Mesas que consume `partySize` sobre las mesas libres (`freeSeats` = asientos
 * de cada mesa disponible). Estrategia:
 *
 * 1. La mesa **más chica que entre el grupo entero** — sentar 2 personas en la
 *    mesa de 8 desperdicia el salón.
 * 2. Si ninguna lo entra sola, el grupo se **parte**: se toman las mesas más
 *    grandes hasta cubrirlo (el club junta mesas; un grupo de 10 en un salón
 *    de mesas de 4 usa 3).
 *
 * Devuelve la cantidad de mesas y las que quedan libres, o `null` si no entra
 * ni sumando todas.
 */
export function assignParty(
  partySize: number,
  freeSeats: number[],
): { count: number; rest: number[] } | null {
  if (partySize <= 0) return { count: 0, rest: [...freeSeats] };

  const rest = [...freeSeats].sort((a, b) => a - b);
  let pending = partySize;
  let count = 0;

  while (pending > 0) {
    // ¿Alguna entra lo que falta? Va la más chica que lo cubra.
    const fits = rest.findIndex((s) => s >= pending);
    if (fits !== -1) {
      rest.splice(fits, 1);
      count += 1;
      break;
    }
    // Ninguna lo cubre: se corta con la más grande y sigue el resto del grupo.
    const biggest = rest.pop();
    if (biggest == null) return null; // se acabaron las mesas
    pending -= biggest;
    count += 1;
  }

  return { count, rest };
}

/**
 * Simula cómo se acomodan las reservas vivas de un servicio sobre las mesas de
 * la zona. Las que tienen mesa asignada consumen la suya; las genéricas se
 * imputan con `assignParty`.
 *
 * Los grupos grandes se acomodan **primero**: si entraran los chicos antes,
 * ocuparían mesas grandes que después le faltan al grupo de 10, y el conteo
 * daría un salón más lleno de lo que va a estar.
 *
 * Cuando las reservas exceden lo que el salón aguanta, el consumo se topea en
 * las mesas que hay (no existen mesas negativas: el salón simplemente está
 * lleno).
 */
export function simulateTableUsage(
  tables: TableSeat[],
  reservations: ReservationSeatUsage[],
): { usedCount: number; freeSeats: number[] } {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const takenIds = new Set<string>();

  const genericas: ReservationSeatUsage[] = [];
  for (const r of reservations) {
    // Una mesa de otra zona no descuenta de esta: la reserva se imputa como
    // genérica (sigue ocupando lugar en su propia zona).
    if (r.tableId && byId.has(r.tableId)) takenIds.add(r.tableId);
    else genericas.push(r);
  }

  let freeSeats = tables.filter((t) => !takenIds.has(t.id)).map((t) => t.seats);
  let usedCount = takenIds.size;

  for (const r of [...genericas].sort((a, b) => b.partySize - a.partySize)) {
    const assigned = assignParty(r.partySize, freeSeats);
    if (!assigned) {
      // No entra ni con todo lo que queda: el salón está lleno.
      usedCount += freeSeats.length;
      freeSeats = [];
      break;
    }
    usedCount += assigned.count;
    freeSeats = assigned.rest;
  }

  return { usedCount, freeSeats };
}
