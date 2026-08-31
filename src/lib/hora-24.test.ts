import { describe, expect, it } from "vitest";

import { isTime24, maskTime24, normalizeTime24 } from "./hora-24";

describe("maskTime24", () => {
  it("se tipea 2130 y queda 21:30", () => {
    expect(maskTime24("2")).toBe("2");
    expect(maskTime24("21")).toBe("21:");
    expect(maskTime24("213")).toBe("21:3");
    expect(maskTime24("2130")).toBe("21:30");
  });

  it("un primer dígito de 3 en adelante abre la hora con cero", () => {
    expect(maskTime24("9")).toBe("09:");
    expect(maskTime24("0930")).toBe("09:30");
  });

  it("«29» se interpreta como 02:9, no como hora 29", () => {
    expect(maskTime24("29")).toBe("02:9");
    expect(maskTime24("295")).toBe("02:95");
  });

  it("ignora lo que no sean dígitos y corta en cuatro", () => {
    expect(maskTime24("21:30")).toBe("21:30");
    expect(maskTime24("21h30")).toBe("21:30");
    expect(maskTime24("213045")).toBe("21:30");
    expect(maskTime24("abc")).toBe("");
  });

  it("borrando no se re-inserta el separador", () => {
    // Sin esto, sacarle los dos puntos a «12:» los devolvería para siempre.
    expect(maskTime24("12", true)).toBe("12");
    expect(maskTime24("9", true)).toBe("9");
  });
});

describe("normalizeTime24", () => {
  it("completa con ceros", () => {
    expect(normalizeTime24("0930")).toBe("09:30");
    expect(normalizeTime24("9:30")).toBe("09:30");
    expect(normalizeTime24("00:00")).toBe("00:00");
    expect(normalizeTime24("23:59")).toBe("23:59");
  });

  it("«930» son las nueve y media, no las 93", () => {
    expect(normalizeTime24("930")).toBe("09:30");
  });

  it("lo incompleto todavía no es una hora", () => {
    expect(normalizeTime24("")).toBeNull();
    expect(normalizeTime24("21")).toBeNull();
    expect(normalizeTime24("21:")).toBeNull();
    // 21:3 puede ser 21:03 o 21:30: se pide el dígito que falta.
    expect(normalizeTime24("21:3")).toBeNull();
  });

  it("rechaza horas y minutos imposibles", () => {
    expect(normalizeTime24("24:00")).toBeNull();
    expect(normalizeTime24("12:65")).toBeNull();
    expect(normalizeTime24("99:99")).toBeNull();
  });
});

describe("isTime24", () => {
  it("sólo el HH:MM ya normalizado", () => {
    expect(isTime24("21:30")).toBe(true);
    expect(isTime24("9:30")).toBe(false);
    expect(isTime24("")).toBe(false);
  });
});
