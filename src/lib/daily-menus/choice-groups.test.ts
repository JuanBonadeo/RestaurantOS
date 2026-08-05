import { describe, expect, it } from "vitest";

import { deriveChoiceGroups } from "./choice-groups";
import type { DailyMenuComponentInput } from "./schemas";

/**
 * La traducción del modelo viejo (condición negativa por opción) al nuevo
 * (positiva por grupo), spec 087. Tiene que dar exactamente lo mismo que el
 * backfill SQL de la migración `0036`: si divergen, un menú cambia de
 * comportamiento con sólo abrirlo y guardarlo.
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

const texto = (label: string): DailyMenuComponentInput => ({ label, kind: "text" });

describe("deriveChoiceGroups", () => {
  it("un grupo por choice_group_id, con nombre y posición de su primera opción", () => {
    const grupos = deriveChoiceGroups([
      texto("Pan"),
      opcion("g1", "Entrada", "empanadas"),
      opcion("g1", "Entrada", "provoleta"),
      opcion("g2", "Principal", "milanesa"),
    ]);
    expect(grupos).toEqual([
      { id: "g1", name: "Entrada", sort_order: 1, applies_when_group_id: null, applies_when_product_ids: [] },
      { id: "g2", name: "Principal", sort_order: 3, applies_when_group_id: null, applies_when_product_ids: [] },
    ]);
  });

  it("sin label usa un nombre por defecto", () => {
    const [g] = deriveChoiceGroups([opcion("g1", "", "x")]);
    expect(g.name).toBe("Elegí una opción");
  });

  it("si la primera opción no trae label, vale el primero que lo tenga", () => {
    const [g] = deriveChoiceGroups([
      opcion("g1", "", "x"),
      opcion("g1", "Entrada", "y"),
    ]);
    expect(g.name).toBe("Entrada");
  });

  it("un menú sin grupos no devuelve nada", () => {
    expect(deriveChoiceGroups([texto("Pan")])).toEqual([]);
  });
});

describe("deriveChoiceGroups · la condición se arma por complemento", () => {
  /** El caso real de golf-jcr: 4 de los principales no llevan guarnición. */
  const MENU: DailyMenuComponentInput[] = [
    opcion("gp", "Plato Principal", "milanesa"),
    opcion("gp", "Plato Principal", "suprema"),
    opcion("gp", "Plato Principal", "noquis", ["gg"]),
    opcion("gp", "Plato Principal", "ravioles", ["gg"]),
    opcion("gg", "Guarnición", "papas"),
    opcion("gg", "Guarnición", "pure"),
  ];

  it("el grupo bloqueado queda habilitado por las opciones que NO lo bloquean", () => {
    const grupos = deriveChoiceGroups(MENU);
    const guarnicion = grupos.find((g) => g.id === "gg")!;
    expect(guarnicion.applies_when_group_id).toBe("gp");
    expect(guarnicion.applies_when_product_ids).toEqual(["milanesa", "suprema"]);
  });

  it("el grupo que bloquea no gana condición", () => {
    expect(deriveChoiceGroups(MENU).find((g) => g.id === "gp")).toMatchObject({
      applies_when_group_id: null,
      applies_when_product_ids: [],
    });
  });

  it("sin bloqueos, ningún grupo tiene condición", () => {
    const grupos = deriveChoiceGroups([
      opcion("gp", "Principal", "milanesa"),
      opcion("gg", "Guarnición", "papas"),
    ]);
    expect(grupos.every((g) => g.applies_when_group_id === null)).toBe(true);
  });

  it("si TODAS las opciones de la fuente lo bloquean, queda habilitado por ninguna", () => {
    const grupos = deriveChoiceGroups([
      opcion("gp", "Principal", "noquis", ["gg"]),
      opcion("gp", "Principal", "ravioles", ["gg"]),
      opcion("gg", "Guarnición", "papas"),
    ]);
    expect(grupos.find((g) => g.id === "gg")).toMatchObject({
      applies_when_group_id: "gp",
      applies_when_product_ids: [],
    });
  });

  it("bloqueado desde DOS grupos: no se traduce, queda sin condición", () => {
    // Haría falta un AND de condiciones, que el modelo nuevo no expresa.
    const grupos = deriveChoiceGroups([
      opcion("ga", "Bebida", "agua", ["gg"]),
      opcion("gb", "Principal", "noquis", ["gg"]),
      opcion("gg", "Guarnición", "papas"),
    ]);
    expect(grupos.find((g) => g.id === "gg")).toMatchObject({
      applies_when_group_id: null,
      applies_when_product_ids: [],
    });
  });

  it("un bloqueo hacia atrás se ignora: ya era inaplicable en runtime", () => {
    const grupos = deriveChoiceGroups([
      opcion("gg", "Guarnición", "papas"),
      opcion("gp", "Principal", "noquis", ["gg"]),
    ]);
    expect(grupos.find((g) => g.id === "gg")?.applies_when_group_id).toBeNull();
  });

  it("un bloqueo a un grupo inexistente no inventa condición", () => {
    const grupos = deriveChoiceGroups([
      opcion("gp", "Principal", "noquis", ["fantasma"]),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].applies_when_group_id).toBeNull();
  });

  it("una opción que se bloquea a sí misma no se condiciona sola", () => {
    const grupos = deriveChoiceGroups([opcion("gp", "Principal", "x", ["gp"])]);
    expect(grupos[0].applies_when_group_id).toBeNull();
  });

  it("no duplica productos si la fuente repite uno", () => {
    const grupos = deriveChoiceGroups([
      opcion("gp", "Principal", "milanesa"),
      opcion("gp", "Principal", "milanesa"),
      opcion("gp", "Principal", "noquis", ["gg"]),
      opcion("gg", "Guarnición", "papas"),
    ]);
    expect(grupos.find((g) => g.id === "gg")?.applies_when_product_ids).toEqual([
      "milanesa",
    ]);
  });
});
