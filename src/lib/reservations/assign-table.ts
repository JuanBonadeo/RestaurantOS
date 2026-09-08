import type { FloorTable, Reservation } from "@/lib/reservations/types";
import { LIVE_RESERVATION_STATUSES } from "@/lib/reservations/types";

export type AssignTableParams = {
  tables: FloorTable[];
  reservations: Pick<Reservation, "table_id" | "starts_at" | "ends_at" | "status">[];
  partySize: number;
  /** New reservation window — DON'T pre-add buffer; pass it via bufferMs. */
  windowStart: Date;
  windowEnd: Date;
  /** Turnover gap added to existing reservations' ends. Defaults to 0. */
  bufferMs?: number;
};

/**
 * Picks the smallest table that fits the party and has no live reservation
 * overlapping the window. "Smallest" = fewest seats; ties break by table id
 * (deterministic, so retries pick a different one than the one we just lost).
 *
 * Returns the table or null if nothing fits.
 *
 * NOTE: this is a best-effort pre-flight check. The DB exclusion constraint
 * on reservations is the source of truth for concurrent inserts; the caller
 * MUST handle 23P01 (exclusion violation) by retrying with the next smallest
 * table or returning "no hay lugar".
 */
export function pickTable(params: AssignTableParams): FloorTable | null {
  const { tables, reservations, partySize, windowStart, windowEnd, bufferMs = 0 } = params;

  const candidates = tables
    .filter((t) => t.status === "active" && t.seats >= partySize)
    .sort((a, b) => (a.seats - b.seats) || a.id.localeCompare(b.id));

  for (const table of candidates) {
    const conflict = reservations.some((r) => {
      if (r.table_id !== table.id) return false;
      if (!LIVE_RESERVATION_STATUSES.includes(r.status)) return false;
      // Buffer de rotación simétrico (spec 36 · R-E2): a ambos lados de la
      // reserva existente, para que el gap valga sin importar el orden de carga.
      const rs = new Date(new Date(r.starts_at).getTime() - bufferMs);
      const re = new Date(new Date(r.ends_at).getTime() + bufferMs);
      return rs < windowEnd && windowStart < re;
    });
    if (!conflict) return table;
  }
  return null;
}

export type IsTableAvailableParams = {
  tableId: string;
  reservations: Pick<Reservation, "id" | "table_id" | "starts_at" | "ends_at" | "status">[];
  windowStart: Date;
  windowEnd: Date;
  bufferMs?: number;
  /** When re-assigning a reservation, exclude it from the conflict check
   *  so it doesn't conflict with itself. */
  excludeReservationId?: string;
};

/**
 * Check whether a specific table is free for the given time window.
 * Used by `updateReservationTable` to pre-validate before hitting the DB.
 * The DB exclusion constraint is still the source of truth.
 */
export function isTableAvailableForReservation(params: IsTableAvailableParams): boolean {
  const { tableId, reservations, windowStart, windowEnd, bufferMs = 0, excludeReservationId } = params;

  const conflict = reservations.some((r) => {
    if (r.table_id !== tableId) return false;
    if (!LIVE_RESERVATION_STATUSES.includes(r.status)) return false;
    if (excludeReservationId && r.id === excludeReservationId) return false;
    // issue #261 — el colchón va de los DOS lados, igual que en `pickTable`.
    //
    // Acá se le sumaba sólo al final (`ends_at + buffer`) y no se le restaba al
    // principio, así que la misma mesa que el alta rebotaba, la edición la
    // tomaba: una reserva movida podía terminar exactamente cuando empieza la
    // siguiente, sin un minuto para levantar la mesa. El `buffer_min` existe
    // justamente para que la mesa rote.
    //
    // La asimetría no la tapa el GIST: el constraint mira el solape crudo de
    // las ventanas, no el colchón, que es una regla de negocio.
    const rs = new Date(new Date(r.starts_at).getTime() - bufferMs);
    const re = new Date(new Date(r.ends_at).getTime() + bufferMs);
    return rs < windowEnd && windowStart < re;
  });
  return !conflict;
}

/**
 * Same shape as pickTable but excludes a set of table ids that the caller
 * already tried (and lost the race for). Used to drive retries after a
 * 23P01 from the DB.
 */
export function pickTableExcluding(
  params: AssignTableParams,
  excludeIds: Set<string>,
): FloorTable | null {
  return pickTable({
    ...params,
    tables: params.tables.filter((t) => !excludeIds.has(t.id)),
  });
}
