import { describe, expect, it } from "vitest";

import {
  addOption,
  moveCard,
  moveOption,
  normalize,
  pruneBlocks,
  removeGroup,
  toCards,
} from "./component-order";
import type { DailyMenuComponentInput } from "./schemas";

/**
 * Orden de los componentes del editor del menú del día (spec 076).
 *
 * Los ids acá son strings legibles («g1», no un uuid): estas funciones no
 * validan formato, sólo agrupan y mueven. El uuid lo pone el form y lo valida
 * Zod al guardar.
 */

function text(label: string): DailyMenuComponentInput {
  return { label, kind: "text" };
}

function option(
  groupId: string,
  groupLabel: string,
  name: string,
  blocks: string[] = [],
): DailyMenuComponentInput {
  return {
    label: name,
    kind: "choice",
    product_id: `prod-${name}`,
    choice_group_id: groupId,
    choice_group_label: groupLabel,
    extra_price_cents: 0,
    blocks_choice_group_ids: blocks,
  };
}

/** Etiqueta de cada tarjeta, para leer el orden de un vistazo. */
const cardLabels = (components: DailyMenuComponentInput[]) =>
  toCards(components).map((c) =>
    c.kind === "group" ? `[${c.label}]` : c.component.label,
  );

const labels = (components: DailyMenuComponentInput[]) =>
  components.map((c) => c.label);

const MENU: DailyMenuComponentInput[] = [
  text("Pan y cubierto"),
  option("g1", "Entrada", "Empanadas"),
  option("g1", "Entrada", "Provoleta"),
  option("g2", "Principal", "Milanesa"),
  option("g2", "Principal", "Ravioles"),
  option("g3", "Postre", "Flan"),
];

describe("toCards", () => {
  it("arma una tarjeta por componente suelto y una por grupo, en orden", () => {
    expect(cardLabels(MENU)).toEqual([
      "Pan y cubierto",
      "[Entrada]",
      "[Principal]",
      "[Postre]",
    ]);
  });

  it("junta en una sola tarjeta las opciones sueltas de un mismo grupo", () => {
    // El array append-only dejaba las opciones intercaladas: agregar una opción
    // a Entrada la mandaba al final, después de Principal.
    const intercalado = [
      option("g1", "Entrada", "Empanadas"),
      option("g2", "Principal", "Milanesa"),
      option("g1", "Entrada", "Provoleta"),
    ];
    const cards = toCards(intercalado);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ kind: "group", label: "Entrada" });
    expect(
      cards[0].kind === "group" ? cards[0].options.map((o) => o.label) : [],
    ).toEqual(["Empanadas", "Provoleta"]);
  });

  it("una opción sin grupo cae como componente suelto en vez de perderse", () => {
    const roto: DailyMenuComponentInput[] = [
      { label: "Huérfana", kind: "choice", product_id: "p1" },
    ];
    expect(toCards(roto)).toEqual([
      { kind: "single", component: roto[0] },
    ]);
  });
});

describe("normalize (FR-005)", () => {
  it("deja las opciones de cada grupo contiguas sin perder ni duplicar nada", () => {
    const intercalado = [
      option("g1", "Entrada", "Empanadas"),
      option("g2", "Principal", "Milanesa"),
      option("g1", "Entrada", "Provoleta"),
      text("Pan"),
    ];
    expect(labels(normalize(intercalado))).toEqual([
      "Empanadas",
      "Provoleta",
      "Milanesa",
      "Pan",
    ]);
    expect(normalize(intercalado)).toHaveLength(intercalado.length);
  });

  it("es idempotente", () => {
    expect(normalize(normalize(MENU))).toEqual(normalize(MENU));
  });
});

describe("moveCard (FR-001)", () => {
  it("bajar un grupo lo pone después del siguiente, con todas sus opciones", () => {
    const next = moveCard(MENU, 1, 2); // Entrada baja un lugar
    expect(cardLabels(next)).toEqual([
      "Pan y cubierto",
      "[Principal]",
      "[Entrada]",
      "[Postre]",
    ]);
    expect(labels(next)).toEqual([
      "Pan y cubierto",
      "Milanesa",
      "Ravioles",
      "Empanadas",
      "Provoleta",
      "Flan",
    ]);
  });

  it("subir un grupo lo pone antes del anterior", () => {
    expect(cardLabels(moveCard(MENU, 3, 2))).toEqual([
      "Pan y cubierto",
      "[Entrada]",
      "[Postre]",
      "[Principal]",
    ]);
  });

  it("mueve también componentes sueltos", () => {
    expect(cardLabels(moveCard(MENU, 0, 1))).toEqual([
      "[Entrada]",
      "Pan y cubierto",
      "[Principal]",
      "[Postre]",
    ]);
  });

  it("fuera de rango no hace nada (pero normaliza igual)", () => {
    expect(labels(moveCard(MENU, 0, -1))).toEqual(labels(MENU));
    expect(labels(moveCard(MENU, 3, 4))).toEqual(labels(MENU));
    expect(labels(moveCard(MENU, 9, 0))).toEqual(labels(MENU));
  });
});

describe("moveOption (FR-002)", () => {
  it("cambia el orden dentro del grupo sin tocar el resto", () => {
    const next = moveOption(MENU, "g2", 0, 1);
    expect(labels(next)).toEqual([
      "Pan y cubierto",
      "Empanadas",
      "Provoleta",
      "Ravioles",
      "Milanesa",
      "Flan",
    ]);
  });

  it("fuera de rango o grupo inexistente no hace nada", () => {
    expect(labels(moveOption(MENU, "g2", 0, 2))).toEqual(labels(MENU));
    expect(labels(moveOption(MENU, "g2", -1, 0))).toEqual(labels(MENU));
    expect(labels(moveOption(MENU, "nope", 0, 1))).toEqual(labels(MENU));
  });
});

describe("removeGroup (FR-003)", () => {
  it("se lleva todas las opciones del grupo y deja el resto igual", () => {
    expect(labels(removeGroup(MENU, "g2"))).toEqual([
      "Pan y cubierto",
      "Empanadas",
      "Provoleta",
      "Flan",
    ]);
  });

  it("borrar un grupo inexistente no rompe nada", () => {
    expect(labels(removeGroup(MENU, "nope"))).toEqual(labels(MENU));
  });
});

describe("addOption (FR-005)", () => {
  it("inserta la opción al final de SU grupo, no al final del menú", () => {
    const next = addOption(MENU, "g1", option("g1", "Entrada", "Sopa"));
    expect(labels(next)).toEqual([
      "Pan y cubierto",
      "Empanadas",
      "Provoleta",
      "Sopa",
      "Milanesa",
      "Ravioles",
      "Flan",
    ]);
  });

  it("si el grupo todavía no existe, la opción abre una tarjeta al final", () => {
    const next = addOption(MENU, "g9", option("g9", "Bebida", "Agua"));
    expect(cardLabels(next)).toEqual([
      "Pan y cubierto",
      "[Entrada]",
      "[Principal]",
      "[Postre]",
      "[Bebida]",
    ]);
  });
});

describe("pruneBlocks (FR-004)", () => {
  const conRegla: DailyMenuComponentInput[] = [
    option("gp", "Principal", "Milanesa"),
    option("gp", "Principal", "Ravioles", ["gg"]), // los ravioles no llevan guarnición
    option("gg", "Guarnición", "Papas"),
  ];

  it("no toca la regla que mira hacia adelante", () => {
    const { components, dropped } = pruneBlocks(conRegla);
    expect(dropped).toEqual([]);
    expect(components[1].blocks_choice_group_ids).toEqual(["gg"]);
  });

  it("descarta la regla que quedó mirando hacia atrás y la reporta", () => {
    // Guarnición se mueve arriba de Principal ⇒ la regla es inaplicable y,
    // peor, invisible: los checks sólo dibujan los grupos posteriores.
    const movido = moveCard(conRegla, 1, 0);
    const { components, dropped } = pruneBlocks(movido);
    expect(dropped).toEqual([
      { optionLabel: "Ravioles", ownerLabel: "Principal", blockedLabel: "Guarnición" },
    ]);
    for (const c of components) {
      expect(c.blocks_choice_group_ids ?? []).toEqual([]);
    }
  });

  it("limpia sin avisar los punteros a un grupo que ya no existe", () => {
    const { components, dropped } = pruneBlocks(removeGroup(conRegla, "gg"));
    expect(dropped).toEqual([]);
    expect(components[1].blocks_choice_group_ids).toEqual([]);
  });

  it("descarta sin avisar la auto-referencia", () => {
    const { components, dropped } = pruneBlocks([
      option("gp", "Principal", "Milanesa", ["gp"]),
    ]);
    expect(dropped).toEqual([]);
    expect(components[0].blocks_choice_group_ids).toEqual([]);
  });

  it("es idempotente", () => {
    const once = pruneBlocks(moveCard(conRegla, 1, 0));
    const twice = pruneBlocks(once.components);
    expect(twice.dropped).toEqual([]);
    expect(twice.components).toEqual(once.components);
  });

  it("no muta el array que recibe", () => {
    const original = JSON.parse(JSON.stringify(conRegla));
    pruneBlocks(moveCard(conRegla, 1, 0));
    expect(conRegla).toEqual(original);
  });
});
