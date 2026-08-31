/**
 * Plantillas de los avisos de reserva al cliente (spec 132).
 *
 * Lógica pura, sin DB: dado el evento y los datos de la reserva devuelve el
 * texto a enviar — o `null` si el negocio apagó ese aviso. El mismo cuerpo se
 * usa para el WhatsApp y para el preheader del mail, así el cliente lee lo
 * mismo por donde le llegue.
 *
 * Espejo de `delivery-templates.ts`. Placeholders: {cliente} {negocio} {fecha}
 * {hora} {personas} {motivo}. El motivo sólo existe en el rechazo; en el resto
 * se reemplaza por vacío y la frase se limpia (ver `squashSpaces`).
 */

/** Los cuatro momentos del ciclo de una solicitud (spec 131). */
export const RESERVATION_NOTIFY_EVENTS = [
  "requested",
  "confirmed",
  "rejected",
  "expired",
] as const;

export type ReservationNotifyEvent = (typeof RESERVATION_NOTIFY_EVENTS)[number];

/** Etiquetas para la pantalla de configuración. */
export const RESERVATION_EVENT_LABELS: Record<ReservationNotifyEvent, string> = {
  requested: "Recibimos tu pedido",
  confirmed: "Reserva confirmada",
  rejected: "Reserva rechazada",
  expired: "Pedido vencido",
};

export const DEFAULT_RESERVATION_TEMPLATES: Record<
  ReservationNotifyEvent,
  string
> = {
  requested:
    "¡Hola {cliente}! 📝 Recibimos tu pedido de reserva en {negocio} para el {fecha} a las {hora}, para {personas}. Falta que lo confirmemos — te avisamos apenas lo respondamos.",
  confirmed:
    "¡Hola {cliente}! ✅ Tu reserva en {negocio} quedó confirmada para el {fecha} a las {hora}, para {personas}. ¡Te esperamos!",
  rejected:
    "¡Hola {cliente}! No pudimos tomar tu reserva del {fecha} a las {hora}. {motivo} Escribinos y buscamos otro día u horario. 🙏",
  expired:
    "¡Hola {cliente}! Tu pedido de reserva del {fecha} a las {hora} venció sin confirmarse, así que no tenés mesa reservada. Si querés venir igual, escribinos.",
};

export function isReservationNotifyEvent(
  event: string,
): event is ReservationNotifyEvent {
  return (RESERVATION_NOTIFY_EVENTS as readonly string[]).includes(event);
}

/** "para 4 personas" / "para 1 persona" — el plural se lee mal en un aviso. */
export function personasLabel(partySize: number): string {
  return partySize === 1 ? "1 persona" : `${partySize} personas`;
}

/** Dos espacios seguidos delatan un placeholder que quedó vacío. */
function squashSpaces(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").trim();
}

export type ReservationTemplateRow = {
  body: string;
  enabled: boolean;
};

/**
 * Renderiza el cuerpo del aviso. `null` cuando el negocio apagó el evento
 * (`enabled: false`) — apagarlo apaga los dos canales, que es como se lee la
 * casilla «Enviar este aviso» en la config.
 */
export function renderReservationBody(input: {
  event: ReservationNotifyEvent;
  customerName: string;
  businessName: string;
  /** Día ya formateado en la timezone del negocio, ej. "sáb 6/9". */
  dateLabel: string;
  /** Hora ya formateada, ej. "21:00". */
  timeLabel: string;
  partySize: number;
  /** Sólo en el rechazo; sin motivo la frase se omite entera. */
  reason?: string | null;
  template?: ReservationTemplateRow | null;
}): string | null {
  if (input.template && input.template.enabled === false) return null;

  const body =
    input.template?.body?.trim() ||
    DEFAULT_RESERVATION_TEMPLATES[input.event];

  const motivo = input.reason?.trim();
  return squashSpaces(
    body
      .replaceAll("{cliente}", input.customerName)
      .replaceAll("{negocio}", input.businessName)
      .replaceAll("{fecha}", input.dateLabel)
      .replaceAll("{hora}", input.timeLabel)
      .replaceAll("{personas}", personasLabel(input.partySize))
      .replaceAll("{motivo}", motivo ? `Motivo: ${motivo}.` : ""),
  );
}

/**
 * Spec 132 · D4 — ¿este aviso sale por WhatsApp, y con qué?
 *
 * Tres respuestas distintas, y el caller las trata distinto:
 * - `null`  → el negocio apagó el evento: no sale por **ningún** canal.
 * - `undefined` → no sale por WhatsApp (sin teléfono, o sin template aprobado
 *   en Meta), pero el mail sigue su curso. Sin template el envío proactivo
 *   sólo dejaría una fila `failed` en el outbox: mejor no intentarlo.
 * - el payload → cuerpo + template listos para `dispatchCustomerMessage`.
 */
export function reservationWhatsappPayload(input: {
  /** Ya renderizado; `null` = evento apagado. */
  body: string | null;
  phone: string | null;
  templateName: string | null;
  templateLang?: string | null;
  /** Params posicionales del template: {{1}} = cliente, {{2}} = cuándo. */
  templateParams: string[];
}):
  | { body: string; template: { name: string; lang: string; params: string[] } }
  | null
  | undefined {
  if (input.body === null) return null;
  if (!input.phone || input.phone.trim() === "") return undefined;
  if (!input.templateName) return undefined;
  return {
    body: input.body,
    template: {
      name: input.templateName,
      lang: input.templateLang ?? "es_AR",
      params: input.templateParams,
    },
  };
}
