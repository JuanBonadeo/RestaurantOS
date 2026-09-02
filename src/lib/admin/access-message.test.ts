import { describe, expect, it } from "vitest";

import { buildAccessMessage } from "./access-message";

/**
 * Spec 142 · D5 — el texto que el admin copia y manda por WhatsApp.
 *
 * Lo que se prueba acá es que diga las tres cosas que hoy no dice: de qué
 * negocio es, con qué se entra después, y que el link se vence.
 */
describe("buildAccessMessage", () => {
  const link = "https://restaurant.mithandir.com/auth/confirm?token_hash=abc";

  it("nombra al negocio, no «el panel de Pedidos»", () => {
    const msg = buildAccessMessage({
      businessName: "JCR Golf",
      link,
      pin: "1234",
      email: "pedro.gomez@golf-jcr.internal",
      yaTienePassword: false,
    });
    expect(msg).toContain("JCR Golf");
    expect(msg).not.toContain("el panel de Pedidos");
  });

  it("dice con qué entra después: el PIN adelante, que es lo que se acuerdan", () => {
    const msg = buildAccessMessage({
      businessName: "JCR Golf",
      link,
      pin: "1234",
      email: "pedro.gomez@golf-jcr.internal",
      yaTienePassword: false,
    });
    expect(msg).toContain("1234");
  });

  it("sin PIN cae al email — un admin no tiene PIN", () => {
    const msg = buildAccessMessage({
      businessName: "JCR Golf",
      link,
      pin: null,
      email: "martin@jcrgolf.com",
      yaTienePassword: false,
    });
    expect(msg).toContain("martin@jcrgolf.com");
  });

  it("avisa que el link vence", () => {
    const msg = buildAccessMessage({
      businessName: "JCR Golf",
      link,
      pin: "1234",
      email: "x@y.z",
      yaTienePassword: false,
    });
    expect(msg).toMatch(/1 hora|una hora/i);
  });

  it("si nunca puso contraseña, el link es para crearla", () => {
    const msg = buildAccessMessage({
      businessName: "JCR Golf",
      link,
      pin: "1234",
      email: "x@y.z",
      yaTienePassword: false,
    });
    expect(msg).toMatch(/contraseña/i);
    expect(msg).toContain(link);
  });

  it("si ya tiene contraseña, el link es para entrar directo — no le pide crear otra", () => {
    const msg = buildAccessMessage({
      businessName: "JCR Golf",
      link,
      pin: "1234",
      email: "x@y.z",
      yaTienePassword: true,
    });
    expect(msg).toContain(link);
    expect(msg).not.toMatch(/eleg[íi] tu contraseña|crear tu contraseña/i);
  });
});
