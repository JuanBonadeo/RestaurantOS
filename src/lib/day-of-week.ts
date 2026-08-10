import { formatInTimeZone } from "date-fns-tz";

/**
 * Día de la semana (0=domingo, 6=sábado) en el timezone del negocio.
 *
 * Se lee con `formatInTimeZone`, que **no depende del TZ del proceso**. La
 * versión anterior hacía `toZonedTime(now, tz).getUTCDay()`, y eso sólo acierta
 * si el proceso corre en UTC: `toZonedTime` devuelve un `Date` pensado para
 * leerse con los getters **locales**, así que en una máquina en UTC-3 un sábado
 * 21:00 en Buenos Aires daba domingo. Medido:
 *
 * | proceso | sáb 21:00 AR | dom 01:00 AR | lun 00:30 AR |
 * |---|---|---|---|
 * | UTC | ok | ok | ok |
 * | AR (UTC-3) | **domingo** | ok | ok |
 * | Tokio (UTC+9) | ok | **sábado** | **domingo** |
 *
 * En producción no se notaba —las funciones de Vercel corren en UTC— pero sí en
 * `pnpm dev` desde Argentina: el menú del día del sábado a la noche era el del
 * domingo. El formato `i` es el día ISO (1=lunes … 7=domingo); el `% 7` lo pasa
 * a la convención de `Date` (0=domingo).
 */
export function currentDayOfWeek(timezone: string, now: Date = new Date()): number {
  return Number(formatInTimeZone(now, timezone, "i")) % 7;
}

/**
 * Nombre largo del día de la semana en español, con primera mayúscula.
 * Útil para mostrar "Hoy — Lunes" en el header del menú del día.
 */
const DAY_NAMES_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

export function dayOfWeekName(dow: number): string {
  return DAY_NAMES_ES[dow] ?? "";
}
