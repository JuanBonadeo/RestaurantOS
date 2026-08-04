import { describe, expect, it } from "vitest";

import {
  ENTREGADAS_VISIBLE_MINUTES,
  entregadasCutoff,
  isEntregadaVisible,
} from "./entregadas-window";

const MIN = 60_000;
const NOW = new Date("2026-08-04T21:00:00.000Z").getTime();

/** ISO de un momento `min` minutos antes de NOW. */
function hace(min: number): string {
  return new Date(NOW - min * MIN).toISOString();
}

describe("isEntregadaVisible", () => {
  it("una comanda recién entregada se ve", () => {
    expect(isEntregadaVisible(hace(0), NOW)).toBe(true);
  });

  it("dentro de la ventana se ve", () => {
    expect(isEntregadaVisible(hace(29), NOW)).toBe(true);
  });

  it("justo en el límite todavía se ve (se oculta al pasarse, no al llegar)", () => {
    expect(isEntregadaVisible(hace(ENTREGADAS_VISIBLE_MINUTES), NOW)).toBe(true);
  });

  it("pasada la ventana se oculta", () => {
    expect(isEntregadaVisible(hace(31), NOW)).toBe(false);
    expect(isEntregadaVisible(hace(180), NOW)).toBe(false);
  });

  it("sin delivered_at no se ve (la columna Entregadas se ordena por esa hora)", () => {
    expect(isEntregadaVisible(null, NOW)).toBe(false);
  });

  it("una fecha basura no se ve (nunca NaN colándose como visible)", () => {
    expect(isEntregadaVisible("no-es-una-fecha", NOW)).toBe(false);
  });

  it("delivered_at en el futuro (reloj desfasado) se ve, no se descarta", () => {
    expect(isEntregadaVisible(hace(-2), NOW)).toBe(true);
  });
});

describe("entregadasCutoff", () => {
  it("es NOW menos la ventana", () => {
    expect(entregadasCutoff(new Date(NOW)).toISOString()).toBe(
      new Date(NOW - ENTREGADAS_VISIBLE_MINUTES * MIN).toISOString(),
    );
  });

  it("cruza la medianoche sin cortar (la ventana es rodante, no del día)", () => {
    const medianoche = new Date("2026-08-05T03:10:00.000Z"); // 00:10 AR
    const cutoff = entregadasCutoff(medianoche);
    expect(cutoff.toISOString()).toBe("2026-08-05T02:40:00.000Z"); // 23:40 AR del día anterior
    // Una comanda entregada 23:55 sigue visible a las 00:10.
    expect(
      isEntregadaVisible("2026-08-05T02:55:00.000Z", medianoche.getTime()),
    ).toBe(true);
  });
});
