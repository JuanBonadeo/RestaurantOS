import { describe, expect, it } from "vitest";

import {
  fitNameToTable,
  isPlaceholderName,
  tableDisplayName,
} from "./table-display-name";

describe("isPlaceholderName", () => {
  it("los rótulos del sistema no son nombres", () => {
    for (const v of ["Mesa", "mesa", "Walk-in", "WALK-IN", "-", "—", "Sin nombre"]) {
      expect(isPlaceholderName(v)).toBe(true);
    }
  });

  it("vacío, espacios y null tampoco", () => {
    expect(isPlaceholderName("")).toBe(true);
    expect(isPlaceholderName("   ")).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
  });

  it("una persona sí", () => {
    expect(isPlaceholderName("Gutiérrez")).toBe(false);
    // Ojo: "Mesa" sola es placeholder, pero un apellido que la contenga no.
    expect(isPlaceholderName("Mesagno")).toBe(false);
  });
});

describe("tableDisplayName", () => {
  it("la reserva manda sobre la orden", () => {
    expect(
      tableDisplayName({ customer_name: "Gutiérrez" }, { customer_name: "Pedro" }),
    ).toBe("Gutiérrez");
  });

  it("sin reserva usa el nombre de la orden", () => {
    expect(tableDisplayName(null, { customer_name: "Pedro" })).toBe("Pedro");
  });

  it("ignora los placeholders de la orden", () => {
    expect(tableDisplayName(null, { customer_name: "Mesa" })).toBeNull();
    expect(tableDisplayName(null, { customer_name: "Walk-in" })).toBeNull();
    expect(tableDisplayName(null, { customer_name: "  " })).toBeNull();
  });

  it("una reserva con placeholder no tapa el nombre real de la orden", () => {
    expect(
      tableDisplayName({ customer_name: "-" }, { customer_name: "Pedro" }),
    ).toBe("Pedro");
  });

  it("walk-in anónimo → null (la mesa se rotula como siempre)", () => {
    expect(tableDisplayName(null, null)).toBeNull();
    expect(tableDisplayName(undefined, undefined)).toBeNull();
  });

  it("recorta los espacios sobrantes", () => {
    expect(tableDisplayName(null, { customer_name: "  Pedro  " })).toBe("Pedro");
  });
});

describe("fitNameToTable", () => {
  it("lo que entra se muestra entero", () => {
    expect(fitNameToTable("Pedro", 12)).toBe("Pedro");
  });

  it("si el nombre completo no entra, se queda con la primera palabra", () => {
    expect(fitNameToTable("María Fernanda Gutiérrez", 10)).toBe("María");
  });

  it("si ni la primera palabra entra, trunca con elipsis", () => {
    expect(fitNameToTable("Bartolomé Mitre", 6)).toBe("Barto…");
  });

  it("normaliza espacios múltiples", () => {
    expect(fitNameToTable("  Ana   Paula  ", 20)).toBe("Ana Paula");
  });

  it("nunca devuelve vacío aunque la mesa sea diminuta", () => {
    const out = fitNameToTable("Bartolomé", 0);
    expect(out.length).toBeGreaterThan(0);
  });
});

/**
 * El plano «Pedidos de Mostrador» de golf-jcr es una grilla de 60 cuentas de
 * 116x66 (spec 067 en uso real, 2026-07-30). Estos casos fijan que un nombre
 * de verdad ENTRE en ese slot: si alguien cambia el tamaño de las mesas o la
 * fórmula del viewer, el test lo canta antes que el encargado.
 *
 * La cuenta es la misma que hace `floor-plan-viewer`:
 *   labelSize = min(w, h) * 0.22
 *   maxChars  = w / (labelSize * 0.58)
 */
const MOSTRADOR_W = 116;
const MOSTRADOR_H = 66;
const mostradorMaxChars =
  MOSTRADOR_W / (Math.min(MOSTRADOR_W, MOSTRADOR_H) * 0.22 * 0.58);

describe("fitNameToTable — slot del plano de mostrador (116x66)", () => {
  it("entran ~13 caracteres", () => {
    expect(Math.floor(mostradorMaxChars)).toBe(13);
  });

  it("un apellido común entra entero", () => {
    for (const name of ["Gutiérrez", "Rodríguez", "Fernández", "Pérez"]) {
      expect(fitNameToTable(name, mostradorMaxChars)).toBe(name);
    }
  });

  it("un nombre y apellido corto entra entero", () => {
    expect(fitNameToTable("Ana Paula", mostradorMaxChars)).toBe("Ana Paula");
  });

  it("un nombre largo cae a la primera palabra, legible", () => {
    expect(fitNameToTable("María Fernanda Gutiérrez", mostradorMaxChars)).toBe(
      "María",
    );
  });

  it("una sola palabra larguísima se trunca con elipsis, no desborda", () => {
    const out = fitNameToTable("Wolfeschlegelsteinhausen", mostradorMaxChars);
    expect(out.length).toBeLessThanOrEqual(13);
    expect(out.endsWith("…")).toBe(true);
  });
});
