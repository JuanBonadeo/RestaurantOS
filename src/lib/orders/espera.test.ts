import { describe, expect, it } from "vitest";

import {
  ESPERA_GRAVE_MIN,
  ESPERA_QUE_MOLESTA_MIN,
  tonoDeEspera,
} from "./espera";

describe("tonoDeEspera", () => {
  const esperando = (minutos: number) =>
    tonoDeEspera({ minutos, esperandoDecision: true, terminal: false });
  const enCurso = (minutos: number) =>
    tonoDeEspera({ minutos, esperandoDecision: false, terminal: false });

  it("el pedido sin confirmar tiene la escala corta", () => {
    expect(esperando(5)).toBe("normal");
    expect(esperando(ESPERA_QUE_MOLESTA_MIN)).toBe("demorado");
    expect(esperando(ESPERA_GRAVE_MIN)).toBe("grave");
  });

  it("los mismos minutos en cocina todavía son normales", () => {
    // 10 y 12 minutos cocinando no son noticia; sin confirmar, sí.
    expect(enCurso(ESPERA_QUE_MOLESTA_MIN)).toBe("normal");
    expect(enCurso(15)).toBe("demorado");
    expect(enCurso(30)).toBe("grave");
  });

  it("lo terminal no se marca: ya no hay nada que apurar", () => {
    expect(
      tonoDeEspera({ minutos: 300, esperandoDecision: true, terminal: true }),
    ).toBe("normal");
  });
});
