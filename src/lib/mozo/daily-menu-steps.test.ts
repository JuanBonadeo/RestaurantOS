import { describe, expect, it } from "vitest";

import {
  activeChoiceGroups,
  buildMenuSteps,
  choicesDeltaCents,
  initialOptionIndex,
  optionIndexFromKey,
  pruneBlockedSelections,
  type DailyMenuSelections,
} from "./daily-menu-steps";
import type { DailyMenuChoiceGroup } from "./daily-menus-query";

/**
 * `blocksByOption` mapea índice de opción → grupos que esa opción NO habilita
 * (spec 074). Sin él, ninguna opción bloquea nada.
 */
function group(
  id: string,
  label: string,
  n: number,
  blocksByOption: Record<number, string[]> = {},
): DailyMenuChoiceGroup {
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
      blocks_choice_group_ids: blocksByOption[i] ?? [],
      sort_order: i,
    })),
  };
}

/** Elegir la opción `optIndex` del grupo `groupId`. */
function pick(
  selections: DailyMenuSelections,
  groupId: string,
  optIndex: number,
): DailyMenuSelections {
  const next = new Map(selections);
  next.set(groupId, {
    choice_group_id: groupId,
    choice_group_label: groupId,
    product_id: `${groupId}-prod-${optIndex}`,
    product_name: `Producto ${optIndex}`,
    extra_price_cents: 0,
    modifier_ids: [],
  });
  return next;
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

  it("sin elecciones, se comporta igual que antes de la spec 074", () => {
    const groups = [
      group("principal", "Principal", 2, { 1: ["guarnicion"] }),
      group("guarnicion", "Guarnición", 2),
    ];
    expect(buildMenuSteps(groups)).toHaveLength(3);
  });

  it("elegir una opción que bloquea un grupo saca ese paso (FR-003)", () => {
    const groups = [
      group("principal", "Principal", 2, { 1: ["guarnicion"] }),
      group("guarnicion", "Guarnición", 2),
      group("postre", "Postre", 2),
    ];
    const steps = buildMenuSteps(groups, pick(new Map(), "principal", 1));
    expect(steps.map((s) => (s.kind === "choice" ? s.group.label : "confirm"))).toEqual([
      "Principal",
      "Postre",
      "confirm",
    ]);
  });
});

describe("activeChoiceGroups (spec 074)", () => {
  const MENU = [
    group("principal", "Principal", 2, { 1: ["guarnicion"] }),
    group("guarnicion", "Guarnición", 2, { 0: ["postre"] }),
    group("postre", "Postre", 2),
  ];
  const labels = (gs: DailyMenuChoiceGroup[]) => gs.map((g) => g.label);

  it("todos activos si no se eligió nada", () => {
    expect(labels(activeChoiceGroups(MENU, new Map()))).toEqual([
      "Principal",
      "Guarnición",
      "Postre",
    ]);
  });

  it("la opción que no bloquea deja todo activo", () => {
    const sel = pick(new Map(), "principal", 0);
    expect(labels(activeChoiceGroups(MENU, sel))).toEqual([
      "Principal",
      "Guarnición",
      "Postre",
    ]);
  });

  it("elegir los ravioles saca la guarnición", () => {
    const sel = pick(new Map(), "principal", 1);
    expect(labels(activeChoiceGroups(MENU, sel))).toEqual(["Principal", "Postre"]);
  });

  it("el bloqueo de un grupo que quedó inactivo no cuenta", () => {
    // Guarnición·opción0 bloquea Postre, pero el principal ya sacó la
    // guarnición entera ⇒ el postre vuelve a estar activo.
    let sel = pick(new Map(), "guarnicion", 0);
    sel = pick(sel, "principal", 1);
    expect(labels(activeChoiceGroups(MENU, sel))).toEqual(["Principal", "Postre"]);
  });

  it("una elección de un producto que ya no está en el grupo no bloquea nada", () => {
    // El admin editó el menú con el panel abierto (mismo caso que cubre
    // `initialOptionIndex`).
    const sel = new Map([
      [
        "principal",
        {
          choice_group_id: "principal",
          choice_group_label: "Principal",
          product_id: "producto-borrado",
          product_name: "Fantasma",
          extra_price_cents: 0,
          modifier_ids: [],
        },
      ],
    ]);
    expect(labels(activeChoiceGroups(MENU, sel))).toEqual([
      "Principal",
      "Guarnición",
      "Postre",
    ]);
  });
});

describe("pruneBlockedSelections (FR-004)", () => {
  const MENU = [
    group("principal", "Principal", 2, { 1: ["guarnicion"] }),
    group("guarnicion", "Guarnición", 2),
  ];

  it("borra la guarnición cuando el principal deja de permitirla", () => {
    let sel = pick(new Map(), "principal", 0);
    sel = pick(sel, "guarnicion", 0);
    sel = pick(sel, "principal", 1); // cambia a ravioles
    const pruned = pruneBlockedSelections(MENU, sel);
    expect([...pruned.keys()]).toEqual(["principal"]);
  });

  it("no toca nada si todo sigue aplicando", () => {
    let sel = pick(new Map(), "principal", 0);
    sel = pick(sel, "guarnicion", 1);
    expect([...pruneBlockedSelections(MENU, sel).keys()]).toEqual([
      "principal",
      "guarnicion",
    ]);
  });

  it("es idempotente", () => {
    let sel = pick(new Map(), "principal", 1);
    sel = pick(sel, "guarnicion", 0);
    const once = pruneBlockedSelections(MENU, sel);
    const twice = pruneBlockedSelections(MENU, once);
    expect([...twice.keys()]).toEqual([...once.keys()]);
    expect([...once.keys()]).toEqual(["principal"]);
  });

  it("el adicional de una elección descartada no se cobra", () => {
    // La guarnición cara se eligió antes de cambiar el principal: si quedara
    // estacionada, `choicesDeltaCents` la seguiría sumando al total.
    const menu = [
      group("principal", "Principal", 2, { 1: ["guarnicion"] }),
      group("guarnicion", "Guarnición", 1),
    ];
    menu[1].options[0].extra_price_cents = 250000;
    let sel = pick(new Map(), "principal", 0);
    sel = pick(sel, "guarnicion", 0);
    sel.get("guarnicion")!.extra_price_cents = 250000;
    expect(choicesDeltaCents(sel)).toBe(250000);

    sel = pick(sel, "principal", 1);
    expect(choicesDeltaCents(pruneBlockedSelections(menu, sel))).toBe(0);
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
