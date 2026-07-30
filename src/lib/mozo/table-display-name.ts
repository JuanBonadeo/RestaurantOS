/**
 * Nombre del cliente sentado en una mesa (spec 067, FR-003).
 *
 * Puro y compartido: lo usa el sidebar del salón (que ya resolvía esto inline)
 * y el plano cuando el salón tiene activado «mostrar el nombre del cliente».
 * Una sola definición para que la mesa y su detalle no digan cosas distintas.
 *
 * Orden: la **reserva** manda sobre la orden — si alguien reservó a nombre de
 * Gutiérrez y lo sentaron ahí, ese es el nombre, aunque la orden se haya
 * abierto con otro dato.
 */

/**
 * Valores que `openTable` / el walk-in dejan en `orders.customer_name` cuando
 * nadie dio un nombre. Son etiquetas del sistema, no personas: mostrarlas sería
 * peor que no mostrar nada.
 */
const PLACEHOLDERS = ["mesa", "walk-in", "walkin", "-", "—", "sin nombre"];

export function isPlaceholderName(value: string | null | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v === "") return true;
  return PLACEHOLDERS.includes(v);
}

/**
 * Devuelve el nombre a mostrar, o `null` si la mesa no tiene uno de verdad
 * (walk-in anónimo). `null` es significativo: el plano cae al render de
 * siempre en vez de dejar la mesa sin etiqueta.
 */
export function tableDisplayName(
  reservation: { customer_name?: string | null } | null | undefined,
  order: { customer_name?: string | null } | null | undefined,
): string | null {
  const fromReservation = reservation?.customer_name?.trim();
  if (fromReservation && !isPlaceholderName(fromReservation)) {
    return fromReservation;
  }
  const fromOrder = order?.customer_name?.trim();
  if (fromOrder && !isPlaceholderName(fromOrder)) return fromOrder;
  return null;
}

/**
 * Recorta el nombre para que entre en el dibujo de la mesa (FR-004).
 *
 * Una mesa chica no tiene lugar para "María Fernanda Gutiérrez": se muestra la
 * primera palabra y, si aún no entra, se trunca con elipsis. Preferimos un
 * nombre parcial legible a uno completo ilegible.
 *
 * @param maxChars cuántos caracteres entran, derivado del ancho de la mesa.
 */
export function fitNameToTable(name: string, maxChars: number): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const limit = Math.max(3, Math.floor(maxChars));
  if (clean.length <= limit) return clean;

  const first = clean.split(" ")[0] ?? clean;
  if (first.length <= limit) return first;

  return `${first.slice(0, Math.max(1, limit - 1))}…`;
}
