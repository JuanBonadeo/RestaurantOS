import "server-only";

import { formatInTimeZone } from "date-fns-tz";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { dispatchCustomerMessage } from "./customer-dispatch";
import {
  reservationConfirmedEmail,
  reservationExpiredEmail,
  reservationRejectedEmail,
  reservationReminderEmail,
  reservationRequestedEmail,
  resolveBusinessBrand,
  type BusinessBrand,
} from "./customer-email-templates";

const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

type ReservationRow = {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  party_size: number;
  starts_at: string;
  status: string;
  confirm_token: string;
};

async function loadReservationContext(reservationId: string): Promise<{
  reservation: ReservationRow;
  brand: BusinessBrand;
  slug: string;
  whenLabel: string;
} | null> {
  const service = createSupabaseServiceClient();
  const { data: reservation } = await service
    .from("reservations")
    .select(
      "id, business_id, customer_name, customer_email, customer_phone, party_size, starts_at, status, confirm_token",
    )
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation) return null;

  const { data: business } = await service
    .from("businesses")
    .select("name, slug, timezone, logo_url, address, phone, settings")
    .eq("id", reservation.business_id)
    .maybeSingle();
  if (!business) return null;

  const whenLabel = formatInTimeZone(
    new Date(reservation.starts_at),
    business.timezone ?? DEFAULT_TZ,
    "dd/MM 'a las' HH:mm 'hs'",
  );

  return {
    reservation: reservation as ReservationRow,
    brand: resolveBusinessBrand(business),
    slug: business.slug,
    whenLabel,
  };
}

/**
 * Acuse de reserva creada, al cliente, por el canal del negocio (spec 45).
 * Best-effort: nunca lanza. Sólo email hoy (no hay template de reserva por
 * WhatsApp) → negocios en `whatsapp` no reciben nada (igual que antes).
 */
export async function notifyReservationConfirmed(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const manageUrl = `${baseUrl()}/${ctx.slug}/perfil/reservas`;
    const email = reservationConfirmedEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      partySize: ctx.reservation.party_size,
      manageUrl,
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_confirmed",
      refId: ctx.reservation.id,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationConfirmed", err);
  }
}

/**
 * Spec 131 — acuse de la solicitud, al crear una reserva de cliente. Mismo
 * canal y mismo best-effort que el resto: lo único distinto es que no dice
 * "confirmada", porque todavía no lo está.
 */
export async function notifyReservationRequested(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const manageUrl = `${baseUrl()}/${ctx.slug}/perfil/reservas`;
    const email = reservationRequestedEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      partySize: ctx.reservation.party_size,
      manageUrl,
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_requested",
      refId: ctx.reservation.id,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationRequested", err);
  }
}

/** Spec 131 — el local rechazó la solicitud. Best-effort. */
export async function notifyReservationRejected(params: {
  reservationId: string;
  reason?: string | null;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const email = reservationRejectedEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      reason: params.reason ?? null,
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_rejected",
      refId: ctx.reservation.id,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationRejected", err);
  }
}

/** Spec 131 — la solicitud venció sin respuesta del local. Best-effort. */
export async function notifyReservationExpired(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;

    const email = reservationExpiredEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_expired",
      refId: ctx.reservation.id,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationExpired", err);
  }
}

/**
 * Recordatorio antes del turno, con link de confirmación de asistencia (double
 * opt-in, spec 45). Best-effort. Lo dispara el cron de recordatorios.
 */
export async function notifyReservationReminder(params: {
  reservationId: string;
}): Promise<void> {
  try {
    const ctx = await loadReservationContext(params.reservationId);
    if (!ctx) return;
    if (ctx.reservation.status !== "confirmed") return;

    const confirmUrl = `${baseUrl()}/${ctx.slug}/reservar/confirmar/${ctx.reservation.confirm_token}`;
    const email = reservationReminderEmail({
      brand: ctx.brand,
      customerName: ctx.reservation.customer_name,
      whenLabel: ctx.whenLabel,
      partySize: ctx.reservation.party_size,
      confirmUrl,
    });

    await dispatchCustomerMessage({
      businessId: ctx.reservation.business_id,
      event: "reservation_reminder",
      refId: ctx.reservation.id,
      recipient: {
        name: ctx.reservation.customer_name,
        email: ctx.reservation.customer_email,
        phone: ctx.reservation.customer_phone,
      },
      whatsapp: null,
      email: {
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: ctx.brand.name,
      },
    });
  } catch (err) {
    console.error("notifyReservationReminder", err);
  }
}
