import { describe, expect, it } from "vitest";

import {
  MAX_PARTY_SIZE,
  MIN_PARTY_SIZE,
  partySizeFromKey,
} from "./party-size-keys";

describe("partySizeFromKey", () => {
  it("sube de a uno con + y con = (la misma tecla sin Shift)", () => {
    expect(partySizeFromKey("+", 2)).toBe(3);
    expect(partySizeFromKey("=", 2)).toBe(3);
  });

  it("baja de a uno con -", () => {
    expect(partySizeFromKey("-", 4)).toBe(3);
  });

  it("no pasa el tope ni el piso", () => {
    expect(partySizeFromKey("+", MAX_PARTY_SIZE)).toBe(MAX_PARTY_SIZE);
    expect(partySizeFromKey("-", MIN_PARTY_SIZE)).toBe(MIN_PARTY_SIZE);
  });

  it("un dígito 1-9 fija la cantidad directo", () => {
    expect(partySizeFromKey("4", 2)).toBe(4);
    expect(partySizeFromKey("1", 9)).toBe(1);
    expect(partySizeFromKey("9", 2)).toBe(9);
  });

  it("el 0 no es una cantidad válida de personas", () => {
    expect(partySizeFromKey("0", 2)).toBeNull();
  });

  it("ignora cualquier otra tecla", () => {
    for (const k of ["Enter", "a", "ArrowUp", "Escape", " ", "Backspace"]) {
      expect(partySizeFromKey(k, 2)).toBeNull();
    }
  });

  it("una tecla reconocida que no cambia nada igual devuelve valor (para poder frenar el evento)", () => {
    // `+` en el tope o el dígito ya elegido son teclas nuestras: el componente
    // tiene que hacer preventDefault igual, así no se cuela en ningún campo.
    expect(partySizeFromKey("2", 2)).toBe(2);
    expect(partySizeFromKey("+", MAX_PARTY_SIZE)).toBe(MAX_PARTY_SIZE);
  });
});
