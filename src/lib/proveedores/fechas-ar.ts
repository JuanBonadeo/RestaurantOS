/**
 * Las fechas de proveedores, siempre en hora de Buenos Aires — spec 163.
 *
 * Estas dos funciones estaban copiadas en cuatro componentes de la carpeta, y
 * el quinto —`supplier-stats.tsx`— usaba `new Date().toISOString()`, que es
 * **UTC**. Después de las 21 hs de Argentina el rango de la Estadística saltaba
 * a mañana: el encargado que mira el gasto del mes a la noche veía un día que
 * todavía no existe, y el 30 a las 21 hs el «hasta» se iba al mes siguiente.
 *
 * Una copia sola no se puede desincronizar.
 */

const AR = "America/Argentina/Buenos_Aires";

/** Hoy en Buenos Aires, `YYYY-MM-DD`. */
export function hoyAR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AR }).format(new Date());
}

/** El día 1 del mes en curso en Buenos Aires, `YYYY-MM-DD`. */
export function primerDiaDelMesAR(): string {
  return `${hoyAR().slice(0, 7)}-01`;
}

/** El mes en curso en Buenos Aires, `YYYY-MM`. */
export function mesActualAR(): string {
  return hoyAR().slice(0, 7);
}
