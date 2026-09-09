import { describe, expect, it } from "vitest";

import {
  askableModifierGroups,
  isAutoResolved,
  isSingleChoiceGroup,
  missingSelections,
  resolveModifiers,
  type ComboModifierGroup,
} from "./combo-modifiers";

/**
 * Modificadores del producto elegido dentro del combo (spec 083).
 *
 * El caso real de golf-jcr: «Salsa para pasta» de los Ñoquis — obligatorio, 1
 * de 15, con la mitad de las salsas con adicional.
 */
function group(
  over: Partial<ComboModifierGroup> & { id: string },
): ComboModifierGroup {
  return {
    name: "Salsa para pasta",
    is_required: true,
    min_selection: 1,
    max_selection: 1,
    sort_order: 0,
    modifiers: [],
    ...over,
  };
}

const mod = (
  id: string,
  name: string,
  price_delta_cents = 0,
  is_available = true,
  sort_order = 0,
) => ({ id, name, price_delta_cents, is_available, sort_order });

const SALSA = group({
  id: "g-salsa",
  modifiers: [
    mod("m-fileto", "Fileto", 0, true, 0),
    mod("m-bolo", "Bolognesa", 450000, true, 1),
    mod("m-pomarola", "Pomarola con langostinos", 1450000, true, 2),
  ],
});

const GUARNICION = group({
  id: "g-guarni",
  name: "Guarnición",
  is_required: false,
  min_selection: 0,
  max_selection: 1,
  sort_order: 1,
  modifiers: [mod("m-papas", "Papas fritas"), mod("m-pure", "Puré", 0, true, 1)],
});

describe("askableModifierGroups", () => {
  it("ordena grupos y opciones por sort_order", () => {
    const desordenado = [
      group({ id: "b", sort_order: 2, modifiers: [mod("x", "X")] }),
      group({ id: "a", sort_order: 1, modifiers: [mod("z", "Z", 0, true, 5), mod("y", "Y", 0, true, 1)] }),
    ];
    const out = askableModifierGroups(desordenado);
    expect(out.map((g) => g.id)).toEqual(["a", "b"]);
    expect(out[0].modifiers.map((m) => m.name)).toEqual(["Y", "Z"]);
  });

  it("descarta los modificadores que la cocina apagó", () => {
    const conApagado = group({
      id: "g",
      modifiers: [mod("ok", "Fileto"), mod("no", "Pomarola", 0, false)],
    });
    expect(askableModifierGroups([conApagado])[0].modifiers.map((m) => m.name)).toEqual(["Fileto"]);
  });

  it("descarta el grupo que quedó sin opciones: sería un paso sin salida", () => {
    const vacio = group({ id: "g", modifiers: [mod("no", "Pomarola", 0, false)] });
    expect(askableModifierGroups([vacio])).toEqual([]);
  });

  it("sin grupos no rompe", () => {
    expect(askableModifierGroups(null)).toEqual([]);
    expect(askableModifierGroups(undefined)).toEqual([]);
  });
});

describe("isSingleChoiceGroup (FR-002 / FR-003)", () => {
  it("obligatorio y de a uno se comporta como un grupo del menú", () => {
    expect(isSingleChoiceGroup(SALSA)).toBe(true);
  });

  it("el opcional necesita confirmar: «ninguno» es una respuesta válida", () => {
    expect(isSingleChoiceGroup(GUARNICION)).toBe(false);
  });

  it("el de varias necesita confirmar", () => {
    expect(isSingleChoiceGroup(group({ id: "g", max_selection: 3 }))).toBe(false);
  });
});

describe("isAutoResolved", () => {
  it("un obligatorio con una sola opción no se pregunta", () => {
    expect(isAutoResolved(group({ id: "g", modifiers: [mod("uno", "Único")] }))).toBe(true);
  });

  it("con dos opciones sí se pregunta", () => {
    expect(isAutoResolved(SALSA)).toBe(false);
  });

  it("un opcional de una sola opción sí se pregunta: se puede no querer", () => {
    expect(
      isAutoResolved(group({ id: "g", is_required: false, min_selection: 0, modifiers: [mod("uno", "Único")] })),
    ).toBe(false);
  });
});

describe("missingSelections", () => {
  it("cuenta lo que falta para poder seguir", () => {
    expect(missingSelections(SALSA, [])).toBe(1);
    expect(missingSelections(SALSA, ["m-bolo"])).toBe(0);
  });

  it("el opcional nunca falta", () => {
    expect(missingSelections(GUARNICION, [])).toBe(0);
  });

  it("lo elegido en otro grupo no cuenta", () => {
    expect(missingSelections(SALSA, ["m-papas"])).toBe(1);
  });
});

describe("resolveModifiers · precio (FR-004)", () => {
  it("suma el adicional de lo elegido", () => {
    const r = resolveModifiers([SALSA], ["m-bolo"]);
    expect(r).toMatchObject({ ok: true, deltaCents: 450000 });
  });

  it("la opción sin cargo no suma", () => {
    expect(resolveModifiers([SALSA], ["m-fileto"])).toMatchObject({ ok: true, deltaCents: 0 });
  });

  it("suma los de varios grupos", () => {
    const multi = [SALSA, { ...GUARNICION, modifiers: [mod("m-papas", "Papas rejilla", 10000)] }];
    expect(resolveModifiers(multi, ["m-bolo", "m-papas"])).toMatchObject({
      ok: true,
      deltaCents: 460000,
    });
  });

  it("un delta negativo cargado a mano no abarata el combo", () => {
    const trucho = group({ id: "g", modifiers: [mod("m", "Trucha", -500000)] });
    expect(resolveModifiers([trucho], ["m"])).toMatchObject({ ok: true, deltaCents: 0 });
  });

  it("devuelve lo elegido para el snapshot", () => {
    const r = resolveModifiers([SALSA], ["m-bolo"]);
    expect(r.ok && r.chosen.map((m) => m.name)).toEqual(["Bolognesa"]);
  });
});

describe("resolveModifiers · validación (FR-006)", () => {
  it("rechaza un modificador de otro producto", () => {
    const r = resolveModifiers([SALSA], ["m-de-otro-plato"], "Ñoquis");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Ñoquis");
  });

  it("rechaza un obligatorio sin cubrir", () => {
    const r = resolveModifiers([SALSA], [], "Ñoquis");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Salsa para pasta");
  });

  it("rechaza pasarse del máximo", () => {
    const r = resolveModifiers([SALSA], ["m-fileto", "m-bolo"], "Ñoquis");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Hasta 1");
  });

  it("acepta dos cuando el grupo permite dos", () => {
    const dos = { ...SALSA, max_selection: 2 };
    expect(resolveModifiers([dos], ["m-fileto", "m-bolo"])).toMatchObject({ ok: true });
  });

  it("acepta vacío cuando el grupo es opcional", () => {
    expect(resolveModifiers([GUARNICION], [])).toMatchObject({ ok: true, deltaCents: 0 });
  });

  it("un modificador apagado se trata como inexistente", () => {
    const conApagado = group({
      id: "g",
      modifiers: [mod("ok", "Fileto"), mod("off", "Pomarola", 0, false)],
    });
    expect(resolveModifiers([conApagado], ["off"]).ok).toBe(false);
  });

  it("el id repetido no cuenta dos veces ni rompe el máximo", () => {
    expect(resolveModifiers([SALSA], ["m-bolo", "m-bolo"])).toMatchObject({
      ok: true,
      deltaCents: 450000,
    });
  });

  it("un producto sin grupos acepta vacío y rechaza cualquier id", () => {
    expect(resolveModifiers([], [])).toMatchObject({ ok: true, deltaCents: 0 });
    expect(resolveModifiers([], ["algo"]).ok).toBe(false);
  });
});

describe("askableModifierGroups · grupos apagados por el menú (spec 175)", () => {
  it("saca del paso el grupo que el menú apagó", () => {
    const out = askableModifierGroups([SALSA, GUARNICION], ["g-guarni"]);
    expect(out.map((g) => g.id)).toEqual(["g-salsa"]);
  });

  it("un array vacío es la conducta de siempre", () => {
    expect(askableModifierGroups([SALSA, GUARNICION], []).map((g) => g.id)).toEqual([
      "g-salsa",
      "g-guarni",
    ]);
    expect(askableModifierGroups([SALSA, GUARNICION]).map((g) => g.id)).toEqual([
      "g-salsa",
      "g-guarni",
    ]);
  });

  it("apaga un obligatorio sin chistar: es una decisión del menú, no un error", () => {
    expect(askableModifierGroups([SALSA], ["g-salsa"])).toEqual([]);
  });

  it("un id que ya no existe no rompe nada", () => {
    expect(
      askableModifierGroups([SALSA, GUARNICION], ["g-borrado-hace-un-mes"]).map(
        (g) => g.id,
      ),
    ).toEqual(["g-salsa", "g-guarni"]);
  });
});

describe("resolveModifiers · lo apagado tampoco se exige (spec 175 · D3)", () => {
  it("no reclama el mínimo de un grupo obligatorio que el menú apagó", () => {
    // Sin apagar, esto es un error: «Elegí 1 en "Salsa para pasta"».
    expect(resolveModifiers([SALSA], [], "Ñoquis")).toMatchObject({ ok: false });
    expect(resolveModifiers([SALSA], [], "Ñoquis", ["g-salsa"])).toMatchObject({
      ok: true,
      deltaCents: 0,
    });
  });

  it("un modificador de un grupo apagado ya no pertenece al producto", () => {
    const r = resolveModifiers([SALSA, GUARNICION], ["m-pure"], "Milanesa", [
      "g-guarni",
    ]);
    expect(r).toMatchObject({ ok: false });
  });
});
