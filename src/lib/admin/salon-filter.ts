/**
 * Filtro por salón del operativo (spec 065).
 *
 * Helpers **puros** compartidos por las tabs de `/admin/operacion` y por los
 * contadores de sus pills, para que la pill y la tab no puedan discrepar: un
 * badge que dice 12 sobre una tab que muestra 3 es peor que no tener badge.
 *
 * El filtro es **multi-selección** (fast-follow del 2026-07-30): el encargado
 * que cubre dos salones los marca a los dos. La lista **vacía** significa
 * «todos» — no hay un valor centinela; "no filtré nada" y "los quiero todos"
 * son lo mismo, y así el estado vacío no puede dejar la pantalla en blanco.
 */

/** Clave de la preferencia, scopeada por negocio. */
export function salonFilterStorageKey(businessId: string): string {
  return `operacion_salones_${businessId}`;
}

/**
 * ¿Esta entidad entra en la selección?
 *
 * `entitySalonId === null` = no pertenece a ningún salón (delivery, retiro,
 * mostrador, reserva sin mesa ni zona). Con la selección vacía entra; con
 * salones elegidos, no.
 */
export function matchesSalon(
  selected: readonly string[],
  entitySalonId: string | null,
): boolean {
  if (selected.length === 0) return true;
  return entitySalonId !== null && selected.includes(entitySalonId);
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

/**
 * ¿Esta reserva entra en la selección de salones? (#155)
 *
 * Igual que `matchesSalon`, **salvo** para la reserva sin salón: esa pasa
 * cualquier filtro. Es la diferencia con una comanda — el delivery no es de
 * ningún salón y nunca lo va a ser, pero la reserva sin mesa ni zona (el
 * default del modo flexible cuando se carga rápido y se asigna mesa después)
 * todavía **no** pertenece a uno: es trabajo pendiente. Esconderla del turno
 * que la tiene que sentar es peor que mostrarla de más.
 *
 * Recibe la reserva entera, no su salón ya resuelto, para que el call site no
 * pueda olvidarse del caso `null` — que es justamente el bug que arregla.
 */
export function matchesSalonReserva(
  selected: readonly string[],
  r: {
    tables?: { floor_plans?: { id: string } | null } | null;
    floor_plan_id?: string | null;
  },
): boolean {
  const salonId = reservaSalonId(r);
  return salonId === null || matchesSalon(selected, salonId);
}
