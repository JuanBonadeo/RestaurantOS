/**
 * Alerta de mesa por comanda demorada (spec 30).
 *
 * La señal NO es "hace cuánto está la comanda" sino **cuánto se PASÓ del
 * tiempo esperado de ESE plato** — un bife tarda lo suyo, una ensalada
 * olvidada no. Así evitamos falsos positivos (umbral plano) y alarm fatigue
 * (repintar todo el salón en hora pico).
 *
 * Funciones puras, sin reloj propio: el `now` entra por parámetro para que el
 * cliente recalcule el nivel con su ticker sin refetch. Constantes fijas para
 * arrancar; configurables por negocio = segundo paso (ver design D6).
 */

/** Prep que asumimos para un producto sin `prep_time_minutes` cargado. */
export const DEFAULT_PREP_MIN = 25;
/** Cada cuántos minutos de EXCESO sube un nivel (y margen de gracia: < STEP = sin punto). */
export const STEP_MIN = 10;
/** Nivel máximo (rojo oscuro). Niveles válidos: 0 (sin punto) … MAX_LEVEL. */
export const MAX_LEVEL = 4;

/**
 * Color del punto por nivel (index = nivel). Nivel 0 = sin punto.
 * Ámbar → naranja → rojo → rojo oscuro: el color encodea **cuánto se pasó**.
 */
export const DELAY_COLORS: readonly string[] = [
  "", // 0 — sin punto
  "#f59e0b", // 1 — ámbar
  "#f97316", // 2 — naranja
  "#ef4444", // 3 — rojo
  "#991b1b", // 4 — rojo oscuro
];

/** Item de comanda con el prep_time del producto (null = sin cargar). */
export type DelayItem = { prep_time_minutes: number | null };

/** Comanda mínima para evaluar demora. */
export type DelayComanda = {
  emitted_at: string;
  delivered_at: string | null;
  station_name: string;
  items: DelayItem[];
  /** Anulada (spec 049). Opcional: no todas las fuentes lo traen. */
  cancelled_at?: string | null;
};

/** Demora calculada de una mesa (su comanda pendiente más demorada). */
export type TableDelay = {
  emittedAt: string;
  expectedMinutes: number;
  station: string;
  /** Exceso en minutos (puede ser negativo si va en hora). */
  excessMinutes: number;
  /** Nivel 0–MAX_LEVEL ya derivado del exceso. */
  level: number;
};

/**
 * Tiempo esperado de una comanda = el `prep_time_minutes` MÁS ALTO de sus
 * ítems (la comanda sale cuando está el ítem más lento). Los ítems sin tiempo
 * cargado cuentan como `fallback`. Comanda vacía → `fallback`.
 */
export function expectedComandaMinutes(
  items: DelayItem[],
  fallback: number = DEFAULT_PREP_MIN,
): number {
  if (items.length === 0) return fallback;
  return Math.max(...items.map((i) => i.prep_time_minutes ?? fallback));
}

/**
 * Exceso en minutos = transcurrido (now − emitted_at) − esperado.
 * Negativo = la comanda todavía va dentro de su tiempo esperado.
 */
export function excessMinutes(
  emittedAtIso: string,
  nowMs: number,
  expectedMinutes: number,
): number {
  const elapsedMin = (nowMs - new Date(emittedAtIso).getTime()) / 60_000;
  return elapsedMin - expectedMinutes;
}

/**
 * Nivel de alerta a partir del exceso: un escalón cada `STEP_MIN`, con tope en
 * `MAX_LEVEL`. Exceso < STEP_MIN (incl. negativo) → 0 = sin punto (margen de
 * gracia natural: no molesta por pasarse 2 min).
 */
export function delayLevel(excessMin: number): number {
  if (excessMin < STEP_MIN) return 0;
  return Math.min(MAX_LEVEL, Math.floor(excessMin / STEP_MIN));
}

/**
 * Demora de una mesa = su comanda PENDIENTE (sin `delivered_at`) con mayor
 * exceso. Devuelve `null` si no hay comandas pendientes. El consumidor filtra
 * por `level >= 1` (punto / entrada en la lista); el objeto puede venir con
 * `level 0` cuando hay pendientes pero ninguna pasada de su tiempo.
 *
 * Una comanda **anulada** no se entrega nunca (no le entra `delivered_at`), así
 * que sin este filtro la mesa quedaba pintada con una demora que crece sola
 * para siempre — y encima con `items` vacíos, o sea contra el tiempo por
 * defecto. Se ve apenas se anula desde el panel de la mesa (spec 078).
 */
export function tableDelay(
  comandas: DelayComanda[],
  nowMs: number,
  fallback: number = DEFAULT_PREP_MIN,
): TableDelay | null {
  let worst: TableDelay | null = null;
  for (const c of comandas) {
    if (c.delivered_at !== null) continue; // solo comandas pendientes
    if (c.cancelled_at) continue; // la anulada no está en cocina
    const expectedMinutes = expectedComandaMinutes(c.items, fallback);
    const excess = excessMinutes(c.emitted_at, nowMs, expectedMinutes);
    if (worst === null || excess > worst.excessMinutes) {
      worst = {
        emittedAt: c.emitted_at,
        expectedMinutes,
        station: c.station_name,
        excessMinutes: excess,
        level: delayLevel(excess),
      };
    }
  }
  return worst;
}
