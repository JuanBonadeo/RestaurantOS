import { describe, expect, it } from "vitest";

import {
  DEFAULT_ESTIMATED_DELIVERY_MIN,
  DEFAULT_ESTIMATED_PICKUP_MIN,
  formatMinutos,
  minutosEstimados,
  ventanaEstimada,
  ventanaEstimadaLabel,
} from "./entrega-estimada";

describe("formatMinutos", () => {
  it("minutos sueltos, horas justas y horas con resto", () => {
    expect(formatMinutos(40)).toBe("40 min");
    expect(formatMinutos(59)).toBe("59 min");
    expect(formatMinutos(60)).toBe("1 h");
    expect(formatMinutos(90)).toBe("1 h 30");
    expect(formatMinutos(120)).toBe("2 h");
  });
});

describe("ventanaEstimada", () => {
  it("el techo es el siguiente medio horario, siempre mayor que el piso", () => {
    expect(ventanaEstimada(40)).toEqual({ desde: 40, hasta: 60 });
    expect(ventanaEstimada(60)).toEqual({ desde: 60, hasta: 90 });
    // Un piso ya redondo no puede dar una ventana de ancho cero.
    expect(ventanaEstimada(30)).toEqual({ desde: 30, hasta: 60 });
    expect(ventanaEstimada(90)).toEqual({ desde: 90, hasta: 120 });
  });
});

describe("ventanaEstimadaLabel", () => {
  it("los dos casos que pidió Juan", () => {
    expect(ventanaEstimadaLabel(DEFAULT_ESTIMATED_DELIVERY_MIN)).toBe("1 h – 1 h 30");
    expect(ventanaEstimadaLabel(DEFAULT_ESTIMATED_PICKUP_MIN)).toBe("40 min – 1 h");
  });
});

describe("minutosEstimados", () => {
  it("usa lo del negocio cuando está configurado", () => {
    const b = { estimated_delivery_minutes: 75, estimated_pickup_minutes: 20 };
    expect(minutosEstimados("delivery", b)).toBe(75);
    expect(minutosEstimados("pickup", b)).toBe(20);
  });

  it("sin configurar, los defaults del producto", () => {
    expect(minutosEstimados("delivery", {})).toBe(60);
    expect(minutosEstimados("pickup", {})).toBe(40);
    expect(
      minutosEstimados("delivery", { estimated_delivery_minutes: null }),
    ).toBe(60);
  });
});
