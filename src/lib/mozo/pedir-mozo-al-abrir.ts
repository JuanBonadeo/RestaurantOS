/**
 * ¿Al entrar a la mesa hay que preguntar el mozo? — spec 146, fast-follow.
 *
 * Pedido de Juan: *"cuando toco una mesa libre lo primero que debería aparecer
 * es el modal del selector de mozo, si está libre y no tiene ningún mozo
 * puesto"*. Es la vuelta completa del pedido de la encargada de Golf: la spec
 * 146 puso la puerta (la pastilla del header), esto la abre sola en el único
 * momento en que la respuesta no es obvia.
 *
 * **Por qué justo antes de cargar.** Desde la spec 111 la mesa se abre con el
 * **primer envío**, y ese envío auto-asigna el mozo si la mesa no tenía
 * (`enviarComanda`, FR-012): queda el que tipeó — la encargada, o la cuenta
 * `terminal` del salón.
 *
 * La plata no se congela ahí: la atribución del pago se resuelve al **cobrar**,
 * leyendo `tables.mozo_id` vivo (`deriveAttributedMozo`). O sea que corregir el
 * mozo en cualquier momento del almuerzo todavía llega a tiempo. Lo que hace
 * daño es que la auto-asignación **borra la señal**: la mesa deja de decir «Sin
 * mozo» y pasa a decir «atiende Sofía», que es una mentira plausible que nadie
 * va a ir a chequear a las once de la noche. Si llega así hasta el cobro, la
 * recaudación y la propina quedan a nombre de quien no atendió —y con la cuenta
 * `terminal`, directamente afuera del circuito de rendición— y eso ya no se
 * corrige solo.
 *
 * Preguntar al abrir es el único momento en que la respuesta es obvia y todavía
 * no hay nada escrito.
 *
 * Es una decisión de un `if`, pero decide si en hora pico aparece un modal que
 * nadie pidió. Por eso vive acá, pura y con sus casos escritos.
 */

export type PedirMozoInput = {
  /** `operational_status` **vivo** de la mesa, no el del snapshot con que se abrió. */
  estado: string;
  /** `tables.mozo_id` de esa misma mesa. */
  mozoId: string | null;
  /** Mesa de barra (spec 08): venta directa, sin mozo por diseño. */
  esBarra: boolean;
  /** `canAssignMozo(role)` — admin, encargado y la terminal del salón. */
  puedeAsignar: boolean;
  /** Cuántos mozos hay para elegir. */
  candidatos: number;
};

export function pideMozoAlAbrir({
  estado,
  mozoId,
  esBarra,
  puedeAsignar,
  candidatos,
}: PedirMozoInput): boolean {
  // Un rol que no puede asignar no ve un modal que el server le va a rechazar
  // (mismo criterio que la pastilla, spec 140).
  if (!puedeAsignar) return false;
  // Sólo la mesa **libre**: la ocupada ya tiene su historia —y casi siempre su
  // mozo—, y si hay que cambiarlo está la pastilla. Interrumpir la carga de una
  // mesa en curso con un modal sería el paso de más al revés.
  if (estado !== "libre") return false;
  // Ya tiene dueño: no hay nada que preguntar.
  if (mozoId) return false;
  // La barra vende sin mozo por diseño (spec 08).
  if (esBarra) return false;
  // Un modal vacío no es una pregunta.
  if (candidatos < 1) return false;
  return true;
}
