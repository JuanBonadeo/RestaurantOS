import { describe, expect, it } from "vitest";

import { LADO_LARGO_DEFAULT, calcularDimensiones } from "@/lib/images/achicar";

describe("calcularDimensiones", () => {
  it("no toca una foto que ya entra", () => {
    expect(calcularDimensiones(1600, 1200)).toEqual({ ancho: 1600, alto: 1200 });
  });

  it("achica por el lado largo conservando la proporción", () => {
    // Una foto de 12 MP apaisada, que es lo que sale de un celular.
    expect(calcularDimensiones(4032, 3024)).toEqual({ ancho: 2200, alto: 1650 });
  });

  it("achica igual si el lado largo es el alto", () => {
    // La factura fotografiada de parada — el caso normal con un papel A4.
    expect(calcularDimensiones(3024, 4032)).toEqual({ ancho: 1650, alto: 2200 });
  });

  it("nunca agranda", () => {
    expect(calcularDimensiones(400, 300)).toEqual({ ancho: 400, alto: 300 });
  });

  it("no devuelve 0 en la dimensión chica de una imagen muy apaisada", () => {
    // Con `floor` esto daba alto 0 y el canvas tira IndexSizeError.
    const r = calcularDimensiones(10_000, 3);
    expect(r.ancho).toBe(LADO_LARGO_DEFAULT);
    expect(r.alto).toBeGreaterThanOrEqual(1);
  });

  it("tolera una imagen sin dimensiones", () => {
    expect(calcularDimensiones(0, 0)).toEqual({ ancho: 0, alto: 0 });
  });

  it("respeta un lado largo distinto", () => {
    expect(calcularDimensiones(4000, 2000, 1000)).toEqual({ ancho: 1000, alto: 500 });
  });
});
