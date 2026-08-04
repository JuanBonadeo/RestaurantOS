import { I } from "@/components/delivery/primitives";
import { buildGuestWhatsappLink, getGuestPolicy } from "@/lib/reservations/guest-policy";

/**
 * Spec 080 — aviso de invitados por socio (clubes). Se renderiza en `/reservar`
 * y en la confirmación; en cualquier negocio sin política devuelve `null`, así
 * que se puede montar sin condicionales en el caller.
 *
 * Es informativo: no valida ni limita nada (no hay entidad socio en el
 * sistema). El botón lleva a WhatsApp del negocio con el mensaje ya armado —
 * sin teléfono cargado se muestra el texto sin botón, nunca un `wa.me` roto.
 */
export function GuestPolicyNotice({
  slug,
  phone,
  dayLabel,
  timeLabel,
}: {
  slug: string;
  phone: string | null | undefined;
  /** Día de la reserva, ya formateado. Sólo desde la confirmación. */
  dayLabel?: string;
  /** Hora de la reserva, ya formateada. Sólo desde la confirmación. */
  timeLabel?: string;
}) {
  const policy = getGuestPolicy(slug);
  if (!policy) return null;

  const href = buildGuestWhatsappLink({
    phone,
    maxGuests: policy.maxGuests,
    dayLabel,
    timeLabel,
  });
  const invitados =
    policy.maxGuests === 1 ? "1 invitado" : `${policy.maxGuests} invitados`;

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid var(--hairline-2)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        Invitados
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
        Cada socio puede traer hasta <strong style={{ color: "var(--ink)" }}>{invitados}</strong>.
        Pasanos el <strong style={{ color: "var(--ink)" }}>DNI, nombre y apellido</strong> de cada
        uno por WhatsApp antes de venir.
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{
            width: "100%",
            height: 44,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid var(--hairline-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            textDecoration: "none",
          }}
        >
          {I.whatsapp("#1FAF53", 18)} Enviar datos por WhatsApp
        </a>
      ) : null}
    </div>
  );
}
