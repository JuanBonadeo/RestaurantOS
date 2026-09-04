/**
 * Links a WhatsApp del negocio.
 *
 * La regla es siempre la misma: `wa.me` sólo come dígitos, y sin un teléfono
 * usable preferimos no mostrar botón antes que mandar al cliente a un link
 * roto. Vive acá y no en `guest-policy.ts` porque ya son dos los avisos que
 * abren WhatsApp (invitados por socio y grupos grandes).
 */

/** Menos dígitos que esto no es un teléfono: no armamos link. */
const MIN_PHONE_DIGITS = 8;

/** `https://wa.me/<digits>?text=…`, o `null` si el teléfono no sirve. */
export function businessWhatsappHref(
  phone: string | null | undefined,
  text: string,
): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export type LargeGroupWhatsappLinkParams = {
  /** `businesses.phone`. Sin teléfono no hay botón. */
  phone: string | null | undefined;
  /** `reservation_settings.max_party_size`: el tope que el flujo web cierra solo. */
  maxPartySize: number;
  /** Fecha elegida, ya formateada. Opcional: el stepper se toca antes del día. */
  dayLabel?: string;
};

/**
 * Grupos que no entran en el flujo web. Arriba del máximo del negocio la mesa
 * se arma a mano (juntar mesas, salón privado, menú cerrado), así que el botón
 * abre WhatsApp con el pedido ya escrito en vez de dejar al cliente frenado
 * contra el tope del stepper.
 */
export function buildLargeGroupWhatsappLink({
  phone,
  maxPartySize,
  dayLabel,
}: LargeGroupWhatsappLinkParams): string | null {
  const cuando = dayLabel ? ` para el ${dayLabel}` : "";
  return businessWhatsappHref(
    phone,
    `¡Hola! Somos un grupo de más de ${maxPartySize} personas y queremos reservar${cuando}. ¿Tienen lugar?`,
  );
}
