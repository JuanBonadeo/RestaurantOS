/**
 * CUIT: normalización y formato (spec 150).
 *
 * Módulo puro y sin `server-only` a propósito: la misma normalización tiene que
 * correr en el buscador (cliente) y antes de cada query (servidor). Si el
 * cliente buscara con lo tipeado y el servidor guardara normalizado, el
 * escenario 5 de la spec —tipear "30-50023730-5" y no encontrar la entidad que
 * está guardada como "30500237305"— sería el comportamiento por defecto.
 *
 * La tabla `fiscal_entities` tiene `check (cuit ~ '^[0-9]{11}$')`: en la base
 * viven 11 dígitos y nada más. Los guiones son de la pantalla.
 */

/** Deja sólo los dígitos: "30-50023730-5" → "30500237305". */
export function normalizarCuit(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Un CUIT válido para nosotros = 11 dígitos. No se valida el dígito
 *  verificador ni el padrón de ARCA (fuera del alcance de la spec 150): el
 *  gateway rechaza el CUIT inexistente al emitir. */
export function esCuitValido(raw: string): boolean {
  return normalizarCuit(raw).length === 11;
}

/** 11 dígitos → "30-50023730-5". Lo que no tenga 11 dígitos vuelve tal cual:
 *  formatear a medias un CUIT que se está tipeando pelea con el input. */
export function formatCuit(raw: string): string {
  const digits = normalizarCuit(raw);
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
