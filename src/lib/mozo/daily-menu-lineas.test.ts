import { describe, expect, it } from "vitest";

import {
  deshacerEnPaso,
  elegirEnPaso,
  lineasValenIgual,
  lineasVacias,
  pasoActual,
  pasosDelBloque,
  proximaLineaDe,
  redimensionar,
  totalDelBloqueCents,
  type Linea,
} from "./daily-menu-lineas";
import type { DailyMenuSelection } from "./daily-menu-steps";
import type { DailyMenuChoiceGroup } from "./daily-menus-query";

/**
 * Un grupo con `n` opciones. `condicional` lo ata a las opciones del grupo
 * fuente que lo habilitan (spec 074) — es lo que hace que los pasos dejen de
 * ser uniformes entre líneas, que es el nudo de esta spec.
 */
function group(
  id: string,
  label: string,
  n: number,
  condicional?: { deGrupo: string; conProductos: string[] },
  modsPorOpcion: Record<
    number,
    { id: string; name: string; delta?: number }[]
  > = {},
): DailyMenuChoiceGroup {
  return {
    choice_group_id: id,
    label,
    applies_when_group_id: condicional?.deGrupo ?? null,
    applies_when_product_ids: condicional?.conProductos ?? [],
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
      blocks_choice_group_ids: [],
      sort_order: i,
      ignored_modifier_group_ids: [],
      modifier_groups: (modsPorOpcion[i] ?? []).length
        ? [
            {
              id: `${id}-mg-${i}`,
              name: "Salsa",
              is_required: true,
              min_selection: 1,
              max_selection: 1,
              sort_order: 0,
              modifiers: modsPorOpcion[i]!.map((m) => ({
                id: m.id,
                name: m.name,
                price_delta_cents: m.delta ?? 0,
                is_available: true,
                sort_order: 0,
              })),
            },
          ]
        : [],
    })),
  };
}

function seleccion(
  groupId: string,
  optIndex: number,
  extra = 0,
): DailyMenuSelection {
  return {
    choice_group_id: groupId,
    choice_group_label: groupId,
    product_id: `${groupId}-prod-${optIndex}`,
    product_name: `Producto ${optIndex}`,
    extra_price_cents: extra,
    modifier_ids: [],
  };
}

/** Elige `opt` en el paso actual, tantas veces como se le pida. */
function elegirVeces(
  groups: DailyMenuChoiceGroup[],
  lineas: Linea[],
  optIndex: number,
  veces: number,
  extra = 0,
): Linea[] {
  let out = lineas;
  for (let i = 0; i < veces; i++) {
    const paso = pasoActual(groups, out);
    if (!paso || paso.step.kind !== "choice") break;
    out = elegirEnPaso(
      out,
      paso,
      seleccion(paso.step.group.choice_group_id, optIndex, extra),
    );
  }
  return out;
}

const BEBIDA = group("bebida", "Bebida", 3);
const PRINCIPAL = group("principal", "Plato principal", 3);

describe("un solo menú: nada cambia", () => {
  it("el recorrido es el mismo que el del asistente de a uno", () => {
    const groups = [BEBIDA, PRINCIPAL];
    let lineas = lineasVacias(1);

    const p1 = pasoActual(groups, lineas)!;
    expect(p1.step.kind).toBe("choice");
    expect(p1.faltan).toBe(1);

    lineas = elegirEnPaso(lineas, p1, seleccion("bebida", 0));
    const p2 = pasoActual(groups, lineas)!;
    expect(p2.clave).toBe("choice:principal");
    expect(p2.faltan).toBe(1);

    lineas = elegirEnPaso(lineas, p2, seleccion("principal", 1));
    expect(pasoActual(groups, lineas)).toBeNull();
  });
});

describe("varios menús, por vuelta de mesa", () => {
  it("un paso espera tantas elecciones como líneas hay", () => {
    const lineas = lineasVacias(4);
    const paso = pasoActual([BEBIDA, PRINCIPAL], lineas)!;

    expect(paso.clave).toBe("choice:bebida");
    expect(paso.lineas).toEqual([0, 1, 2, 3]);
    expect(paso.faltan).toBe(4);
  });

  it("elegir opciones distintas en el mismo paso reparte una por línea", () => {
    const groups = [BEBIDA, PRINCIPAL];
    let lineas = lineasVacias(4);

    lineas = elegirVeces(groups, lineas, 0, 2); // 2 gaseosas
    lineas = elegirVeces(groups, lineas, 1, 1); // 1 agua
    let paso = pasoActual(groups, lineas)!;
    expect(paso.clave).toBe("choice:bebida");
    expect(paso.faltan).toBe(1);

    lineas = elegirVeces(groups, lineas, 2, 1); // 1 vino
    paso = pasoActual(groups, lineas)!;
    // Recién con las 4 bebidas pasa al principal.
    expect(paso.clave).toBe("choice:principal");
    expect(paso.faltan).toBe(4);

    const bebidas = lineas.map((l) => l.get("bebida")!.product_id);
    expect(bebidas).toEqual([
      "bebida-prod-0",
      "bebida-prod-0",
      "bebida-prod-1",
      "bebida-prod-2",
    ]);
  });

  it("no avanza de paso hasta que todas las líneas eligieron", () => {
    const groups = [BEBIDA, PRINCIPAL];
    const lineas = elegirVeces(groups, lineasVacias(3), 0, 2);
    expect(pasoActual(groups, lineas)!.clave).toBe("choice:bebida");
  });

  it("un toque de más sobre un paso completo no inventa una línea", () => {
    const groups = [BEBIDA];
    const lineas = elegirVeces(groups, lineasVacias(2), 0, 2);
    const paso = pasosDelBloque(groups, lineas)[0]!;

    expect(proximaLineaDe(paso, lineas)).toBe(-1);
    expect(elegirEnPaso(lineas, paso, seleccion("bebida", 1))).toBe(lineas);
    expect(lineas).toHaveLength(2);
  });
});

describe("grupos condicionales: el paso aplica a un subconjunto", () => {
  // «Guarnición» sólo si el principal es la opción 0 (la milanesa).
  const GUARNICION = group("guarnicion", "Guarnición", 2, {
    deGrupo: "principal",
    conProductos: ["principal-prod-0"],
  });
  const groups = [PRINCIPAL, GUARNICION];

  it("pide sólo por las líneas que lo disparan", () => {
    let lineas = lineasVacias(4);
    lineas = elegirVeces(groups, lineas, 0, 2); // 2 milanesas
    lineas = elegirVeces(groups, lineas, 1, 2); // 2 ñoquis

    const paso = pasoActual(groups, lineas)!;
    expect(paso.clave).toBe("choice:guarnicion");
    // 2 de las 4: sólo las milanesas.
    expect(paso.lineas).toEqual([0, 1]);
    expect(paso.faltan).toBe(2);
  });

  it("si ninguna lo dispara, el paso no existe", () => {
    const lineas = elegirVeces(groups, lineasVacias(3), 1, 3); // 3 ñoquis
    expect(pasoActual(groups, lineas)).toBeNull();
    expect(pasosDelBloque(groups, lineas).map((p) => p.clave)).toEqual([
      "choice:principal",
    ]);
  });

  it("si todas lo disparan, el paso pide por todas", () => {
    const lineas = elegirVeces(groups, lineasVacias(3), 0, 3); // 3 milanesas
    expect(pasoActual(groups, lineas)!.faltan).toBe(3);
  });
});

describe("modificadores del producto elegido (spec 083)", () => {
  // La opción 0 lleva salsa; la 1 no. Dos líneas con platos distintos generan
  // preguntas distintas, y sólo la que lleva salsa cuenta para ese paso.
  const CON_SALSA = group("plato", "Plato", 2, undefined, {
    0: [
      { id: "salsa-bolo", name: "Bolognesa", delta: 450000 },
      { id: "salsa-crema", name: "Crema" },
    ],
  });

  it("el paso de modificadores cuenta sólo las líneas que lo tienen", () => {
    const groups = [CON_SALSA];
    let lineas = lineasVacias(3);
    lineas = elegirVeces(groups, lineas, 0, 2); // 2 pastas
    lineas = elegirVeces(groups, lineas, 1, 1); // 1 sin salsa

    const paso = pasoActual(groups, lineas)!;
    expect(paso.step.kind).toBe("modifiers");
    expect(paso.lineas).toEqual([0, 1]);
    expect(paso.faltan).toBe(2);
  });

  it("elegir el modificador lo guarda en la línea y avanza el contador", () => {
    const groups = [CON_SALSA];
    let lineas = elegirVeces(groups, lineasVacias(2), 0, 2);

    const paso = pasoActual(groups, lineas)!;
    lineas = elegirEnPaso(lineas, paso, {
      ...seleccion("plato", 0),
      modifier_ids: ["salsa-bolo"],
      modifiers: [
        {
          id: "salsa-bolo",
          name: "Bolognesa",
          price_delta_cents: 450000,
          is_available: true,
          sort_order: 0,
        },
      ],
    });

    expect(lineas[0]!.get("plato")!.modifier_ids).toEqual(["salsa-bolo"]);
    expect(pasoActual(groups, lineas)!.faltan).toBe(1);
  });
});

describe("volver atrás", () => {
  it("deshace la última elección del paso, no la primera", () => {
    const groups = [BEBIDA];
    let lineas = elegirVeces(groups, lineasVacias(3), 0, 2);
    const paso = pasosDelBloque(groups, lineas)[0]!;

    lineas = deshacerEnPaso(lineas, paso);
    expect(lineas[0]!.has("bebida")).toBe(true);
    expect(lineas[1]!.has("bebida")).toBe(false);
    expect(pasoActual(groups, lineas)!.faltan).toBe(2);
  });
});

describe("la plata: la suma de las líneas, no precio × cantidad", () => {
  it("con adicionales distintos el total NO es el precio multiplicado", () => {
    const groups = [BEBIDA];
    let lineas = lineasVacias(3);
    // Dos aguas sin adicional y un vino que suma $8.000.
    lineas = elegirVeces(groups, lineas, 0, 2, 0);
    lineas = elegirVeces(groups, lineas, 1, 1, 800000);

    expect(totalDelBloqueCents(2_400_000, lineas)).toBe(
      2_400_000 * 3 + 800_000,
    );
    expect(lineasValenIgual(lineas)).toBe(false);
  });

  it("sin adicionales el total coincide con precio × cantidad", () => {
    const lineas = elegirVeces([BEBIDA], lineasVacias(4), 0, 4);
    expect(totalDelBloqueCents(2_400_000, lineas)).toBe(2_400_000 * 4);
    expect(lineasValenIgual(lineas)).toBe(true);
  });
});

describe("cambiar la cantidad a mitad de camino", () => {
  it("agregar líneas conserva lo ya elegido", () => {
    const groups = [BEBIDA];
    const lineas = redimensionar(elegirVeces(groups, lineasVacias(2), 0, 2), 4);

    expect(lineas).toHaveLength(4);
    expect(lineas[0]!.has("bebida")).toBe(true);
    expect(lineas[3]!.has("bebida")).toBe(false);
    expect(pasoActual(groups, lineas)!.faltan).toBe(2);
  });

  it("sacar líneas corta desde el final", () => {
    const lineas = redimensionar(
      elegirVeces([BEBIDA], lineasVacias(4), 0, 4),
      2,
    );
    expect(lineas).toHaveLength(2);
    expect(pasoActual([BEBIDA], lineas)).toBeNull();
  });

  it("nunca baja de una línea", () => {
    expect(redimensionar(lineasVacias(3), 0)).toHaveLength(1);
    expect(lineasVacias(0)).toHaveLength(1);
  });
});
