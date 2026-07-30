/**
 * Filtro por salón del operativo (spec 065).
 *
 * Helpers **puros** compartidos por las tabs de `/admin/operacion` y por los
 * contadores de sus pills, para que la pill y la tab no puedan discrepar: un
 * badge que dice 12 sobre una tab que muestra 3 es peor que no tener badge.
 */

/** Valor "sin filtro" del selector de salón. */
export const SALON_ALL = "all";

/**
 * ¿Esta entidad entra en el salón elegido?
 *
 * `entitySalonId === null` = no pertenece a ningún salón (delivery, retiro,
 * mostrador, reserva sin mesa ni zona). Con «Todos» entra; con un salón
 * puntual, no.
 */
export function matchesSalon(
  filter: string,
  entitySalonId: string | null,
): boolean {
  if (filter === SALON_ALL) return true;
  return entitySalonId === filter;
}

/**
 * Salón de una reserva: el del `floor_plan` de su mesa; si no tiene mesa
 * (modo flexible, spec 059) el de su zona propia. `null` = ninguno de los dos.
 */
export function reservaSalonId(r: {
  tables?: { floor_plans?: { id: string } | null } | null;
  floor_plan_id?: string | null;
}): string | null {
  return r.tables?.floor_plans?.id ?? r.floor_plan_id ?? null;
}
