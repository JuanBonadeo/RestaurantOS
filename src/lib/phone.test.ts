import { describe, expect, it } from "vitest";

import { customerPhoneKey, normalizePhone } from "./phone";

/**
 * `customerPhoneKey` es la identidad de `customers` (UNIQUE business_id+phone).
 * Si dos formas de tipear el mismo número no colapsan a la misma clave, el
 * cliente se duplica y pierde el vínculo con su cuenta (issue #114).
 */
describe("normalizePhone", () => {
  it("deja pasar los dígitos", () => {
    expect(normalizePhone("3415068633")).toBe("3415068633");
  });

  it("saca +, espacios, guiones y paréntesis", () => {
    expect(normalizePhone("+54 341 506-8633")).toBe("543415068633");
    expect(normalizePhone("(341) 506-8633")).toBe("3415068633");
  });

  it("colapsa a '' lo que no parece teléfono", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("juan@example.com")).toBe("");
    expect(normalizePhone("12-34-5")).toBe("");
  });
});

describe("customerPhoneKey", () => {
  it("colapsa las variantes de tipeo del mismo número a una sola clave", () => {
    const key = customerPhoneKey("3415068633");
    expect(customerPhoneKey("341 506-8633")).toBe(key);
    expect(customerPhoneKey("341-506-8633")).toBe(key);
    expect(customerPhoneKey(" 3415068633 ")).toBe(key);
    expect(customerPhoneKey("(341) 5068633")).toBe(key);
  });

  it("nunca devuelve vacío para una entrada con contenido", () => {
    // `customers.phone` es NOT NULL: si no hay dígitos suficientes conservamos
    // lo tipeado en vez de romper el alta.
    expect(customerPhoneKey("12-34-5")).toBe("12-34-5");
    expect(customerPhoneKey("  sin numero  ")).toBe("sin numero");
  });

  it("devuelve '' sólo cuando no hay nada que guardar", () => {
    expect(customerPhoneKey(null)).toBe("");
    expect(customerPhoneKey("   ")).toBe("");
  });

  it("distingue el prefijo internacional del número local", () => {
    // No inventamos país: +54 341… y 341… son claves distintas a propósito.
    // Normalizar a E.164 es un paso aparte (requiere libphonenumber).
    expect(customerPhoneKey("+543415068633")).not.toBe(
      customerPhoneKey("3415068633"),
    );
  });
});
