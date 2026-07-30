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
