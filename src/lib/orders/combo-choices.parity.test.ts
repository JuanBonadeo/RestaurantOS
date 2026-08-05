import { describe, expect, it } from "vitest";

import { activeChoiceGroups, type ChoiceGroupLike } from "./combo-choices";
import { deriveChoiceGroups } from "@/lib/daily-menus/choice-groups";
import type { DailyMenuComponentInput } from "@/lib/daily-menus/schemas";

/**
 * Paridad entre el modelo viejo y el nuevo (spec 087).
 *
 * El viejo escribe la condición en la OPCIÓN y en negativo
 * (`blocks_choice_group_ids`); el nuevo, en el GRUPO y en positivo
 * (`applies_when_*`). La migración `0036` tradujo los menús cargados de una
 * forma a la otra, y `deriveChoiceGroups` hace la misma traducción en TS cada
 * vez que se guarda.
 *
 * Si las dos formas no resuelven idéntico, un menú cambia de comportamiento
 * solo — el mozo deja de ver un paso, o ve uno que no corresponde. Este test
 * recorre **todas** las combinaciones de elecciones posibles sobre un menú con
 * la forma del real de golf-jcr y exige el mismo conjunto activo.
 */

function opcion(
  groupId: string,
  groupLabel: string,
  producto: string,
  blocks: string[] = [],
): DailyMenuComponentInput {
  return {
    label: producto,
    kind: "choice",
    product_id: producto,
    choice_group_id: groupId,
    choice_group_label: groupLabel,
    extra_price_cents: 0,
    blocks_choice_group_ids: blocks,
  };
}

/** El Menu Ejecutivo de golf-jcr: 4 de los 9 principales no llevan guarnición. */
const MENU_REAL: DailyMenuComponentInput[] = [
  opcion("gb", "Bebida", "gaseosa"),
  opcion("gb", "Bebida", "agua"),
  opcion("gb", "Bebida", "vino-tinto"),
  opcion("gb", "Bebida", "vino-blanco"),
  opcion("gp", "Plato Principal", "milanesa"),
  opcion("gp", "Plato Principal", "suprema"),
  opcion("gp", "Plato Principal", "arrollado"),
  opcion("gp", "Plato Principal", "merluza"),
  opcion("gp", "Plato Principal", "omelette"),
  opcion("gp", "Plato Principal", "revuelto", ["gg"]),
  opcion("gp", "Plato Principal", "noquis", ["gg"]),
  opcion("gp", "Plato Principal", "tallarines", ["gg"]),
  opcion("gp", "Plato Principal", "ravioles", ["gg"]),
  opcion("gg", "Guarnicion", "papas"),
  opcion("gg", "Guarnicion", "pure"),
  opcion("gg", "Guarnicion", "ensalada"),
];

/** Agrupa los componentes como lo hacen `menu.ts` y `daily-menus-query`. */
function agrupar(components: DailyMenuComponentInput[]): ChoiceGroupLike[] {
  const porGrupo = new Map<string, ChoiceGroupLike>();
  for (const c of components) {
    if (c.kind !== "choice" || !c.choice_group_id) continue;
    let g = porGrupo.get(c.choice_group_id);
    if (!g) {
      g = { choice_group_id: c.choice_group_id, options: [] };
      porGrupo.set(c.choice_group_id, g);
    }
    g.options.push({
      product_id: c.product_id ?? null,
      blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
    });
  }
  return [...porGrupo.values()];
}

/** Los mismos grupos, pero resueltos por la condición del grupo. */
function agruparConCondicion(
  components: DailyMenuComponentInput[],
): ChoiceGroupLike[] {
  const derivados = deriveChoiceGroups(components);
  return agrupar(components).map((g) => {
    const d = derivados.find((x) => x.id === g.choice_group_id)!;
    return {
      ...g,
      // El modelo nuevo no mira el `blocks` de la opción: se vacía para que el
      // test no pueda pasar "por el camino viejo" sin darnos cuenta.
      options: g.options.map((o) => ({ ...o, blocks_choice_group_ids: [] })),
      applies_when_group_id: d.applies_when_group_id,
      applies_when_product_ids: d.applies_when_product_ids,
    };
  });
}

/** Todas las combinaciones de elección, incluyendo "todavía no eligió". */
function combinaciones(
  grupos: ChoiceGroupLike[],
): Map<string, { product_id: string }>[] {
  let acc: Map<string, { product_id: string }>[] = [new Map()];
  for (const g of grupos) {
    const siguiente: Map<string, { product_id: string }>[] = [];
    for (const base of acc) {
      siguiente.push(new Map(base)); // sin elegir
      for (const o of g.options) {
        if (!o.product_id) continue;
        const m = new Map(base);
        m.set(g.choice_group_id, { product_id: o.product_id });
        siguiente.push(m);
      }
    }
    acc = siguiente;
  }
  return acc;
}

const ids = (gs: ChoiceGroupLike[]) => gs.map((g) => g.choice_group_id);

describe("paridad viejo ↔ nuevo (spec 087)", () => {
  const viejo = agrupar(MENU_REAL);
  const nuevo = agruparConCondicion(MENU_REAL);

  it("el fixture tiene la condición traducida donde corresponde", () => {
    const guarnicion = nuevo.find((g) => g.choice_group_id === "gg")!;
    expect(guarnicion.applies_when_group_id).toBe("gp");
    expect(guarnicion.applies_when_product_ids).toEqual([
      "milanesa",
      "suprema",
      "arrollado",
      "merluza",
      "omelette",
    ]);
  });

  it("las dos formas resuelven idéntico en TODAS las combinaciones", () => {
    const todas = combinaciones(viejo);
    // 5 bebidas × 10 principales × 4 guarniciones (contando "sin elegir").
    expect(todas.length).toBe(5 * 10 * 4);

    const divergencias: string[] = [];
    for (const sel of todas) {
      const a = ids(activeChoiceGroups(viejo, sel));
      const b = ids(activeChoiceGroups(nuevo, sel));
      if (a.join(",") !== b.join(",")) {
        divergencias.push(
          `${JSON.stringify([...sel].map(([k, v]) => `${k}=${v.product_id}`))}: viejo=[${a}] nuevo=[${b}]`,
        );
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("sin elegir nada se ven los tres pasos, en las dos formas", () => {
    expect(ids(activeChoiceGroups(viejo, new Map()))).toEqual(["gb", "gp", "gg"]);
    expect(ids(activeChoiceGroups(nuevo, new Map()))).toEqual(["gb", "gp", "gg"]);
  });

  it("elegir ravioles saca la guarnición en las dos formas", () => {
    const sel = new Map([["gp", { product_id: "ravioles" }]]);
    expect(ids(activeChoiceGroups(viejo, sel))).toEqual(["gb", "gp"]);
    expect(ids(activeChoiceGroups(nuevo, sel))).toEqual(["gb", "gp"]);
  });

  it("elegir milanesa la deja en las dos formas", () => {
    const sel = new Map([["gp", { product_id: "milanesa" }]]);
    expect(ids(activeChoiceGroups(viejo, sel))).toEqual(["gb", "gp", "gg"]);
    expect(ids(activeChoiceGroups(nuevo, sel))).toEqual(["gb", "gp", "gg"]);
  });
});

describe("la condición del grupo, en lo que difiere del modelo viejo", () => {
  it("si la fuente no aplica, el grupo condicionado tampoco", () => {
    // A saca a B; B condicionaba a C. En el modelo viejo C volvía a estar
    // activo (B inactivo no emite bloqueos); en el nuevo C tampoco aplica,
    // porque su condición nunca se va a poder satisfacer. Es el único caso
    // donde cambian, y la auditoría verificó que no hay ninguno cargado.
    const grupos: ChoiceGroupLike[] = [
      { choice_group_id: "a", options: [{ product_id: "x", blocks_choice_group_ids: [] }] },
      {
        choice_group_id: "b",
        options: [{ product_id: "y", blocks_choice_group_ids: [] }],
        applies_when_group_id: "a",
        applies_when_product_ids: [], // ninguna opción de A la habilita
      },
      {
        choice_group_id: "c",
        options: [{ product_id: "z", blocks_choice_group_ids: [] }],
        applies_when_group_id: "b",
        applies_when_product_ids: ["y"],
      },
    ];
    const sel = new Map([["a", { product_id: "x" }]]);
    expect(ids(activeChoiceGroups(grupos, sel))).toEqual(["a"]);
  });

  it("un grupo sin condición nunca se desactiva solo", () => {
    const grupos: ChoiceGroupLike[] = [
      { choice_group_id: "a", options: [{ product_id: "x", blocks_choice_group_ids: [] }] },
      {
        choice_group_id: "b",
        options: [{ product_id: "y", blocks_choice_group_ids: [] }],
        applies_when_group_id: null,
        applies_when_product_ids: [],
      },
    ];
    const sel = new Map([["a", { product_id: "x" }]]);
    expect(ids(activeChoiceGroups(grupos, sel))).toEqual(["a", "b"]);
  });
});
