import { describe, it, expect } from "vitest";

import { resolveComboUpcharge, type ComboChoiceComponent } from "./combo-pricing";

let nextSortOrder = 0;
const choice = (
  choice_group_id: string,
  product_id: string,
  extra_price_cents: number,
  blocks_choice_group_ids: string[] = [],
): ComboChoiceComponent => ({
  kind: "choice",
  choice_group_id,
  product_id,
  sort_order: nextSortOrder++,
  extra_price_cents,
  blocks_choice_group_ids,
});

describe("resolveComboUpcharge", () => {
  it("toma el adicional de la DB de cada opción elegida", () => {
    const components = [
      choice("bebida", "agua", 0),
      choice("bebida", "cerveza", 80000),
    ];
    const r = resolveComboUpcharge(components, [
      { choice_group_id: "bebida", product_id: "cerveza" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deltaCents).toBe(80000);
      expect(r.choices).toEqual([
        { choice_group_id: "bebida", product_id: "cerveza", extra_price_cents: 80000 },
      ]);
    }
  });

  it("la opción base ($0) no cambia el precio", () => {
    const components = [
      choice("bebida", "agua", 0),
      choice("bebida", "cerveza", 80000),
    ];
    const r = resolveComboUpcharge(components, [
      { choice_group_id: "bebida", product_id: "agua" },
    ]);
    expect(r.ok && r.deltaCents).toBe(0);
  });

  it("ignora cualquier precio falseado en el payload — usa el de la DB", () => {
    const components = [choice("bebida", "cerveza", 80000)];
    // El payload manipulado intenta inflar el precio; la función sólo mira la DB.
    const r = resolveComboUpcharge(components, [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { choice_group_id: "bebida", product_id: "cerveza", extra_price_cents: 1 } as any,
    ]);
    expect(r.ok && r.deltaCents).toBe(80000);
  });

  it("rechaza una opción que no pertenece al grupo del menú", () => {
    const components = [choice("bebida", "agua", 0)];
    const r = resolveComboUpcharge(components, [
      { choice_group_id: "bebida", product_id: "whisky" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("suma los adicionales de varios grupos", () => {
    const components = [
      choice("bebida", "cerveza", 80000),
      choice("postre", "flan", 50000),
      choice("postre", "fruta", 0),
    ];
    const r = resolveComboUpcharge(components, [
      { choice_group_id: "bebida", product_id: "cerveza" },
      { choice_group_id: "postre", product_id: "flan" },
    ]);
    expect(r.ok && r.deltaCents).toBe(130000);
  });

  it("un menú sin grupos de opciones no tiene adicional", () => {
    const r = resolveComboUpcharge([], []);
    expect(r.ok && r.deltaCents).toBe(0);
  });

  it("rechaza el payload vacío si el menú tiene un grupo (spec 074 · D-GCM-5)", () => {
    // Antes esto devolvía delta 0 y la orden se persistía sin la opción: como
    // el grupo puede tener un adicional, un payload armado a mano se saltaba
    // el upcharge. D-MDR-4 la sostenía sólo el cliente.
    const components = [choice("bebida", "cerveza", 80000)];
    expect(resolveComboUpcharge(components, []).ok).toBe(false);
  });

  it("no cobra el adicional de un grupo que la opción elegida bloquea", () => {
    const principal = "principal";
    const guarnicion = "guarnicion";
    const components = [
      choice(principal, "milanesa", 0),
      choice(principal, "ravioles", 0, [guarnicion]),
      choice(guarnicion, "papas-fritas", 90000),
    ];
    // Con milanesa la guarnición aplica y se cobra.
    const conGuarnicion = resolveComboUpcharge(components, [
      { choice_group_id: principal, product_id: "milanesa" },
      { choice_group_id: guarnicion, product_id: "papas-fritas" },
    ]);
    expect(conGuarnicion.ok && conGuarnicion.deltaCents).toBe(90000);

    // Con ravioles no aplica: colarla es rechazo, no un cobro de más.
    const colada = resolveComboUpcharge(components, [
      { choice_group_id: principal, product_id: "ravioles" },
      { choice_group_id: guarnicion, product_id: "papas-fritas" },
    ]);
    expect(colada.ok).toBe(false);

    // Y sin ella el combo queda en el precio base.
    const sinGuarnicion = resolveComboUpcharge(components, [
      { choice_group_id: principal, product_id: "ravioles" },
    ]);
    expect(sinGuarnicion.ok && sinGuarnicion.deltaCents).toBe(0);
  });
});
