import { describe, expect, it } from "vitest";

import {
  comensalesDesdeTecla,
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

/**
 * El modal de comensales (spec 146, fast-follow 2): un dígito **confirma y
 * sigue**. Pedido de Juan: *"si pone 4, que pase a la parte de adicionar
 * productos, no que tenga que poner 4 más Enter, son pasos extras que no
 * queremos"*.
 */
describe("comensalesDesdeTecla", () => {
  it("un dígito fija la cantidad Y confirma: no hace falta Enter", () => {
    expect(comensalesDesdeTecla("4", 2)).toEqual({ valor: 4, confirma: true });
    expect(comensalesDesdeTecla("1", 8)).toEqual({ valor: 1, confirma: true });
  });

  it("+ y − ajustan sin confirmar: así se llega a una mesa de 12", () => {
    expect(comensalesDesdeTecla("+", 9)).toEqual({ valor: 10, confirma: false });
    expect(comensalesDesdeTecla("-", 3)).toEqual({ valor: 2, confirma: false });
    expect(comensalesDesdeTecla("=", 9)).toEqual({ valor: 10, confirma: false });
  });

  it("respeta el techo y el piso sin confirmar de casualidad", () => {
    expect(comensalesDesdeTecla("+", MAX_PARTY_SIZE)).toEqual({
      valor: MAX_PARTY_SIZE,
      confirma: false,
    });
    expect(comensalesDesdeTecla("-", MIN_PARTY_SIZE)).toEqual({
      valor: MIN_PARTY_SIZE,
      confirma: false,
    });
  });

  it("una tecla que no es nuestra la deja pasar", () => {
    expect(comensalesDesdeTecla("a", 2)).toBeNull();
    expect(comensalesDesdeTecla("0", 2)).toBeNull();
    expect(comensalesDesdeTecla("Enter", 2)).toBeNull();
  });
});
