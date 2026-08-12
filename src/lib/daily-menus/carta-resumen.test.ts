import { describe, expect, it } from "vitest";

import { disponibilidadTexto, pasosDelMenu } from "./carta-resumen";
import type { MenuDailyMenuChoiceGroup, MenuDailyMenuComponent } from "@/lib/menu";

function componente(
  over: Partial<MenuDailyMenuComponent> & { sort_order: number },
): MenuDailyMenuComponent {
  return {
    id: `c${over.sort_order}`,
    label: "",
    description: null,
    kind: "text",
    product_id: null,
    product_name: null,
    product_image_url: null,
    choice_group_id: null,
    choice_group_label: null,
    extra_price_cents: 0,
    blocks_choice_group_ids: [],
    ...over,
  };
}

function grupo(
  id: string,
  label: string,
): MenuDailyMenuChoiceGroup {
  return {
    choice_group_id: id,
    label,
    options: [],
    applies_when_group_id: null,
    applies_when_product_ids: [],
  };
}

describe("pasosDelMenu", () => {
  it("nombra cada grupo una sola vez, en el orden del menú", () => {
    const pasos = pasosDelMenu({
      components: [
        componente({ sort_order: 0, kind: "choice", choice_group_id: "g1", label: "Gaseosa" }),
        componente({ sort_order: 1, kind: "choice", choice_group_id: "g1", label: "Agua" }),
        componente({ sort_order: 2, kind: "choice", choice_group_id: "g2", label: "Milanesa" }),
        componente({ sort_order: 3, kind: "choice", choice_group_id: "g2", label: "Ñoquis" }),
      ],
      choice_groups: [grupo("g1", "Bebida"), grupo("g2", "Plato principal")],
    });
    expect(pasos).toEqual(["Bebida", "Plato principal"]);
  });

  it("ordena por sort_order y aguanta grupos intercalados", () => {
    const pasos = pasosDelMenu({
      components: [
        componente({ sort_order: 3, kind: "choice", choice_group_id: "g1" }),
        componente({ sort_order: 0, kind: "choice", choice_group_id: "g1" }),
        componente({ sort_order: 1, kind: "choice", choice_group_id: "g2" }),
      ],
      choice_groups: [grupo("g2", "Postre"), grupo("g1", "Entrada")],
    });
    expect(pasos).toEqual(["Entrada", "Postre"]);
  });

  it("un menú sin grupos muestra sus componentes sueltos", () => {
    const pasos = pasosDelMenu({
      components: [
        componente({ sort_order: 0, label: "Entrada del día" }),
        componente({ sort_order: 1, label: "Plato principal" }),
        componente({ sort_order: 2, label: "Postre" }),
      ],
      choice_groups: [],
    });
    expect(pasos).toEqual(["Entrada del día", "Plato principal", "Postre"]);
  });

  it("cae al nombre del producto cuando el componente no tiene label", () => {
    const pasos = pasosDelMenu({
      components: [
        componente({
          sort_order: 0,
          kind: "product",
          label: "  ",
          product_id: "p1",
          product_name: "Flan casero",
        }),
      ],
      choice_groups: [],
    });
    expect(pasos).toEqual(["Flan casero"]);
  });

  // El label vive en `daily_menu_choice_groups` (spec 087) y el catálogo público
  // ni siquiera trae `choice_group_label`: si lo leyéramos del componente, la
  // carta listaría grupos vacíos.
  it("toma el nombre del grupo de choice_groups, no del componente", () => {
    const pasos = pasosDelMenu({
      components: [
        componente({
          sort_order: 0,
          kind: "choice",
          choice_group_id: "g1",
          choice_group_label: null,
          label: "Papas fritas",
        }),
      ],
      choice_groups: [grupo("g1", "Guarnición")],
    });
    expect(pasos).toEqual(["Guarnición"]);
  });

  it("sin nada que nombrar, no inventa pasos", () => {
    expect(pasosDelMenu({ components: [], choice_groups: [] })).toEqual([]);
    expect(
      pasosDelMenu({
        components: [componente({ sort_order: 0, label: "   " })],
        choice_groups: [],
      }),
    ).toEqual([]);
  });
});

describe("disponibilidadTexto", () => {
  it("los siete días son «todos los días»", () => {
    expect(disponibilidadTexto([0, 1, 2, 3, 4, 5, 6])).toBe("Todos los días");
  });

  it("un tramo corrido se dice como rango", () => {
    expect(disponibilidadTexto([1, 2, 3, 4, 5])).toBe("De lunes a viernes");
    expect(disponibilidadTexto([1, 2, 3, 4])).toBe("De lunes a jueves");
  });

  // La semana arranca el lunes: sábado y domingo son contiguos, no los extremos.
  it("el fin de semana se lee como par, no como rango", () => {
    expect(disponibilidadTexto([0, 6])).toBe("Los sábados y domingos");
  });

  it("dos o tres días sueltos se enumeran", () => {
    expect(disponibilidadTexto([3])).toBe("Los miércoles");
    expect(disponibilidadTexto([1, 3, 5])).toBe("Los lunes, miércoles y viernes");
    expect(disponibilidadTexto([0, 1])).toBe("Los lunes y domingos");
  });

  it("no depende del orden ni de los repetidos del array", () => {
    expect(disponibilidadTexto([5, 1, 3, 3])).toBe("Los lunes, miércoles y viernes");
  });

  // La columna arranca en '{}' (spec 109): sin días, la carta no dice nada en
  // vez de afirmar una disponibilidad que no existe.
  it("sin días configurados no dice nada", () => {
    expect(disponibilidadTexto([])).toBe("");
    expect(disponibilidadTexto(null)).toBe("");
    expect(disponibilidadTexto([9, -1])).toBe("");
  });
});
