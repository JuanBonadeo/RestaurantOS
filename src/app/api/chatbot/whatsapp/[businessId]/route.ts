import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ChatbotRateLimitedError,
  persistInboundMessage,
  runChatbot,
} from "@/lib/chatbot/agent";
import { ChatbotNotConfiguredError } from "@/lib/chatbot/config-state";
import {
  parseGupshupInbound,
  verifyGupshupToken,
} from "@/lib/notifications/whatsapp-gupshup";
import { recordWhatsappFailure } from "@/lib/notifications/whatsapp-outbox";
import { sendWhatsapp } from "@/lib/notifications/whatsapp-sender";
import { normalizePhone } from "@/lib/reservations/chatbot-actions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// Gupshup NO hace handshake GET (a diferencia de Meta). Healthcheck simple.
export async function GET() {
  return new Response("ok", { status: 200 });
}

/**
 * Webhook entrante de WhatsApp (Gupshup), por negocio (una App = un número = una
 * URL). Autentica por token compartido (Gupshup no firma), deduplica por id de
 * mensaje, ackea 200 rápido y corre el turno del bot en background.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await ctx.params;
  // Cast suelto: `whatsapp_inbound_events` y `webhook_token` viven en migraciones
  // (0006) aún no reflejadas en los tipos generados. Mismo patrón que el sender.
  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  // 1. Credenciales del negocio: token del webhook + app name (para cross-check).
  const { data: credsData } = await service
    .from("whatsapp_credentials")
    .select("webhook_token, app_name")
    .eq("business_id", businessId)
    .maybeSingle();
  const creds = credsData as {
    webhook_token: string | null;
    app_name: string | null;
  } | null;

  // 2. Auth por token compartido (Gupshup no firma con HMAC). Header
  //    `Authorization: Bearer <token>` o `?token=`. Fail-closed → 401.
  const url = new URL(req.url);
  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
  const provided = bearer ?? url.searchParams.get("token");
  if (!verifyGupshupToken(provided, creds?.webhook_token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 3. Parsear el envelope propio de Gupshup.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ping / body no-JSON → ack
  }
  const inbound = parseGupshupInbound(raw);

  // Los eventos de sistema (DLR, user-event) y los payloads que no reconocemos
  // no tienen remitente ni contenido: no hay nada que guardar ni a quién.
  if (inbound.kind !== "text" && inbound.kind !== "media") {
    return NextResponse.json({ ok: true, skipped: inbound.kind });
  }

  // Cross-check defensivo: el `app` del payload debe ser el del negocio de la URL.
  if (inbound.app && creds?.app_name && inbound.app !== creds.app_name) {
    console.warn("whatsapp webhook: app mismatch", { businessId });
    return NextResponse.json({ ok: true, skipped: "app-mismatch" });
  }

  // 4. Idempotencia: Gupshup reintenta si no ackeamos 2xx a tiempo.
  const { error: dupErr } = await service
    .from("whatsapp_inbound_events")
    .insert({
      business_id: businessId,
      provider: "gupshup",
      provider_event_id: inbound.providerEventId,
      type: "message",
    });
  if (dupErr) {
    // Sólo el 23505 (unique_violation) significa "ya lo procesamos". Cualquier
    // otro error es la base sufriendo (pool agotado, timeout, deadlock): ahí
    // hay que devolver 5xx para que Gupshup reintente. Colapsar los dos casos
    // en un 200 convertía un incidente transitorio en pérdida definitiva —y era
    // el único punto del webhook donde un 5xx es lo correcto.
    if (dupErr.code === "23505") {
      return NextResponse.json({ ok: true, skipped: "duplicate" });
    }
    console.error("whatsapp webhook: no pudimos registrar el entrante", {
      businessId,
      code: dupErr.code,
    });
    return NextResponse.json(
      { error: "inbound_not_recorded" },
      { status: 503 },
    );
  }

  // 5. Resolver slug + nombre del negocio para el agente.
  const { data: bizData } = await service
    .from("businesses")
    .select("slug, name")
    .eq("id", businessId)
    .maybeSingle();
  const business = bizData as { slug: string | null; name: string | null } | null;
  if (!business?.slug) {
    return NextResponse.json({ ok: true, skipped: "no-business" });
  }

  const businessSlug = business.slug;
  const businessName = business.name ?? businessSlug;
  const contactIdentifier = normalizePhone(inbound.phone);
  const contactDisplayName = inbound.name ?? undefined;
  const toPhone = inbound.phone;

  // 6. Media (audio, foto, ubicación): el bot no la procesa, pero se anota en la
  //    bandeja para que la atienda un humano. Antes se descartaba antes incluso
  //    del dedupe, así que no quedaba rastro de ningún tipo — y el audio es el
  //    modo natural de escribir por WhatsApp en Argentina.
  if (inbound.kind === "media") {
    const nota = describirMedia(inbound.mediaType);
    after(async () => {
      try {
        await persistInboundMessage({
          businessId,
          businessSlug,
          businessName,
          channel: "whatsapp",
          contactIdentifier,
          contactDisplayName,
          userMessage: nota,
        });
      } catch (err) {
        console.error("whatsapp webhook: no pudimos anotar el media", err);
      }
    });
    return NextResponse.json({ ok: true, skipped: "media" });
  }

  const userMessage = inbound.text;

  // 7. Ack rápido + turno en background (presupuesto <10s de Gupshup). Si el
  //    turno falla, es best-effort: Gupshup ya recibió el 200 y no reintenta —
  //    por eso `runChatbot` persiste el entrante antes que nada.
  //    Handoff (spec 32): `runChatbot` chequea `chatbot_conversations.agent_enabled`
  //    y, si el staff apagó el agente, persiste el entrante y no responde.
  after(async () => {
    try {
      await runChatbot({
        businessId,
        businessSlug,
        businessName,
        channel: "whatsapp",
        contactIdentifier,
        contactDisplayName,
        userMessage,
        // El envío va acá adentro, no después: la burbuja del bot en la bandeja
        // significa "esto le llegó al cliente". Antes el webhook mandaba después
        // de que el mensaje ya estaba persistido y descartaba el resultado (sin
        // chequear `.ok`, sin log, sin fila en la cola), así que un rechazo de
        // Gupshup dejaba la conversación como contestada y nadie lo notaba.
        deliver: async (text) => {
          const res = await sendWhatsapp({ businessId, to: toPhone, text });
          if (res.ok) return { ok: true };
          console.error("whatsapp webhook: Gupshup rechazó la respuesta", {
            businessId,
            error: res.error,
          });
          await recordWhatsappFailure({
            businessId,
            toPhone,
            body: text,
            error: res.error,
          });
          return { ok: false, error: res.error };
        },
      });
    } catch (err) {
      // Rate-limit: no respondemos (no spamear de vuelta), pero el entrante ya
      // quedó en la bandeja y dejamos rastro — el techo por negocio corta a
      // TODOS los clientes durante el resto de la ventana y antes era mudo.
      if (err instanceof ChatbotRateLimitedError) {
        console.warn("whatsapp webhook: turno cortado por rate-limit", {
          businessId,
        });
        return;
      }
      if (err instanceof ChatbotNotConfiguredError) {
        console.warn("whatsapp webhook: chatbot no configurado", { businessId });
        return;
      }
      console.error("whatsapp webhook: el turno del bot falló", err);
    }
  });

  return NextResponse.json({ ok: true });
}

/** Nota que ve la encargada en la bandeja cuando entra algo que no es texto. */
function describirMedia(mediaType: string): string {
  const nombres: Record<string, string> = {
    image: "una imagen",
    audio: "un audio",
    voice: "un audio",
    video: "un video",
    file: "un archivo",
    document: "un archivo",
    location: "una ubicación",
    contact: "un contacto",
    sticker: "un sticker",
  };
  const que = nombres[mediaType] ?? `un mensaje de tipo "${mediaType}"`;
  return `[el cliente mandó ${que} — abrilo en WhatsApp para verlo y contestale desde acá]`;
}
