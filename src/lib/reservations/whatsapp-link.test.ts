import { describe, expect, it } from "vitest";

import { buildLargeGroupWhatsappLink, businessWhatsappHref } from "./whatsapp-link";

describe("businessWhatsappHref", () => {
  it("normaliza el teléfono a dígitos (wa.me no acepta + ni espacios)", () => {
    expect(businessWhatsappHref("+54 9 341 327-6804", "hola")).toBe(
      "https://wa.me/5493413276804?text=hola",
    );
  });

  it("sin teléfono usable no hay link (nunca un wa.me roto)", () => {
    expect(businessWhatsappHref(null, "hola")).toBeNull();
    expect(businessWhatsappHref("  ", "hola")).toBeNull();
    expect(businessWhatsappHref("sin numero", "hola")).toBeNull();
    expect(businessWhatsappHref("12345", "hola")).toBeNull();
  });
});

describe("buildLargeGroupWhatsappLink", () => {
  const base = { phone: "+54 9 341 327-6804", maxPartySize: 12 };

  it("el mensaje dice que el grupo pasa el tope del negocio", () => {
    const text = decodeURIComponent(
      buildLargeGroupWhatsappLink(base)!.split("?text=")[1],
    );
    expect(text).toContain("más de 12 personas");
  });

  it("con fecha elegida, el mensaje la lleva", () => {
    const text = decodeURIComponent(
      buildLargeGroupWhatsappLink({ ...base, dayLabel: "mié 6 de ago" })!.split("?text=")[1],
    );
    expect(text).toContain("mié 6 de ago");
  });

  it("sin fecha el mensaje sigue teniendo sentido", () => {
    const text = decodeURIComponent(
      buildLargeGroupWhatsappLink(base)!.split("?text=")[1],
    );
    expect(text).not.toContain("undefined");
    expect(text).toContain("reservar.");
  });

  it("el tope sale del negocio, no de un 12 hardcodeado", () => {
    const text = decodeURIComponent(
      buildLargeGroupWhatsappLink({ ...base, maxPartySize: 8 })!.split("?text=")[1],
    );
    expect(text).toContain("más de 8 personas");
  });

  it("sin teléfono cargado no hay botón", () => {
    expect(buildLargeGroupWhatsappLink({ ...base, phone: null })).toBeNull();
  });
});
