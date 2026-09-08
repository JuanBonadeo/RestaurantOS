/**
 * Plantillas de mensajes de WhatsApp al cliente por estado de delivery.
 *
 * Lógica pura (sin DB): dado el estado destino, el tipo de pedido y los datos
 * del pedido, produce el texto a enviar — o `null` si no corresponde enviar
 * (estado no notificable, take-away en "en camino", pedido en salón, sin
 * teléfono, o plantilla deshabilitada por el dueño).
 *
 * Spec 139 — el primer aviso ya no es `preparing`: `pending` es el **acuse**,
 * que sale al crear el pedido online. Antes, entre que el cliente pedía y que
 * el local marchaba, no le llegaba nada — justo el tramo donde el pedido está
 * esperando una decisión. El bot sigue respondiendo lo suyo por su lado.
 *
 * Placeholders soportados: {cliente} {numero} {negocio} {hora} (hora en
 * timezone del negocio). Dinero no aplica acá; horarios en timezone AR.
 */

import { formatInTimeZone } from "date-fns-tz";

export const DELIVERY_NOTIFY_STATUSES = [
  // Spec 139 — el acuse: sale al crear el pedido online, antes de que el local
  // lo confirme. Es el tramo en el que el cliente no recibía nada.
  "pending",
  "preparing",
  "ready",
  "on_the_way",
  "delivered",
  "cancelled",
  // Spec 139 — el rechazo del local. No es un estado de `orders` (por dentro es
  // `cancelled`): es un aviso propio, porque «no pudimos tomarlo» y «se
  // canceló» no son la misma noticia para el cliente.
  "rejected",
] as const;

export type DeliveryNotifyStatus = (typeof DELIVERY_NOTIFY_STATUSES)[number];

/** Etiquetas legibles por estado, para la UI de edición de plantillas. */
export const DELIVERY_STATUS_LABELS: Record<DeliveryNotifyStatus, string> = {
  pending: "Recibido, sin confirmar",
  preparing: "Preparando",
  ready: "Listo",
  on_the_way: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
  rejected: "No lo pudimos tomar",
};

export function isDeliveryNotifyStatus(
  status: string,
): status is DeliveryNotifyStatus {
  return (DELIVERY_NOTIFY_STATUSES as readonly string[]).includes(status);
}

export const DEFAULT_DELIVERY_TEMPLATES: Record<DeliveryNotifyStatus, string> = {
  pending:
    "¡Hola {cliente}! 📝 Recibimos tu pedido #{numero}. Te avisamos apenas {negocio} lo confirme.",
  preparing: "¡Hola {cliente}! 👨‍🍳 Estamos preparando tu pedido #{numero}.",
  ready: "Tu pedido #{numero} ya está listo. 🙌",
  on_the_way: "Tu pedido #{numero} salió y está en camino. 🛵",
  delivered:
    "Tu pedido #{numero} fue entregado. ¡Gracias por elegir {negocio}! 🙏",
  // issue #259 — el `{motivo}` faltaba acá y sí estaba en `rejected`, así que
  // el motivo que el encargado escribía al cancelar no llegaba a ningún lado.
  // La ayuda del panel le promete lo contrario («El motivo de cancelación lo lee
  // el cliente en el seguimiento de su pedido»), y por eso lo redacta pensando
  // en él. Sin destinatario, esa redacción no servía para nada.
  //
  // `{motivo}` se renderiza vacío cuando no hay: un cancelado sin motivo sigue
  // leyéndose bien.
  cancelled:
    "Tu pedido #{numero} fue cancelado. {motivo} Ante cualquier duda, escribinos. 🙏",
  rejected:
    "¡Hola {cliente}! No pudimos tomar tu pedido #{numero}. {motivo} Perdón, y gracias por escribirnos. 🙏",
};

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

function fillPlaceholders(
  body: string,
  vars: {
    cliente: string;
    numero: number | string;
    negocio: string;
    hora: string;
    /** Spec 139 — sólo en el rechazo; vacío en el resto. */
    motivo?: string;
  },
): string {
  return body
    .replaceAll("{cliente}", vars.cliente)
    .replaceAll("{numero}", String(vars.numero))
    .replaceAll("{negocio}", vars.negocio)
    .replaceAll("{hora}", vars.hora)
    .replaceAll("{motivo}", vars.motivo ? `Motivo: ${vars.motivo}.` : "")
    // Un placeholder vacío deja dos espacios y delata la costura.
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * ¿Corresponde notificar este cambio de estado al cliente? Reglas AGNÓSTICAS de
 * canal (spec 45): estado notificable, salón (dine_in) no recibe, take-away sin
 * "en camino". No mira el destinatario (teléfono/email) — eso lo chequea cada
 * canal por separado.
 */
export function shouldNotifyDeliveryStatus(input: {
  status: string;
  deliveryType: string;
}): input is { status: DeliveryNotifyStatus; deliveryType: string } {
  if (!isDeliveryNotifyStatus(input.status)) return false;
  if (input.deliveryType === "dine_in") return false;
  if (input.status === "on_the_way" && input.deliveryType !== "delivery") {
    return false;
  }
  return true;
}

/**
 * Texto del aviso de estado, SIN chequear el destinatario. Devuelve `null` si el
 * estado no corresponde (supresión agnóstica) o la plantilla está apagada. Sirve
 * para cualquier canal (WhatsApp o email).
 */
export function renderDeliveryBody(input: {
  status: string;
  deliveryType: string;
  customerName: string;
  orderNumber: number;
  businessName: string;
  /** Spec 139 — el motivo que escribió el encargado al rechazar. */
  motivo?: string | null;
  template?: { body: string; enabled: boolean } | null;
  timezone?: string;
  now?: Date;
}): string | null {
  if (!shouldNotifyDeliveryStatus(input)) return null;

  // Plantilla explícitamente deshabilitada por el dueño → no se envía.
  if (input.template && !input.template.enabled) return null;

  const body =
    input.template?.body?.trim() || DEFAULT_DELIVERY_TEMPLATES[input.status];

  const tz = input.timezone || DEFAULT_TZ;
  const hora = formatInTimeZone(input.now ?? new Date(), tz, "HH:mm");

  return fillPlaceholders(body, {
    cliente: input.customerName,
    numero: input.orderNumber,
    negocio: input.businessName,
    hora,
    motivo: input.motivo ?? undefined,
  });
}

export function renderDeliveryMessage(input: {
  status: string;
  /** 'delivery' | 'pickup' | 'dine_in' */
  deliveryType: string;
  customerName: string;
  customerPhone: string | null;
  orderNumber: number;
  businessName: string;
  template?: { body: string; enabled: boolean } | null;
  timezone?: string;
  now?: Date;
}): string | null {
  // Canal WhatsApp: sin teléfono válido no hay a quién mandarle.
  if (!input.customerPhone || input.customerPhone.trim().length === 0) {
    return null;
  }
  return renderDeliveryBody(input);
}
