"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canManageNotificationPrefs } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";
import type { BusinessRole } from "@/lib/admin/context";

import { DELIVERY_NOTIFY_STATUSES } from "./delivery-templates";
import { RESERVATION_NOTIFY_EVENTS } from "./reservation-templates";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_TARGET_ROLES,
  type NotificationChannel,
} from "./preferences";
import { notificationOrFilter, visibleTargetRoles } from "./visibility";
import { sendWhatsapp } from "./whatsapp-sender";

type GenericClient = SupabaseClient;

export async function markAllRead(
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const nowIso = new Date().toISOString();

  const { error } = await service
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("business_id", business.id)
    .is("read_at", null)
    .or(notificationOrFilter(ctx.userId, ctx.role as BusinessRole));

  if (error) {
    console.error("notifications.markAllRead", error);
    return actionError("No pudimos marcar las notificaciones.");
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin`);
  return actionOk(undefined);
}

// ── Preferencias de notificación (spec 15) ──────────────────────────────

export type NotificationPreferenceRow = {
  id: string;
  event_type: string;
  target_role: string | null;
  target_user_id: string | null;
  channel: NotificationChannel;
  enabled: boolean;
};

/**
 * Lista las preferencias de notificación del negocio. Sólo admin/encargado.
 * Las filas son los overrides explícitos; lo que no aparece usa el default
 * (in_app on) que resuelve `resolveChannels`.
 */
export async function listNotificationPreferences(
  businessSlug: string,
): Promise<ActionResult<NotificationPreferenceRow[]>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para ver la configuración de avisos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("notification_preferences")
    .select("id, event_type, target_role, target_user_id, channel, enabled")
    .eq("business_id", business.id);

  if (error) {
    console.error("listNotificationPreferences", error);
    return actionError("No pudimos cargar la configuración de avisos.");
  }
  return actionOk((data ?? []) as NotificationPreferenceRow[]);
}

const SetPreferenceInput = z
  .object({
    businessSlug: z.string().min(1),
    eventType: z.enum(NOTIFICATION_EVENT_TYPES),
    targetRole: z.enum(NOTIFICATION_TARGET_ROLES).nullish(),
    targetUserId: z.string().uuid().nullish(),
    channel: z.enum(NOTIFICATION_CHANNELS),
    enabled: z.boolean(),
  })
  .refine((v) => Boolean(v.targetRole) || Boolean(v.targetUserId), {
    message: "Falta el destinatario (rol o usuario).",
  });

/**
 * Crea o actualiza una preferencia (evento × destinatario × canal) → enabled.
 * Idempotente por destinatario+canal: si ya existe la fila, sólo cambia
 * `enabled`. Sólo admin/encargado.
 */
export async function setNotificationPreference(
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = SetPreferenceInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { businessSlug, eventType, targetRole, targetUserId, channel, enabled } =
    parsed.data;

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para configurar los avisos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Buscar la fila existente para este destinatario+canal (los índices únicos
  // son parciales, así que resolvemos el upsert a mano en lugar de onConflict).
  let lookup = service
    .from("notification_preferences")
    .select("id")
    .eq("business_id", business.id)
    .eq("event_type", eventType)
    .eq("channel", channel);
  lookup = targetRole
    ? lookup.eq("target_role", targetRole).is("target_user_id", null)
    : lookup.eq("target_user_id", targetUserId!).is("target_role", null);
  const { data: existing } = await lookup.maybeSingle();

  if (existing?.id) {
    const { error } = await service
      .from("notification_preferences")
      .update({ enabled })
      .eq("id", existing.id);
    if (error) {
      console.error("setNotificationPreference.update", error);
      return actionError("No pudimos guardar la preferencia.");
    }
  } else {
    const { error } = await service.from("notification_preferences").insert({
      business_id: business.id,
      event_type: eventType,
      target_role: targetRole ?? null,
      target_user_id: targetUserId ?? null,
      channel,
      enabled,
    });
    if (error) {
      console.error("setNotificationPreference.insert", error);
      return actionError("No pudimos guardar la preferencia.");
    }
  }

  revalidatePath(`/${businessSlug}/admin`);
  return actionOk(undefined);
}

// ── Plantillas de mensajes de delivery (spec 15) ────────────────────────

export type DeliveryTemplateRow = {
  id: string;
  status: string;
  body: string;
  enabled: boolean;
  template_name: string | null;
  template_lang: string | null;
};

/** Lista las plantillas de delivery configuradas del negocio. Admin/encargado. */
export async function listDeliveryTemplates(
  businessSlug: string,
): Promise<ActionResult<DeliveryTemplateRow[]>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para ver las plantillas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("delivery_message_templates")
    .select("id, status, body, enabled, template_name, template_lang")
    .eq("business_id", business.id);

  if (error) {
    console.error("listDeliveryTemplates", error);
    return actionError("No pudimos cargar las plantillas.");
  }
  return actionOk((data ?? []) as DeliveryTemplateRow[]);
}

const SetDeliveryTemplateInput = z.object({
  businessSlug: z.string().min(1),
  status: z.enum(DELIVERY_NOTIFY_STATUSES),
  body: z.string().trim().min(1, "El mensaje no puede estar vacío.").max(1000),
  enabled: z.boolean(),
  // Template aprobado de Meta para este estado (necesario para el envío real
  // fuera de la ventana de 24h). Opcional: sin él, el aviso queda en cola.
  templateName: z.string().trim().max(120).optional(),
  templateLang: z.string().trim().max(10).optional(),
});

/**
 * Crea o actualiza la plantilla de un estado de delivery. Upsert por
 * (negocio, estado). Sólo admin/encargado.
 */
export async function setDeliveryTemplate(
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = SetDeliveryTemplateInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { businessSlug, status, body, enabled, templateName, templateLang } =
    parsed.data;

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para editar las plantillas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("delivery_message_templates")
    .upsert(
      {
        business_id: business.id,
        status,
        body,
        enabled,
        template_name: templateName ? templateName : null,
        ...(templateLang ? { template_lang: templateLang } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,status" },
    );

  if (error) {
    console.error("setDeliveryTemplate", error);
    return actionError("No pudimos guardar la plantilla.");
  }

  revalidatePath(`/${businessSlug}/admin`);
  return actionOk(undefined);
}

// ── Plantillas de los avisos de reserva (spec 132) ──────────────────────

export type ReservationTemplateRow = {
  id: string;
  event: string;
  body: string;
  enabled: boolean;
  template_name: string | null;
  template_lang: string | null;
};

/** Lista las plantillas de reserva configuradas del negocio. Admin/encargado. */
export async function listReservationTemplates(
  businessSlug: string,
): Promise<ActionResult<ReservationTemplateRow[]>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para ver las plantillas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("reservation_message_templates")
    .select("id, event, body, enabled, template_name, template_lang")
    .eq("business_id", business.id);

  if (error) {
    console.error("listReservationTemplates", error);
    return actionError("No pudimos cargar las plantillas.");
  }
  return actionOk((data ?? []) as ReservationTemplateRow[]);
}

const SetReservationTemplateInput = z.object({
  businessSlug: z.string().min(1),
  event: z.enum(RESERVATION_NOTIFY_EVENTS),
  body: z.string().trim().min(1, "El mensaje no puede estar vacío.").max(1000),
  enabled: z.boolean(),
  // Sin `templateName` el aviso NO sale por WhatsApp (spec 132, D4): un
  // proactivo sin template aprobado por Meta sólo dejaría una fila `failed`.
  templateName: z.string().trim().max(120).optional(),
  templateLang: z.string().trim().max(10).optional(),
});

/**
 * Crea o actualiza la plantilla de un evento de reserva. Upsert por
 * (negocio, evento). Sólo admin/encargado.
 */
export async function setReservationTemplate(
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = SetReservationTemplateInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { businessSlug, event, body, enabled, templateName, templateLang } =
    parsed.data;

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para editar las plantillas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("reservation_message_templates")
    .upsert(
      {
        business_id: business.id,
        event,
        body,
        enabled,
        template_name: templateName ? templateName : null,
        ...(templateLang ? { template_lang: templateLang } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,event" },
    );

  if (error) {
    console.error("setReservationTemplate", error);
    return actionError("No pudimos guardar la plantilla.");
  }

  revalidatePath(`/${businessSlug}/admin`);
  return actionOk(undefined);
}

// ── Credenciales de 360dialog por negocio (spec 18) ─────────────────────

/** Sólo el admin del negocio (o platform) toca credenciales sensibles. */
function canManageWhatsappCreds(ctx: {
  role: string;
  isPlatformAdmin: boolean;
}): boolean {
  return ctx.role === "admin" || ctx.isPlatformAdmin;
}

export type WhatsappStatus = {
  businessId: string;
  connected: boolean;
  hasApiKey: boolean;
  hasWebhookToken: boolean;
  provider: string;
  fromPhone: string | null;
  appName: string | null;
  channelId: string | null;
};

/** Estado de conexión de WhatsApp para la UI. NUNCA devuelve el valor de la key ni del token. */
export async function getWhatsappStatus(
  businessSlug: string,
): Promise<ActionResult<WhatsappStatus>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para ver la configuración de WhatsApp.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("whatsapp_credentials")
    .select("provider, api_key, from_phone, app_name, channel_id, webhook_token")
    .eq("business_id", business.id)
    .maybeSingle();

  const row = data as {
    provider: string | null;
    api_key: string | null;
    from_phone: string | null;
    app_name: string | null;
    channel_id: string | null;
    webhook_token: string | null;
  } | null;
  const hasApiKey = Boolean(row?.api_key);
  return actionOk({
    businessId: business.id,
    connected: hasApiKey,
    hasApiKey,
    hasWebhookToken: Boolean(row?.webhook_token),
    provider: row?.provider ?? "360dialog",
    fromPhone: row?.from_phone ?? null,
    appName: row?.app_name ?? null,
    channelId: row?.channel_id ?? null,
  });
}

const SetWhatsappCredsInput = z.object({
  businessSlug: z.string().min(1),
  provider: z.enum(["360dialog", "gupshup"]).optional(),
  // Write-only: si viene vacío/ausente, se conserva la key actual.
  apiKey: z.string().trim().optional(),
  fromPhone: z.string().trim().max(40).optional(),
  // Gupshup: nombre de la App (src.name).
  appName: z.string().trim().max(120).optional(),
  // Gupshup: secreto del webhook entrante. Write-only, igual que apiKey.
  // Piso de entropía: es el ÚNICO gate del webhook inbound (Gupshup no firma), así
  // que un token corto/adivinable (ej. "golf") deja spoofear el sender.phone y
  // manipular reservas ajenas. Vacío/ausente = conservar el actual (write-only).
  webhookToken: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => v === undefined || v === "" || v.length >= 24, {
      message:
        "El token del webhook debe tener al menos 24 caracteres (si es corto, es adivinable).",
    }),
  channelId: z.string().trim().max(120).optional(),
});

/**
 * Carga/actualiza las credenciales de 360dialog del negocio (tabla
 * service-role-only). La API key es write-only: si el form la manda vacía, se
 * mantiene la existente. Actualiza `businesses.whatsapp_connected`. Sólo admin.
 */
export async function setWhatsappCredentials(
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = SetWhatsappCredsInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const {
    businessSlug,
    provider,
    apiKey,
    fromPhone,
    appName,
    webhookToken,
    channelId,
  } = parsed.data;

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageWhatsappCreds(ctxResult.data)) {
    return actionError("Sólo el dueño puede configurar las credenciales de WhatsApp.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: existing } = await service
    .from("whatsapp_credentials")
    .select("provider, api_key, from_phone, app_name, channel_id, webhook_token")
    .eq("business_id", business.id)
    .maybeSingle();
  const prev = existing as {
    provider: string | null;
    api_key: string | null;
    from_phone: string | null;
    app_name: string | null;
    channel_id: string | null;
    webhook_token: string | null;
  } | null;

  const nextProvider = provider ?? prev?.provider ?? "360dialog";
  const nextApiKey = apiKey && apiKey.length > 0 ? apiKey : (prev?.api_key ?? null);
  const nextFromPhone =
    fromPhone !== undefined ? fromPhone : (prev?.from_phone ?? null);
  const nextAppName =
    appName !== undefined ? appName : (prev?.app_name ?? null);
  // Write-only: token vacío = conservar el existente.
  const nextWebhookToken =
    webhookToken && webhookToken.length > 0
      ? webhookToken
      : (prev?.webhook_token ?? null);
  const nextChannelId =
    channelId !== undefined ? channelId : (prev?.channel_id ?? null);

  const { error: upErr } = await service.from("whatsapp_credentials").upsert(
    {
      business_id: business.id,
      provider: nextProvider,
      api_key: nextApiKey,
      from_phone: nextFromPhone,
      app_name: nextAppName,
      webhook_token: nextWebhookToken,
      channel_id: nextChannelId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (upErr) {
    console.error("setWhatsappCredentials upsert", upErr);
    return actionError("No pudimos guardar las credenciales.");
  }

  const { error: bErr } = await service
    .from("businesses")
    .update({ whatsapp_connected: Boolean(nextApiKey) })
    .eq("id", business.id);
  if (bErr) console.error("setWhatsappCredentials connected flag", bErr);

  revalidatePath(`/${businessSlug}/admin`);
  return actionOk(undefined);
}

const SendWhatsappTestInput = z.object({
  businessSlug: z.string().min(1),
  toPhone: z.string().trim().min(6, "Ingresá un número válido."),
});

/** Envía un mensaje de prueba por 360dialog para validar la conexión. Admin. */
export async function sendWhatsappTest(
  input: unknown,
): Promise<ActionResult<void>> {
  const parsed = SendWhatsappTestInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const business = await getBusiness(parsed.data.businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageWhatsappCreds(ctxResult.data)) {
    return actionError("Sólo el dueño puede probar el WhatsApp.");
  }

  const res = await sendWhatsapp({
    businessId: business.id,
    to: parsed.data.toPhone,
    text: "Mensaje de prueba de RestaurantOS ✅",
  });
  if (!res.ok) return actionError(res.error);
  return actionOk(undefined);
}

// ── Reproceso de la cola de WhatsApp (spec 18) ──────────────────────────

/**
 * Reintenta las filas de `whatsapp_outbox` en `failed`/`pending` (p. ej. tras
 * conectar 360dialog o un fallo transitorio). NO toca las `sent` (anti
 * doble-envío). Reintenta enviando el texto (`body`); los avisos proactivos
 * fuera de la ventana de 24h pueden requerir reenviarse desde su origen con
 * template. Sólo admin/encargado.
 */
export async function reprocessWhatsappOutbox(
  businessSlug: string,
): Promise<ActionResult<{ retried: number; sent: number }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canManageNotificationPrefs(ctxResult.data.role)) {
    return actionError("No tenés permisos para reprocesar la cola.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: rows, error } = await service
    .from("whatsapp_outbox")
    .select("id, to_phone, body")
    .eq("business_id", business.id)
    .in("status", ["failed", "pending"])
    .limit(100);
  if (error) {
    console.error("reprocessWhatsappOutbox select", error);
    return actionError("No pudimos leer la cola.");
  }

  let sent = 0;
  const list = (rows ?? []) as Array<{
    id: string;
    to_phone: string | null;
    body: string;
  }>;
  for (const row of list) {
    const res = row.to_phone
      ? await sendWhatsapp({
          businessId: business.id,
          to: row.to_phone,
          text: row.body,
        })
      : ({ ok: false, error: "Sin teléfono destino." } as const);
    await service
      .from("whatsapp_outbox")
      .update({
        status: res.ok ? "sent" : "failed",
        error: res.ok ? null : res.error,
        sent_at: res.ok ? res.sent_at : null,
        provider_message_id: res.ok ? res.messageId : null,
      })
      .eq("id", row.id);
    if (res.ok) sent += 1;
  }

  revalidatePath(`/${businessSlug}/admin`);
  return actionOk({ retried: list.length, sent });
}

export async function markRead(
  notifId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Cross-tenant defense + visibility check.
  const { data: notif } = await service
    .from("notifications")
    .select("id, business_id, user_id, target_role")
    .eq("id", notifId)
    .maybeSingle();
  const row = notif as
    | {
        id: string;
        business_id: string;
        user_id: string | null;
        target_role: string | null;
      }
    | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Notificación no encontrada.");
  }
  const isMine =
    row.user_id === ctx.userId ||
    (row.target_role != null &&
      visibleTargetRoles(ctx.role as BusinessRole).includes(
        row.target_role as BusinessRole,
      ));
  if (!isMine) return actionError("Notificación no encontrada.");

  const { error } = await service
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notifId);
  if (error) {
    console.error("notifications.markRead", error);
    return actionError("No pudimos marcar la notificación.");
  }

  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin`);
  return actionOk(undefined);
}
