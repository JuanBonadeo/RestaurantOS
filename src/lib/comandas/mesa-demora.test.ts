import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREP_MIN,
  delayLevel,
  excessMinutes,
  expectedComandaMinutes,
  tableDelay,
  type DelayComanda,
} from "./mesa-demora";

describe("expectedComandaMinutes", () => {
  it("toma el prep_time más alto de los ítems (sale cuando está el más lento)", () => {
    expect(
      expectedComandaMinutes([
        { prep_time_minutes: 12 },
        { prep_time_minutes: 20 },
      ]),
    ).toBe(20);
  });

  it("un ítem sin tiempo cargado cuenta como DEFAULT (25)", () => {
    expect(
      expectedComandaMinutes([
        { prep_time_minutes: 12 },
        { prep_time_minutes: null },
      ]),
    ).toBe(DEFAULT_PREP_MIN);
  });

  it("todos null → DEFAULT", () => {
    expect(
      expectedComandaMinutes([
        { prep_time_minutes: null },
        { prep_time_minutes: null },
      ]),
    ).toBe(25);
  });

  it("comanda vacía → DEFAULT (sin Math.max(-Infinity))", () => {
    expect(expectedComandaMinutes([])).toBe(25);
  });

  it("respeta un fallback custom", () => {
    expect(expectedComandaMinutes([{ prep_time_minutes: null }], 40)).toBe(40);
  });
});

describe("excessMinutes", () => {
  const now = Date.parse("2026-06-25T12:00:00Z");

  it("transcurrido − esperado", () => {
    // marchada hace 30 min, esperado 25 → exceso 5
    const emitted = "2026-06-25T11:30:00Z";
    expect(excessMinutes(emitted, now, 25)).toBe(5);
  });

  it("puede ser negativo si va dentro del tiempo esperado", () => {
    // marchada hace 10 min, esperado 25 → exceso -15
    const emitted = "2026-06-25T11:50:00Z";
    expect(excessMinutes(emitted, now, 25)).toBe(-15);
  });
});

describe("delayLevel", () => {
  it("exceso < 10 (incl. negativo) → 0 = sin punto (margen de gracia)", () => {
    expect(delayLevel(-15)).toBe(0);
    expect(delayLevel(0)).toBe(0);
    expect(delayLevel(5)).toBe(0);
    expect(delayLevel(9.9)).toBe(0);
  });

  it("escala un nivel cada 10 min de exceso", () => {
    expect(delayLevel(12)).toBe(1); // ámbar
    expect(delayLevel(22)).toBe(2); // naranja
    expect(delayLevel(33)).toBe(3); // rojo
    expect(delayLevel(47)).toBe(4); // rojo oscuro
  });

  it("tope en MAX_LEVEL (4) por más que el exceso crezca", () => {
    expect(delayLevel(99)).toBe(4);
    expect(delayLevel(600)).toBe(4);
  });
});

describe("tableDelay", () => {
  const now = Date.parse("2026-06-25T12:00:00Z");

  function comanda(p: Partial<DelayComanda>): DelayComanda {
    return {
      emitted_at: "2026-06-25T11:30:00Z",
      delivered_at: null,
      station_name: "Cocina",
      items: [{ prep_time_minutes: 25 }],
      ...p,
    };
  }

  it("null cuando no hay comandas", () => {
    expect(tableDelay([], now)).toBeNull();
  });

  it("ignora comandas ya entregadas", () => {
    const entregada = comanda({
      emitted_at: "2026-06-25T10:00:00Z", // muy vieja
      delivered_at: "2026-06-25T10:40:00Z",
    });
    expect(tableDelay([entregada], now)).toBeNull();
  });

  it("ignora comandas anuladas (spec 078)", () => {
    // La anulada nunca se entrega: sin este filtro la mesa quedaba con una
    // demora que crece sola para siempre, y contra el tiempo por defecto
    // porque sus ítems ya están cancelados (llegan vacíos).
    const anulada = comanda({
      emitted_at: "2026-06-25T10:00:00Z",
      cancelled_at: "2026-06-25T10:05:00Z",
      items: [],
    });
    expect(tableDelay([anulada], now)).toBeNull();
  });

  it("elige la comanda pendiente con mayor exceso", () => {
    // Cocina: marchada 11:30, esperado 25 → transcurrido 30, exceso 5 (nivel 0)
    // Parrilla: marchada 11:00, esperado 20 → transcurrido 60, exceso 40 (nivel 4)
    const cocina = comanda({ station_name: "Cocina" });
    const parrilla = comanda({
      station_name: "Parrilla",
      emitted_at: "2026-06-25T11:00:00Z",
      items: [{ prep_time_minutes: 20 }],
    });
    const d = tableDelay([cocina, parrilla], now);
    expect(d?.station).toBe("Parrilla");
    expect(d?.excessMinutes).toBe(40);
    expect(d?.level).toBe(4);
  });

  it("devuelve la pendiente aunque su nivel sea 0 (el consumidor filtra)", () => {
    const d = tableDelay([comanda({})], now);
    expect(d).not.toBeNull();
    expect(d?.level).toBe(0);
  });

  it("usa DEFAULT para ítems sin prep_time", () => {
    // marchada hace 45 min, ítems sin tiempo → esperado 25 → exceso 20 (nivel 2)
    const c = comanda({
      emitted_at: "2026-06-25T11:15:00Z",
      items: [{ prep_time_minutes: null }],
    });
    const d = tableDelay([c], now);
    expect(d?.expectedMinutes).toBe(25);
    expect(d?.excessMinutes).toBe(20);
    expect(d?.level).toBe(2);
  });
});
