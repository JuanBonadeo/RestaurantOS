import { describe, expect, it } from "vitest";

import { normalizarObservacion, OBSERVACION_MAX } from "./observacion";

describe("normalizarObservacion (spec 128)", () => {
  it("recorta los espacios de los bordes", () => {
    expect(normalizarObservacion("  va todo junto  ")).toBe("va todo junto");
  });

  it("sin texto es null, no un string vacío", () => {
    // Un "" en la columna haría que el ticket imprima un «OBS:» pelado con su
    // línea separadora: un renglón de ruido en cada comanda del envío.
    expect(normalizarObservacion("")).toBeNull();
    expect(normalizarObservacion("    ")).toBeNull();
    expect(normalizarObservacion(null)).toBeNull();
    expect(normalizarObservacion(undefined)).toBeNull();
  });

  it("corta en el tope en vez de rechazar", () => {
    // En hora pico, un campo que rechaza es un envío que no sale. Se guarda lo
    // que entra.
    const larga = "a".repeat(OBSERVACION_MAX + 50);
    expect(normalizarObservacion(larga)).toHaveLength(OBSERVACION_MAX);
  });

  it("lo que entra justo no se toca", () => {
    const justa = "b".repeat(OBSERVACION_MAX);
    expect(normalizarObservacion(justa)).toBe(justa);
  });

  it("el corte no deja un espacio colgando al final", () => {
    const conEspacio = "c".repeat(OBSERVACION_MAX - 1) + " " + "resto";
    expect(normalizarObservacion(conEspacio)).toBe(
      "c".repeat(OBSERVACION_MAX - 1),
    );
  });
});
