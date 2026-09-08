import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { sendWhatsapp, type WhatsappSendResult } from "./whatsapp-sender";

type GenericClient = SupabaseClient;

export type WhatsappOutboxKind = "notification" | "delivery_status";

export type WhatsappTemplate = { name: string; lang: string; params: string[] };

/**
 * Encola y despacha un mensaje de WhatsApp por 360dialog.
 *
 * Best-effort: NUNCA lanza. Persiste la fila en `whatsapp_outbox` con el estado
 * final (`sent`/`failed`) y el `provider_message_id` cuando lo hay.
 *
 * Reglas:
 * - Avisos **proactivos** (`kind: "delivery_status"`) DEBEN ir como template
 *   aprobado por Meta (fuera de la ventana de 24h el texto libre se rechaza). Si
 *   no viene `template`, no se intenta enviar: queda `failed` con motivo claro.
 * - Sin teléfono destino → `failed` "sin teléfono", sin tocar la red.
 * - Si el negocio no está conectado a 360dialog, el sender devuelve "no
 *   conectado" y la fila queda `failed` — la operación que originó el aviso no
 *   se rompe igual.
 */
export async function enqueueWhatsapp(params: {
  businessId: string;
  toPhone: string | null;
  body: string;
  kind: WhatsappOutboxKind;
  refId?: string | null;
  template?: WhatsappTemplate;
}): Promise<void> {
  try {
    const result = await resolveSend(params);
    const service = createSupabaseServiceClient() as unknown as GenericClient;
    const { error } = await service.from("whatsapp_outbox").insert({
      business_id: params.businessId,
      to_phone: params.toPhone,
      body: params.body,
      kind: params.kind,
      ref_id: params.refId ?? null,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
      sent_at: result.ok ? result.sent_at : null,
      provider_message_id: result.ok ? result.messageId : null,
    });
    if (error) console.error("enqueueWhatsapp insert", error);
  } catch (err) {
    console.error("enqueueWhatsapp", err);
  }
}

/**
 * Deja constancia en `whatsapp_outbox` de un envío que ya se intentó y falló.
 *
 * Existe para las respuestas del bot: son el único camino de salida a WhatsApp
 * que no pasaba por el outbox, así que cuando Gupshup rechazaba (saldo agotado,
 * app pausada, 500) no quedaba ni una fila ni un log — el canal se caía entero
 * un viernes y no había forma de enterarse ni de reprocesar. Best-effort: nunca
 * lanza; si no puede escribir la fila, no rompe el turno.
 */
export async function recordWhatsappFailure(params: {
  businessId: string;
  toPhone: string | null;
  body: string;
  error: string;
  kind?: WhatsappOutboxKind;
}): Promise<void> {
  try {
    const service = createSupabaseServiceClient() as unknown as GenericClient;
    const { error } = await service.from("whatsapp_outbox").insert({
      business_id: params.businessId,
      to_phone: params.toPhone,
      body: params.body,
      kind: params.kind ?? "notification",
      status: "failed",
      error: params.error,
    });
    if (error) console.error("recordWhatsappFailure insert", error);
  } catch (err) {
    console.error("recordWhatsappFailure", err);
  }
}

/** Decide y ejecuta el envío según las reglas, sin tocar la DB. */
async function resolveSend(params: {
  businessId: string;
  toPhone: string | null;
  body: string;
  kind: WhatsappOutboxKind;
  template?: WhatsappTemplate;
}): Promise<WhatsappSendResult> {
  if (params.kind === "delivery_status" && !params.template) {
    return {
      ok: false,
      error: "Falta el template aprobado por Meta para este aviso.",
    };
  }
  if (!params.toPhone || params.toPhone.trim() === "") {
    return { ok: false, error: "Sin teléfono destino." };
  }
  return sendWhatsapp({
    businessId: params.businessId,
    to: params.toPhone,
    text: params.body,
    template: params.template,
  });
}
