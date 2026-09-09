/**
 * Editar una línea ya enviada: qué se puede cambiar y qué de eso le importa a
 * cocina. Puro y testeable; la escritura vive en `editarItemComanda`.
 */

export type EditarItemComandaPatch = {
  quantity?: number;
  notes?: string | null;
  /** Cambiar el producto del ítem (spec 049). Re-snapshotea nombre/precio. */
  productId?: string;
  /**
   * Precio a cobrar por esta línea (spec 069). **Tres estados**:
   * - `undefined` → no se toca el precio; un override existente se conserva.
   * - `null` → **revertir** al precio de catálogo actual y limpiar las 4
   *   columnas de auditoría. No exige motivo: es deshacer, no cambiar.
   * - `number` → nuevo override; exige `priceOverrideReason`.
   */
  priceOverrideCents?: number | null;
  priceOverrideReason?: string | null;
};

/**
 * ¿La edición mueve sólo plata? (issue #283)
 *
 * Importa por el papel. Editar una línea enviada encola la reimpresión de la
 * comanda del sector, y está bien: si cambió la cantidad, el producto o la
 * aclaración, el cocinero está preparando otra cosa que la que dice su ticket.
 *
 * Pero **el precio no sale impreso en la comanda**: la de cocina no lleva
 * importes. Reimprimirla por una cortesía o una media porción es papel que no
 * dice nada nuevo y una cocina preguntándose qué le cambiaron —justo en el
 * gesto que la 069 vino a hacer barato. El control del repartidor sí se
 * reimprime igual: ése lleva cuánto hay que cobrar.
 */
export function soloCambiaElPrecio(patch: EditarItemComandaPatch): boolean {
  const tocaElPrecio = patch.priceOverrideCents !== undefined;
  const tocaLaCocina =
    patch.quantity !== undefined ||
    patch.notes !== undefined ||
    patch.productId !== undefined;
  return tocaElPrecio && !tocaLaCocina;
}
