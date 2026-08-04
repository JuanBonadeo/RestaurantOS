/**
 * Spec 080 — política de invitados por socio.
 *
 * El Golf es un club: quien reserva es socio y puede traer hasta N invitados,
 * cuyos datos (DNI + nombre y apellido) el club necesita antes de la visita
 * para el control de ingreso. Esto es un **aviso**, no una validación: no hay
 * entidad socio en el sistema (fuera de alcance desde la spec 059), así que
 * nadie impide reservar para 8 sin registrar a nadie.
 *
 * La política va **fija en código** por decisión de Juan (2026-08-04): no hay
 * pantalla de config todavía. Pero va **acotada por negocio** — mostrarla en
 * todos sería un bug de multi-tenancy, no una feature. Cuando un segundo
 * negocio la pida, esto se muda a `reservation_settings` (toggle + texto +
 * máximo) y sólo cambia `getGuestPolicy`.
 */

export type GuestPolicy = {
  /** Invitados que puede traer cada socio. */
  maxGuests: number;
};

const GUEST_POLICY_BY_SLUG: Record<string, GuestPolicy> = {
  "golf-jcr": { maxGuests: 2 },
};

/** Política del negocio, o `null` si no tiene (la mayoría). */
export function getGuestPolicy(slug: string): GuestPolicy | null {
  return GUEST_POLICY_BY_SLUG[slug] ?? null;
}

/** `wa.me` no acepta "+", espacios ni guiones. */
const MIN_PHONE_DIGITS = 8;

export type GuestWhatsappLinkParams = {
  /** `businesses.phone`. Sin teléfono no hay botón. */
  phone: string | null | undefined;
  maxGuests: number;
  /** Día de la reserva ya formateado (sólo desde la confirmación). */
  dayLabel?: string;
  /** Hora de la reserva ya formateada (sólo desde la confirmación). */
  timeLabel?: string;
};

/**
 * Link de WhatsApp al negocio con el mensaje ya armado para que el socio sólo
 * complete los datos. Devuelve `null` cuando no hay teléfono utilizable —
 * preferimos mostrar el aviso sin botón antes que un `wa.me` roto.
 */
export function buildGuestWhatsappLink({
  phone,
  maxGuests,
  dayLabel,
  timeLabel,
}: GuestWhatsappLinkParams): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS) return null;

  const cuando =
    dayLabel && timeLabel
      ? `mi reserva del ${dayLabel} a las ${timeLabel} hs`
      : "mi próxima reserva";

  const lineas = Array.from(
    { length: maxGuests },
    (_, i) => `${i + 1}) DNI – Nombre y apellido`,
  ).join("\n");

  const text = `¡Hola! Te paso los datos de mis invitados para ${cuando}:\n${lineas}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
