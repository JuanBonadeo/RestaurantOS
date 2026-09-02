import { describe, expect, it } from "vitest";

import { parseIdentificador } from "./identificador";

/**
 * Spec 142 · D1 — con qué se identifica alguien al entrar.
 *
 * El PIN reemplaza al email, no a la contraseña: lo único que decide esta
 * función es por dónde buscar a la persona.
 */
describe("parseIdentificador", () => {
  it("cuatro dígitos son un PIN", () => {
    expect(parseIdentificador("1234")).toEqual({ tipo: "pin", valor: "1234" });
    expect(parseIdentificador("0000")).toEqual({ tipo: "pin", valor: "0000" });
  });

  it("limpia espacios alrededor: se tipea en una pantalla táctil", () => {
    expect(parseIdentificador("  1234  ")).toEqual({
      tipo: "pin",
      valor: "1234",
    });
    expect(parseIdentificador(" Pedro@Demo.test ")).toEqual({
      tipo: "email",
      valor: "pedro@demo.test",
    });
  });

  it("el email se normaliza a minúsculas", () => {
    expect(parseIdentificador("SOFIA@DEMO.TEST")).toEqual({
      tipo: "email",
      valor: "sofia@demo.test",
    });
  });

  it("no es PIN si no son exactamente cuatro dígitos", () => {
    // Tres o cinco dígitos no son un PIN — y tampoco un email: no entran.
    expect(parseIdentificador("123")).toBeNull();
    expect(parseIdentificador("12345")).toBeNull();
    expect(parseIdentificador("12a4")).toBeNull();
  });

  it("rechaza lo que no es ni PIN ni email", () => {
    expect(parseIdentificador("")).toBeNull();
    expect(parseIdentificador("   ")).toBeNull();
    expect(parseIdentificador("pedro")).toBeNull();
    expect(parseIdentificador("pedro@")).toBeNull();
    expect(parseIdentificador("@demo.test")).toBeNull();
  });

  it("un email que arranca con dígitos sigue siendo email", () => {
    expect(parseIdentificador("1234@demo.test")).toEqual({
      tipo: "email",
      valor: "1234@demo.test",
    });
  });
});
