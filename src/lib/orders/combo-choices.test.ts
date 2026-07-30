import { describe, expect, it } from "vitest";

import {
  orderedChoiceGroupIds,
  resolveActiveGroupIds,
  validateComboChoices,
  type ComboChoiceComponent,
} from "./combo-choices";

const PRINCIPAL = "22222222-2222-2222-2222-222222222222";
const GUARNICION = "33333333-3333-3333-3333-333333333333";
const POSTRE = "44444444-4444-4444-4444-444444444444";

/** Una opción de un grupo. `blocks` = grupos que NO aplican si se la elige. */
function option(
  groupId: string,
  productId: string,
  sortOrder: number,
  blocks: string[] = [],
  extra = 0,
): ComboChoiceComponent {
  return {
    kind: "choice",
    choice_group_id: groupId,
    product_id: productId,
    sort_order: sortOrder,
    extra_price_cents: extra,
    blocks_choice_group_ids: blocks,
  };
}

function fixed(sortOrder: number): ComboChoiceComponent {
  return {
    kind: "text",
    choice_group_id: null,
    product_id: null,
    sort_order: sortOrder,
    extra_price_cents: 0,
    blocks_choice_group_ids: [],
  };
}

/** Menú del caso real: Principal (milanesa lleva guarnición, ravioles no) +
 *  Guarnición + Postre. */
const MENU: ComboChoiceComponent[] = [
  fixed(0),
  option(PRINCIPAL, "milanesa", 1),
  option(PRINCIPAL, "ravioles", 2, [GUARNICION]),
  option(GUARNICION, "papas", 3),
  option(GUARNICION, "ensalada", 4),
  option(POSTRE, "flan", 5),
];

describe("orderedChoiceGroupIds", () => {
  it("saca los grupos en orden de sort_order, sin repetir y sin los componentes fijos", () => {
    expect(orderedChoiceGroupIds(MENU)).toEqual([PRINCIPAL, GUARNICION, POSTRE]);
  });

  it("no depende de que los componentes vengan ordenados", () => {
    const desordenado = [...MENU].reverse();
    expect(orderedChoiceGroupIds(desordenado)).toEqual([
      PRINCIPAL,
      GUARNICION,
      POSTRE,
    ]);
  });

  it("un menú sin grupos no tiene grupos", () => {
    expect(orderedChoiceGroupIds([fixed(0), fixed(1)])).toEqual([]);
  });
});

describe("resolveActiveGroupIds", () => {
  const orden = [PRINCIPAL, GUARNICION, POSTRE];

  it("sin nada elegido, todos los grupos están activos", () => {
    expect(resolveActiveGroupIds(orden, new Map())).toEqual(orden);
  });

  it("una opción que no bloquea nada deja todo activo", () => {
    const blocks = new Map([[PRINCIPAL, [] as string[]]]);
    expect(resolveActiveGroupIds(orden, blocks)).toEqual(orden);
  });

  it("elegir los ravioles saca la guarnición y deja el postre", () => {
    const blocks = new Map([[PRINCIPAL, [GUARNICION]]]);
    expect(resolveActiveGroupIds(orden, blocks)).toEqual([PRINCIPAL, POSTRE]);
  });

  it("una opción puede bloquear más de un grupo", () => {
    const blocks = new Map([[PRINCIPAL, [GUARNICION, POSTRE]]]);
    expect(resolveActiveGroupIds(orden, blocks)).toEqual([PRINCIPAL]);
  });

  it("cadena de dos niveles: el bloqueo de un grupo inactivo NO cuenta", () => {
    // Principal saca Guarnición; la guarnición elegida sacaba el Postre, pero
    // ya no aplica, así que el postre vuelve a estar activo. Es exactamente el
    // caso que obliga a resolver en orden y no acumulando bloqueos sueltos.
    const blocks = new Map([
      [PRINCIPAL, [GUARNICION]],
      [GUARNICION, [POSTRE]],
    ]);
    expect(resolveActiveGroupIds(orden, blocks)).toEqual([PRINCIPAL, POSTRE]);
  });

  it("un grupo que bloquea a uno anterior no tiene efecto (sólo hacia adelante)", () => {
    // D-GCM-3: la validación del admin lo impide, pero si un dato viejo o
    // corrupto lo trae, la resolución no puede desarmarse.
    const blocks = new Map([[POSTRE, [PRINCIPAL]]]);
    expect(resolveActiveGroupIds(orden, blocks)).toEqual(orden);
  });

  it("un grupo no puede bloquearse a sí mismo", () => {
    const blocks = new Map([[PRINCIPAL, [PRINCIPAL]]]);
    expect(resolveActiveGroupIds(orden, blocks)).toEqual(orden);
  });
});

describe("validateComboChoices", () => {
  it("acepta una elección por grupo cuando ninguno está bloqueado", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: PRINCIPAL, product_id: "milanesa" },
      { choice_group_id: GUARNICION, product_id: "papas" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.activeGroupIds).toEqual([PRINCIPAL, GUARNICION, POSTRE]);
    }
  });

  it("acepta que falte la guarnición cuando el principal la bloquea", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: PRINCIPAL, product_id: "ravioles" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.activeGroupIds).toEqual([PRINCIPAL, POSTRE]);
    }
  });

  it("rechaza una guarnición cuando el principal elegido no la permite", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: PRINCIPAL, product_id: "ravioles" },
      { choice_group_id: GUARNICION, product_id: "papas" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(false);
  });

  // ── Hueco preexistente que esta spec cierra (D-GCM-5) ──

  it("rechaza que falte un grupo activo", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: PRINCIPAL, product_id: "milanesa" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rechaza dos elecciones del mismo grupo", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: PRINCIPAL, product_id: "milanesa" },
      { choice_group_id: GUARNICION, product_id: "papas" },
      { choice_group_id: GUARNICION, product_id: "ensalada" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rechaza un payload vacío en un menú que sí tiene grupos", () => {
    expect(validateComboChoices(MENU, []).ok).toBe(false);
  });

  it("rechaza una opción que no pertenece a ese grupo", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: PRINCIPAL, product_id: "papas" },
      { choice_group_id: GUARNICION, product_id: "papas" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("acepta un payload vacío en un menú sin grupos", () => {
    const result = validateComboChoices([fixed(0), fixed(1)], []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.activeGroupIds).toEqual([]);
  });

  it("no se apoya en el orden del payload", () => {
    const result = validateComboChoices(MENU, [
      { choice_group_id: POSTRE, product_id: "flan" },
      { choice_group_id: GUARNICION, product_id: "ensalada" },
      { choice_group_id: PRINCIPAL, product_id: "milanesa" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("no se apoya en que los componentes vengan ordenados", () => {
    const result = validateComboChoices([...MENU].reverse(), [
      { choice_group_id: PRINCIPAL, product_id: "ravioles" },
      { choice_group_id: POSTRE, product_id: "flan" },
    ]);
    expect(result.ok).toBe(true);
  });
});
