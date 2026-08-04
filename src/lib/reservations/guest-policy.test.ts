import { describe, expect, it } from "vitest";

import { buildGuestWhatsappLink, getGuestPolicy } from "./guest-policy";

/**
 * Spec 080 — política de invitados por socio. La política va fija en código
 * (decisión de Juan) pero **acotada por negocio**: que apareciera en todos
 * sería un bug de multi-tenancy, no una feature.
 */
describe("getGuestPolicy", () => {
  it("el club tiene política de 2 invitados por socio", () => {
    expect(getGuestPolicy("golf-jcr")).toEqual({ maxGuests: 2 });
  });

  it("un negocio sin política no ve nada", () => {
    expect(getGuestPolicy("demo")).toBeNull();
    expect(getGuestPolicy("cualquier-otro")).toBeNull();
  });
});

describe("buildGuestWhatsappLink", () => {
  const base = { phone: "+54 9 341 327-6804", maxGuests: 2 };

  it("normaliza el teléfono a dígitos (wa.me no acepta + ni espacios)", () => {
    const link = buildGuestWhatsappLink(base)!;
    expect(link.startsWith("https://wa.me/5493413276804?text=")).toBe(true);
  });

  it("sin teléfono cargado no hay link (nunca un wa.me roto)", () => {
    expect(buildGuestWhatsappLink({ ...base, phone: null })).toBeNull();
    expect(buildGuestWhatsappLink({ ...base, phone: "  " })).toBeNull();
  });

  it("un teléfono sin dígitos suficientes tampoco genera link", () => {
    expect(buildGuestWhatsappLink({ ...base, phone: "sin numero" })).toBeNull();
  });

  it("el mensaje pide DNI + nombre y apellido, con una línea por invitado", () => {
    const text = decodeURIComponent(buildGuestWhatsappLink(base)!.split("?text=")[1]);
    expect(text).toContain("DNI");
    expect(text).toContain("Nombre y apellido");
    expect(text).toContain("1)");
    expect(text).toContain("2)");
    expect(text).not.toContain("3)");
  });

  it("con día y hora, el mensaje ancla los invitados a esa reserva", () => {
    const text = decodeURIComponent(
      buildGuestWhatsappLink({ ...base, dayLabel: "mié 6 de ago", timeLabel: "21:00" })!
        .split("?text=")[1],
    );
    expect(text).toContain("mié 6 de ago");
    expect(text).toContain("21:00");
  });

  it("sin día y hora el mensaje sigue teniendo sentido (antes de confirmar)", () => {
    const text = decodeURIComponent(buildGuestWhatsappLink(base)!.split("?text=")[1]);
    expect(text).toContain("reserva");
    expect(text).not.toContain("undefined");
  });

  it("un máximo distinto cambia la cantidad de líneas", () => {
    const text = decodeURIComponent(
      buildGuestWhatsappLink({ ...base, maxGuests: 3 })!.split("?text=")[1],
    );
    expect(text).toContain("3)");
    expect(text).not.toContain("4)");
  });
});
