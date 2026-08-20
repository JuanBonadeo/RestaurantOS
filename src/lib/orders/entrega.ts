/**
 * Para cuándo es el pedido — lo que el encargado necesita del encargue
 * telefónico: no hace cuánto entró, sino a qué hora hay que entregarlo (#192).
 *
 * Manda la nota para cocina (`kitchen_notes`), el campo libre que el encargado
 * escribe al cargar el pedido y que sale en la comanda como «ENTREGAR …»; hoy
 * es la única forma de decir «para las 21:30», porque el selector de
 * programados de la carga a mano está apagado (spec 120). Si el pedido sí viene
 * agendado (`scheduled_at`, spec 31) usamos esa hora. Sin ninguna de las dos el
 * pedido es para ahora, y quien llama vuelve al tiempo transcurrido.
 */
export function entregaLabel(
  order: { kitchen_notes: string | null; scheduled_at: string | null },
  timezone: string,
): string | null {
  const nota = order.kitchen_notes?.trim();
  if (nota) return nota;
  if (!order.scheduled_at) return null;
  const hora = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(order.scheduled_at));
  return `${hora} hs`;
}
