/**
 * Las horas del pedido, listas para la pantalla (spec 127).
 *
 * Un pedido puede tener dos, y son cosas distintas:
 *
 * - **La hora del pedido** (`scheduled_at`): cuándo el cliente lo retira o lo
 *   recibe. Es la que se le prometió y la que va en el board y en el ticket de
 *   control.
 * - **La hora de cocina** (`kitchen_at`): para cuándo el plato tiene que estar
 *   listo. Es la que se imprime arriba de la comanda.
 *
 * Hasta la spec 127 la primera se leía de `kitchen_notes` —el campo de texto
 * libre— porque el encargue telefónico no tenía dónde escribirla, y la nota le
 * ganaba a la hora real. Ya no: la nota volvió a ser una nota.
 */

/** `HH:MM` de un instante, en la timezone del negocio. */
export function horaLocal(iso: string, timezone: string): string {
  const hora = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return hora;
}

/**
 * Para cuándo es el pedido — lo que el encargado necesita ver en la tarjeta: no
 * hace cuánto entró, sino a qué hora hay que entregarlo (#192). `null` = es
 * para ahora, y quien llama vuelve al tiempo transcurrido.
 */
export function entregaLabel(
  order: { scheduled_at: string | null },
  timezone: string,
): string | null {
  if (!order.scheduled_at) return null;
  return `${horaLocal(order.scheduled_at, timezone)} hs`;
}

/**
 * Las dos horas juntas, para la tarjeta de «Próximos»: `21:30 · listo 21:15`.
 * Sin hora de cocina —el pedido que programó el cliente desde la web— es
 * exactamente `entregaLabel`.
 */
export function horariosLabel(
  order: { scheduled_at: string | null; kitchen_at: string | null },
  timezone: string,
): string | null {
  const pedido = entregaLabel(order, timezone);
  if (!pedido) return null;
  if (!order.kitchen_at) return pedido;
  return `${pedido} · listo ${horaLocal(order.kitchen_at, timezone)}`;
}
