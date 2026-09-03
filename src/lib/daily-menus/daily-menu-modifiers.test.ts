import { describe, expect, it } from "vitest";

import {
  avisosDeModificadores,
  grupoQueDuplica,
  normalizarNombreDeGrupo,
} from "./daily-menu-modifiers";

/**
 * El editor de menús muestra los modificadores que trae cada producto
 * (spec 148).
 *
 * La colisión real de golf-jcr: el «Menu Ejecutivo» tiene un grupo condicional
 * «Guarnicion» y entre sus disparadores está la Milanesa, que ya trae un grupo
 * «Guarnición» propio. El asistente termina preguntando dos veces y eso no se
 * ve en ninguna parte del editor. Acá vive la regla de qué se va a preguntar y
 * qué se pisa — la normalización de nombres incluida, porque en golf-jcr
 * conviven «Guarnición» y «Guarnicion».
 */

const grupo = (
  name: string,
  is_required = false,
  sort_order = 0,
): { id: string; name: string; is_required: boolean; sort_order: number } => ({
  id: `mg-${name}-${sort_order}`,
  name,
  is_required,
  sort_order,
});

describe("normalizarNombreDeGrupo", () => {
  it("saca tildes, mayúsculas y espacios", () => {
    expect(normalizarNombreDeGrupo("Guarnición")).toBe("guarnicion");
    expect(normalizarNombreDeGrupo("  GUARNICION  ")).toBe("guarnicion");
    expect(normalizarNombreDeGrupo("Guar nición")).toBe("guarnicion");
  });

  it("un nombre vacío queda vacío", () => {
    expect(normalizarNombreDeGrupo("   ")).toBe("");
  });
});

describe("avisosDeModificadores", () => {
  it("un producto sin modificadores no genera avisos", () => {
    expect(avisosDeModificadores([], ["Guarnición"])).toEqual([]);
    expect(avisosDeModificadores(null, ["Guarnición"])).toEqual([]);
    expect(avisosDeModificadores(undefined, [])).toEqual([]);
  });

  it("lista los grupos del producto con su nombre y si son obligatorios", () => {
    const avisos = avisosDeModificadores(
      [grupo("Salsa para pasta", true), grupo("Queso extra", false, 1)],
      ["Plato principal"],
    );
    expect(avisos).toEqual([
      {
        id: "mg-Salsa para pasta-0",
        name: "Salsa para pasta",
        is_required: true,
        duplicaA: null,
      },
      {
        id: "mg-Queso extra-1",
        name: "Queso extra",
        is_required: false,
        duplicaA: null,
      },
    ]);
  });

  it("los ordena por sort_order, no por el orden en que vinieron", () => {
    const avisos = avisosDeModificadores(
      [grupo("Segundo", false, 2), grupo("Primero", false, 1)],
      [],
    );
    expect(avisos.map((a) => a.name)).toEqual(["Primero", "Segundo"]);
  });

  it("marca la duplicación cuando el combo ya pregunta lo mismo", () => {
    const avisos = avisosDeModificadores([grupo("Guarnición", true)], [
      "Plato principal",
      "Guarnición",
    ]);
    expect(avisos[0].duplicaA).toBe("Guarnición");
  });

  it("la coincidencia ignora tildes, mayúsculas y espacios", () => {
    // El caso real: el grupo del combo es «Guarnicion» y el del producto
    // «Guarnición».
    const avisos = avisosDeModificadores([grupo("Guarnición")], ["Guarnicion"]);
    expect(avisos[0].duplicaA).toBe("Guarnicion");

    const alReves = avisosDeModificadores([grupo(" guarnicion ")], [
      "GUARNICIÓN",
    ]);
    expect(alReves[0].duplicaA).toBe("GUARNICIÓN");
  });

  it("el caso legítimo no es conflicto: el Puré trae «Variante» dentro de «Guarnición»", () => {
    const avisos = avisosDeModificadores([grupo("Variante")], [
      "Plato principal",
      "Guarnición",
    ]);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].duplicaA).toBeNull();
  });

  it("un grupo sin nombre no matchea con otro sin nombre", () => {
    const avisos = avisosDeModificadores([grupo("  ")], ["", "   "]);
    expect(avisos[0].duplicaA).toBeNull();
  });

  it("con varios grupos del producto, marca sólo el que se pisa", () => {
    const avisos = avisosDeModificadores(
      [grupo("Guarnición", true), grupo("Punto de cocción", true, 1)],
      ["Guarnicion"],
    );
    expect(avisos.map((a) => a.duplicaA)).toEqual(["Guarnicion", null]);
  });
});

describe("grupoQueDuplica", () => {
  it("devuelve el grupo del producto que pregunta lo mismo", () => {
    expect(
      grupoQueDuplica([grupo("Guarnición"), grupo("Salsa", false, 1)], "Guarnicion"),
    ).toBe("Guarnición");
  });

  it("devuelve null cuando no hay coincidencia", () => {
    expect(grupoQueDuplica([grupo("Salsa")], "Guarnición")).toBeNull();
    expect(grupoQueDuplica([], "Guarnición")).toBeNull();
    expect(grupoQueDuplica(null, "Guarnición")).toBeNull();
  });

  it("un grupo del combo sin nombre no duplica nada", () => {
    expect(grupoQueDuplica([grupo("Guarnición")], "   ")).toBeNull();
  });
});
