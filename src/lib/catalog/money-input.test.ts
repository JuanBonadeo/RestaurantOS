// P14 · hallazgo 3 — «18.500» tiene que valer dieciocho mil quinientos.
//
// El campo «Precio base ($)» parseaba con `parseInt(e.target.value)`, que corta
// en el primer separador: `parseInt("18.500") === 18`. El asado salía a la carta
// a $18 y nadie se enteraba (el mozo cobra lo que ve). Acá vive la lectura del
// número tal como se escribe en Argentina, con el criterio explícito de cuándo
// un separador es de miles y cuándo de centavos — y con un NO rotundo para lo
// ambiguo, que es lo único que no se puede resolver adivinando.
import { describe, expect, it } from "vitest";

import { MAX_PRICE_CENTS, parsePesos } from "./money-input";

const cents = (raw: string) => {
  const r = parsePesos(raw);
  if (!r.ok) throw new Error(`«${raw}» debería ser válido: ${r.error}`);
  return r.cents;
};

const rechaza = (raw: string) => {
  const r = parsePesos(raw);
  expect(r.ok, `«${raw}» debería rechazarse`).toBe(false);
};

describe("parsePesos · el separador de miles NO trunca", () => {
  it("«18.500» es dieciocho mil quinientos, no dieciocho", () => {
    expect(cents("18.500")).toBe(1_850_000);
  });

  it("«18,500» también: tres dígitos detrás del separador son miles", () => {
    // En AR la coma es el decimal, pero «18,500» con tres dígitos sería un
    // precio con tres decimales — no existe. La lectura útil es la del teclado
    // en inglés: miles. Antes esto daba $0 (parseInt("") por el input number).
    expect(cents("18,500")).toBe(1_850_000);
  });

  it("varios grupos de miles", () => {
    expect(cents("1.234.567")).toBe(123_456_700);
  });

  it("miles + centavos", () => {
    expect(cents("18.500,50")).toBe(1_850_050);
    expect(cents("18,500.50")).toBe(1_850_050);
  });
});

describe("parsePesos · los centavos siguen entrando", () => {
  it("uno o dos dígitos detrás del separador son centavos", () => {
    expect(cents("12,75")).toBe(1275);
    expect(cents("12.75")).toBe(1275);
    expect(cents("12,5")).toBe(1250);
  });

  it("sin separador es un entero de pesos", () => {
    expect(cents("18500")).toBe(1_850_000);
    expect(cents("0")).toBe(0);
  });

  it("el separador colgando se lee como entero, no como error", () => {
    // Estado de tránsito mientras se tipea «18.500»: no queremos pintarlo de
    // rojo, pero tampoco inventarle un 500 que todavía no escribió.
    expect(cents("18.")).toBe(1800);
  });

  it("tolera el signo pesos y los espacios", () => {
    expect(cents(" $ 18.500 ")).toBe(1_850_000);
  });
});

describe("parsePesos · lo que no se puede adivinar se rechaza", () => {
  it("el campo vacío no vale $0", () => {
    // El error simétrico del truncado: borrar el precio guardaba 0 sin chistar.
    rechaza("");
    rechaza("   ");
  });

  it("más de dos decimales no es plata", () => {
    rechaza("18.5001");
    rechaza("1,2345");
  });

  it("grupos de miles mal armados", () => {
    rechaza("1.23.456");
    rechaza("18.50.7");
  });

  it("letras, negativos y basura", () => {
    rechaza("abc");
    rechaza("-100");
    rechaza("18e3");
  });

  it("el cero de más tiene techo", () => {
    // El error simétrico del hallazgo: un asado a $185.000.000 pasaba derecho.
    expect(cents("10.000.000")).toBe(MAX_PRICE_CENTS);
    rechaza("100.000.000");
  });
});
