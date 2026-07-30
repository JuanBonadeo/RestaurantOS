/**
 * ¿Una mesa tiene consumo? (spec 071)
 *
 * Anular una mesa **con** consumo es un hecho que hay que poder auditar: se
 * está tirando comida ya pedida, y el motivo es el registro de por qué. Anular
 * una mesa a la que **no se le cargó nada** no es eso: es deshacer un click.
 * Pedir un motivo ahí es fricción pura en hora pico, y lo que se consigue son
 * motivos basura ("a", "-", "asd") que ensucian la auditoría de las que sí
 * importan.
 *
 * Puro y compartido: lo usan las dos pantallas que anulan (el salón del
 * encargado y la app del mozo) para decidir si muestran el prompt, y lo
 * re-deriva el server para decidir si el motivo es obligatorio. Las pantallas
 * lo usan para la UX; **el server manda** — un cliente con datos viejos podría
 * saltear el motivo en una mesa a la que le acaban de cargar algo.
 */

/** Motivo que se registra cuando se anula una mesa sin nada cargado. */
export const MOTIVO_MESA_SIN_CONSUMO = "Mesa sin consumo";

/**
 * Un ítem cancelado no es consumo: si se cargaron dos platos y se anularon los
 * dos, la mesa quedó igual que si nunca se hubiera tocado.
 */
export function tieneConsumo(
  items: readonly { cancelled_at: string | null }[] | null | undefined,
): boolean {
  if (!items) return false;
  return items.some((it) => it.cancelled_at === null);
}
