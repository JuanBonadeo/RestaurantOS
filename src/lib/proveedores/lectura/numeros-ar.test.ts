import { describe, expect, it } from "vitest";

import {
  interpretacionesNumeroAR,
  parseNumeroAR,
} from "@/lib/proveedores/lectura/numeros-ar";

describe("parseNumeroAR", () => {
  it("lee la coma como decimal — los kilos de la carnicería", () => {
    // «ENTRECOT 82,600 kg» son 82 kilos 600 gramos, no ochenta y dos mil.
    expect(parseNumeroAR("82,600")).toBe(82.6);
    expect(parseNumeroAR("5,100")).toBe(5.1);
    expect(parseNumeroAR("0,4260")).toBe(0.426);
  });

  it("lee el punto con tres dígitos detrás como miles — los pesos", () => {
    // Confundirlo divide el importe por mil.
    expect(parseNumeroAR("17.500")).toBe(17500);
    expect(parseNumeroAR("1.445.500")).toBe(1445500);
    expect(parseNumeroAR("2.474.280")).toBe(2474280);
  });

  it("lee el punto con otra cantidad de dígitos como decimal", () => {
    expect(parseNumeroAR("17.5")).toBe(17.5);
    expect(parseNumeroAR("1733.05")).toBe(1733.05);
  });

  it("con los dos separadores, el último manda", () => {
    expect(parseNumeroAR("1.234,56")).toBe(1234.56);
    // La notación que a veces imprime un controlador fiscal.
    expect(parseNumeroAR("1,234.56")).toBe(1234.56);
    expect(parseNumeroAR("165.101,80")).toBe(165101.8);
  });

  it("saca el signo pesos, los espacios y la unidad", () => {
    expect(parseNumeroAR("$ 17.500")).toBe(17500);
    expect(parseNumeroAR("82,600 kg")).toBe(82.6);
    expect(parseNumeroAR("  2.968,00  ")).toBe(2968);
  });

  it("resuelve las fracciones que escribe la verdulería", () => {
    expect(parseNumeroAR("1/2")).toBe(0.5);
    expect(parseNumeroAR("1/2 caj")).toBe(0.5);
    expect(parseNumeroAR("1 1/2")).toBe(1.5);
  });

  it("devuelve null cuando no hay número", () => {
    expect(parseNumeroAR(null)).toBeNull();
    expect(parseNumeroAR(undefined)).toBeNull();
    expect(parseNumeroAR("")).toBeNull();
    expect(parseNumeroAR("—")).toBeNull();
    expect(parseNumeroAR("s/d")).toBeNull();
  });

  it("lee el entero pelado", () => {
    expect(parseNumeroAR("4")).toBe(4);
    expect(parseNumeroAR("18")).toBe(18);
  });
});

describe("interpretacionesNumeroAR · la ambigüedad queda a la vista", () => {
  it("ofrece la lectura de miles como alternativa cuando la coma trae 3 dígitos", () => {
    // «17,500» es raro pero existe. La AR va primera; la otra queda para que la
    // aritmética la elija si el total de la línea la respalda.
    expect(interpretacionesNumeroAR("17,500")).toEqual([17.5, 17500]);
  });

  it("ofrece la lectura decimal como alternativa cuando el punto trae 3 dígitos", () => {
    expect(interpretacionesNumeroAR("17.500")).toEqual([17500, 17.5]);
  });

  it("no inventa alternativas cuando no hay ambigüedad", () => {
    expect(interpretacionesNumeroAR("1.445.500")).toEqual([1445500]);
    expect(interpretacionesNumeroAR("0,4260")).toEqual([0.426]);
    expect(interpretacionesNumeroAR("4")).toEqual([4]);
  });

  it("no ofrece la lectura de miles si delante hay más de 3 dígitos", () => {
    // `1234,567` no puede ser «un millón doscientos…»: la coma de miles nunca
    // deja cuatro dígitos a su izquierda.
    expect(interpretacionesNumeroAR("1234,567")).toEqual([1234.567]);
  });
});
