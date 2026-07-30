import { describe, expect, it } from "vitest";

import {
  buildMenuSteps,
  choicesDeltaCents,
  initialOptionIndex,
  optionIndexFromKey,
} from "./daily-menu-steps";
import type { DailyMenuChoiceGroup } from "./daily-menus-query";

function group(id: string, label: string, n: number): DailyMenuChoiceGroup {
  return {
    choice_group_id: id,
    label,
    options: Array.from({ length: n }, (_, i) => ({
      id: `${id}-opt-${i}`,
      label: `Opción ${i}`,
      description: null,
      kind: "choice" as const,
      product_id: `${id}-prod-${i}`,
      product_name: `Producto ${i}`,
      choice_group_id: id,
      choice_group_label: label,
      extra_price_cents: 0,
    })),
  };
}

describe("buildMenuSteps", () => {
  it("arma un paso por grupo, en orden, y cierra con el paso de confirmación", () => {
    const steps = buildMenuSteps([
      group("g1", "Entrada", 3),
      group("g2", "Principal", 4),
    ]);

    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({ kind: "choice", group: expect.objectContaining({ label: "Entrada" }) });
    expect(steps[1]).toEqual({ kind: "choice", group: expect.objectContaining({ label: "Principal" }) });
    expect(steps[2]).toEqual({ kind: "confirm" });
  });

  it("un menú sin grupos es sólo el paso de confirmación", () => {
    expect(buildMenuSteps([])).toEqual([{ kind: "confirm" }]);
  });

  it("ignora los grupos vacíos: no hay nada que elegir en ellos", () => {
    const steps = buildMenuSteps([group("g1", "Entrada", 0), group("g2", "Principal", 2)]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({ kind: "choice", group: expect.objectContaining({ label: "Principal" }) });
  });
});

describe("optionIndexFromKey", () => {
  it("traduce 1–9 a índice base 0", () => {
    expect(optionIndexFromKey("1", 5)).toBe(0);
    expect(optionIndexFromKey("5", 5)).toBe(4);
  });

  it("devuelve null si el dígito se pasa de la cantidad de opciones", () => {
    expect(optionIndexFromKey("6", 5)).toBeNull();
  });

  it("devuelve null para el 0 y para cualquier tecla que no sea un dígito", () => {
    expect(optionIndexFromKey("0", 5)).toBeNull();
    expect(optionIndexFromKey("a", 5)).toBeNull();
    expect(optionIndexFromKey("Enter", 5)).toBeNull();
    expect(optionIndexFromKey("ArrowDown", 5)).toBeNull();
  });
});

describe("initialOptionIndex", () => {
  const g = group("g1", "Entrada", 3);

  it("arranca en la primera opción cuando el grupo todavía no se eligió", () => {
    expect(initialOptionIndex(g, new Map())).toBe(0);
  });

  it("arranca en la opción ya elegida cuando el usuario vuelve al paso", () => {
    const selections = new Map([
      [
        "g1",
        {
          choice_group_id: "g1",
          choice_group_label: "Entrada",
          product_id: "g1-prod-2",
          product_name: "Producto 2",
          extra_price_cents: 0,
          modifier_ids: [],
        },
      ],
    ]);
    expect(initialOptionIndex(g, selections)).toBe(2);
  });

  it("cae en la primera si lo elegido ya no está en el grupo", () => {
    const selections = new Map([
      [
        "g1",
        {
          choice_group_id: "g1",
          choice_group_label: "Entrada",
          product_id: "producto-borrado",
          product_name: "Fantasma",
          extra_price_cents: 0,
          modifier_ids: [],
        },
      ],
    ]);
    expect(initialOptionIndex(g, selections)).toBe(0);
  });
});

describe("choicesDeltaCents", () => {
  it("suma los adicionales de las opciones elegidas", () => {
    const selections = new Map([
      ["g1", { choice_group_id: "g1", choice_group_label: "Entrada", product_id: "a", product_name: "A", extra_price_cents: 0, modifier_ids: [] }],
      ["g2", { choice_group_id: "g2", choice_group_label: "Principal", product_id: "b", product_name: "B", extra_price_cents: 150000, modifier_ids: [] }],
    ]);
    expect(choicesDeltaCents(selections)).toBe(150000);
  });

  it("sin elecciones, no hay adicional", () => {
    expect(choicesDeltaCents(new Map())).toBe(0);
  });
});
