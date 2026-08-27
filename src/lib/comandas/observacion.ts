/**
 * La observación de la tanda (spec 128).
 *
 * Lo que el mozo escribe **una vez** al enviar y sale igual en las comandas de
 * todos los sectores de esa tanda: «va todo junto», «la mesa tiene apuro», «hay
 * un celíaco en la mesa». No es la nota de un plato —ésa es
 * `order_items.notes`— ni la del pedido —`orders.kitchen_notes`, el «ENTREGAR
 * x» que gobierna la spec 127—.
 *
 * Módulo aparte y sin `server-only` a propósito: el server la normaliza antes
 * de guardarla y el campo del mozo usa el MISMO tope para el contador, así que
 * lo que la pantalla deja escribir es exactamente lo que se guarda.
 */

/**
 * 200 caracteres.
 *
 * Alcanza para dos renglones de instrucción y acota el papel: a doble alto
 * entran 24 columnas, así que 200 son hasta ~9 renglones **en cada comanda del
 * envío**. Más que eso y la observación empieza a tapar los platos.
 */
export const OBSERVACION_MAX = 200;

/**
 * Deja la observación como se guarda: sin espacios de sobra, cortada en el
 * tope, y `null` si no quedó nada.
 *
 * El `null` importa: un string vacío en la columna haría que el ticket imprima
 * un renglón «OBS:» pelado y una línea separadora de más.
 */
export function normalizarObservacion(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const limpio = raw.trim().slice(0, OBSERVACION_MAX).trim();
  return limpio.length > 0 ? limpio : null;
}
