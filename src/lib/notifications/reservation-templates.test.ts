import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESERVATION_TEMPLATES,
  personasLabel,
  renderReservationBody,
  reservationWhatsappPayload,
  RESERVATION_NOTIFY_EVENTS,
} from "./reservation-templates";

const base = {
  customerName: "Ana",
  businessName: "Golf JCR",
  dateLabel: "sáb 6/9",
  timeLabel: "21:00",
  partySize: 4,
} as const;

describe("renderReservationBody", () => {
  it("usa el default del evento y reemplaza todos los placeholders", () => {
    const body = renderReservationBody({ ...base, event: "confirmed" });
    expect(body).toContain("Ana");
    expect(body).toContain("Golf JCR");
    expect(body).toContain("sáb 6/9");
    expect(body).toContain("21:00");
    expect(body).toContain("4 personas");
    expect(body).not.toContain("{");
  });

  it("ningún default deja un placeholder sin resolver", () => {
    for (const event of RESERVATION_NOTIFY_EVENTS) {
      const body = renderReservationBody({ ...base, event, reason: "lleno" });
      expect(body, event).not.toMatch(/[{}]/);
    }
  });

  it("el rechazo con motivo lo incluye", () => {
    const body = renderReservationBody({
      ...base,
      event: "rejected",
      reason: "esa noche tenemos un evento privado",
    });
    expect(body).toContain("Motivo: esa noche tenemos un evento privado.");
  });

  it("el rechazo sin motivo no deja hueco ni doble espacio", () => {
    const body = renderReservationBody({ ...base, event: "rejected" })!;
    expect(body).not.toContain("Motivo:");
    expect(body).not.toContain("  ");
  });

  it("un motivo en blanco se trata como ausente", () => {
    const body = renderReservationBody({
      ...base,
      event: "rejected",
      reason: "   ",
    })!;
    expect(body).not.toContain("Motivo:");
  });

  it("respeta el cuerpo que escribió el negocio", () => {
    const body = renderReservationBody({
      ...base,
      event: "confirmed",
      template: { body: "Listo {cliente}, te esperamos el {fecha}.", enabled: true },
    });
    expect(body).toBe("Listo Ana, te esperamos el sáb 6/9.");
  });

  it("cuerpo vacío del negocio → cae al default", () => {
    const body = renderReservationBody({
      ...base,
      event: "confirmed",
      template: { body: "   ", enabled: true },
    });
    expect(body).toBe(
      renderReservationBody({ ...base, event: "confirmed" }),
    );
    expect(DEFAULT_RESERVATION_TEMPLATES.confirmed).toContain("{cliente}");
  });

  it("evento apagado → null (no sale por ningún canal)", () => {
    const body = renderReservationBody({
      ...base,
      event: "requested",
      template: { body: "lo que sea", enabled: false },
    });
    expect(body).toBeNull();
  });
});

describe("personasLabel", () => {
  it("singular y plural", () => {
    expect(personasLabel(1)).toBe("1 persona");
    expect(personasLabel(2)).toBe("2 personas");
  });
});

describe("reservationWhatsappPayload (D4)", () => {
  const ok = {
    body: "Tu reserva quedó confirmada.",
    phone: "1122334455",
    templateName: "reserva_confirmada",
    templateParams: ["Ana", "06/09 21:00"],
  };

  it("con teléfono y template → payload listo para despachar", () => {
    const payload = reservationWhatsappPayload(ok);
    expect(payload).toEqual({
      body: ok.body,
      template: {
        name: "reserva_confirmada",
        lang: "es_AR",
        params: ["Ana", "06/09 21:00"],
      },
    });
  });

  it("respeta el idioma configurado", () => {
    expect(
      reservationWhatsappPayload({ ...ok, templateLang: "es" })?.template.lang,
    ).toBe("es");
  });

  it("sin template aprobado → undefined (no se intenta; el mail sigue)", () => {
    expect(
      reservationWhatsappPayload({ ...ok, templateName: null }),
    ).toBeUndefined();
  });

  it("sin teléfono → undefined", () => {
    expect(reservationWhatsappPayload({ ...ok, phone: "   " })).toBeUndefined();
    expect(reservationWhatsappPayload({ ...ok, phone: null })).toBeUndefined();
  });

  it("evento apagado → null (corta también el mail)", () => {
    expect(reservationWhatsappPayload({ ...ok, body: null })).toBeNull();
  });
});
