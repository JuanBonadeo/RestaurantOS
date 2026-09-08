/**
 * Adapter de Gupshup (lógica pura, sin red).
 *
 * Gupshup NO usa el Cloud API de Meta: el envío es `application/x-www-form-urlencoded`
 * a `api.gupshup.io/wa/api/v1/msg` (sesión) o `.../template/msg` (template), con
 * header `apikey`. El campo `message` (sesión) y `template` (template) viajan como
 * STRING JSON dentro del form. Acá armamos esos campos y parseamos la respuesta a
 * un resultado saneado. El `fetch` real y la API key viven en `whatsapp-sender.ts`
 * — este módulo nunca ve la key.
 *
 * PUENTE TEMPORAL: Gupshup se usa hasta que verifique el gateway propio GPSF.
 */

import { timingSafeEqual } from "node:crypto";

import { normalizeWaPhone } from "./whatsapp-360dialog";

export type GupshupResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

/** Endpoints de Gupshup (override por env para apuntar al sandbox). */
const GUPSHUP_API_BASE =
  process.env.GUPSHUP_API_URL ?? "https://api.gupshup.io";
export const GUPSHUP_SESSION_URL = `${GUPSHUP_API_BASE}/wa/api/v1/msg`;
export const GUPSHUP_TEMPLATE_URL = `${GUPSHUP_API_BASE}/wa/api/v1/template/msg`;

/**
 * Form de un mensaje de sesión (texto libre, sólo válido dentro de la ventana de
 * 24h). El mensaje va como string JSON en el campo `message`.
 */
export function buildGupshupSessionForm(input: {
  source: string;
  srcName: string;
  to: string;
  text: string;
}): Record<string, string> {
  return {
    channel: "whatsapp",
    source: normalizeWaPhone(input.source),
    destination: normalizeWaPhone(input.to),
    "src.name": input.srcName,
    message: JSON.stringify({ type: "text", text: input.text }),
  };
}

/**
 * Form de un template message (avisos proactivos, fuera de la ventana de 24h).
 * Gupshup identifica la plantilla por su UUID + params posicionales.
 */
export function buildGupshupTemplateForm(input: {
  source: string;
  srcName: string;
  to: string;
  templateId: string;
  params: string[];
}): Record<string, string> {
  return {
    channel: "whatsapp",
    source: normalizeWaPhone(input.source),
    destination: normalizeWaPhone(input.to),
    "src.name": input.srcName,
    template: JSON.stringify({ id: input.templateId, params: input.params }),
  };
}

/**
 * Traduce la respuesta HTTP de Gupshup a un resultado saneado. Éxito =
 * `2xx { status: "submitted", messageId }`. Nunca incluye credenciales.
 *
 * OJO: `submitted` significa **aceptado/encolado**, no **entregado**. Las fallas
 * de entrega (saldo, no opt-in, fuera de la ventana de 24h) llegan async por el
 * webhook `message-event` (spec 039), no en esta respuesta.
 */
export function parseGupshupResponse(
  httpStatus: number,
  json: unknown,
): GupshupResult {
  const body = (json ?? {}) as {
    status?: string;
    messageId?: string;
    message?: string;
  };

  if (httpStatus >= 200 && httpStatus < 300 && body.status === "submitted") {
    return { ok: true, messageId: body.messageId ?? null };
  }

  const detail = body.message ?? body.status ?? null;
  return {
    ok: false,
    error: detail
      ? `Gupshup rechazó el envío: ${detail}`
      : `Gupshup rechazó el envío (HTTP ${httpStatus}).`,
  };
}

// ── Entrante (webhook) ──────────────────────────────────────────────────────

/**
 * Forma neutra de un evento entrante ya parseado.
 * - `text`: mensaje de texto del cliente → dispara el bot.
 * - `media`: mensaje no-texto (foto/audio/ubicación/etc) → el bot no lo procesa,
 *   pero **sí** se anota en la bandeja, así que viaja con remitente e id.
 * - `event`: message-event (DLR) / user-event / system-event → se ackea y descarta.
 * - `ignore`: cualquier otra cosa (payload no reconocido).
 */
export type GupshupInbound =
  | {
      kind: "text";
      app: string | null;
      phone: string;
      name: string | null;
      text: string;
      providerEventId: string;
    }
  | {
      kind: "media";
      app: string | null;
      phone: string;
      name: string | null;
      /** `image` | `audio` | `video` | `file` | `location` | `contact` | … */
      mediaType: string;
      providerEventId: string;
    }
  | { kind: "event" | "ignore"; app: string | null };

/**
 * Parsea el envelope propio de Gupshup:
 * `{ app, timestamp, type, payload: { id, source, type, payload, sender } }`.
 * Sólo `type === "message"` con contenido de texto dispara el bot; el resto se
 * ackea sin procesar. NO valida autenticidad (eso es `verifyGupshupToken`).
 */
export function parseGupshupInbound(raw: unknown): GupshupInbound {
  const body = (raw ?? {}) as {
    app?: string;
    type?: string;
    payload?: {
      id?: string;
      source?: string;
      type?: string;
      payload?: { text?: string; title?: string };
      sender?: { phone?: string; name?: string };
    };
  };
  const app = body.app ?? null;

  if (body.type !== "message") {
    // message-event / user-event / system-event / billing-event
    return { kind: "event", app };
  }

  const inner = body.payload ?? {};
  const providerEventId = inner.id;
  const phone = inner.sender?.phone ?? inner.source;
  // Texto directo o etiqueta de un botón quick-reply.
  const text = inner.payload?.text ?? inner.payload?.title;

  if (!providerEventId || !phone) {
    return { kind: "ignore", app };
  }
  if (inner.type !== "text" || typeof text !== "string" || text.length === 0) {
    // image/audio/video/file/location/contact → el bot no los procesa, pero el
    // webhook los anota en la bandeja para que los atienda un humano: en
    // Argentina el audio es el modo natural de escribir por WhatsApp, así que
    // descartarlos era tirar pedidos y reservas enteros.
    return {
      kind: "media",
      app,
      phone,
      name: inner.sender?.name ?? null,
      mediaType: inner.type ?? "desconocido",
      providerEventId,
    };
  }

  return {
    kind: "text",
    app,
    phone,
    name: inner.sender?.name ?? null,
    text,
    providerEventId,
  };
}

/**
 * Verifica el token compartido del webhook (Gupshup NO firma con HMAC). Compara
 * timing-safe contra el `webhook_token` del negocio. Falso si falta alguno o
 * difieren en longitud (fail-closed).
 */
export function verifyGupshupToken(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
