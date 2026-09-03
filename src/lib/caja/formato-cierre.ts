/**
 * Cuánto duró el turno que cerró un corte, en castellano (spec 149).
 *
 * Sin librería de fechas a propósito: es una diferencia entre dos instantes,
 * no una fecha en un huso — la timezone del negocio importa para *cuándo* fue
 * el cierre, no para cuánto duró.
 */
export function duracionDelTurno(desdeIso: string, hastaIso: string): string {
  const ms = new Date(hastaIso).getTime() - new Date(desdeIso).getTime();
  // Un corte anterior más nuevo que el suyo es dato corrupto, no un turno
  // negativo: se dice que no se sabe en vez de escribir "−3 h".
  if (!Number.isFinite(ms) || ms < 0) return "—";

  const minutos = Math.floor(ms / 60_000);
  if (minutos < 60) return `${minutos} m`;

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  // Los turnos largos se cuentan en días recién después de 48 h: un cierre que
  // se salteó un día sigue siendo más legible como "31 h" que como "1 d 7 h".
  if (horas >= 48) {
    const dias = Math.floor(horas / 24);
    return `${dias} d ${horas % 24} h`;
  }
  return resto === 0 ? `${horas} h` : `${horas} h ${String(resto).padStart(2, "0")} m`;
}
