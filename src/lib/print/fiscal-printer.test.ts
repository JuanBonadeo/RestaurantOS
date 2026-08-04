import { describe, expect, it } from "vitest";

import { resolveFiscalPrinter } from "./fiscal-printer";

// Spec 084, D3 — la comandera fiscal es POR CAJA y, a diferencia de la cuenta
// (spec 080), NO tiene fallback al negocio: el papel fiscal tiene que salir
// donde está parado el que cobra.

const CAJA = {
  id: "c1",
  name: "Caja principal",
  fiscal_printer_ip: "192.168.10.80",
  fiscal_printer_port: 9100,
  fiscal_printer_enabled: true,
};

describe("resolveFiscalPrinter", () => {
  it("devuelve la comandera de la caja", () => {
    expect(resolveFiscalPrinter(CAJA)).toEqual({
      ip: "192.168.10.80",
      port: 9100,
    });
  });

  it("la caja apagada no imprime", () => {
    expect(
      resolveFiscalPrinter({ ...CAJA, fiscal_printer_enabled: false }),
    ).toBeNull();
  });

  it("la caja sin IP no imprime (y no hereda de nadie)", () => {
    expect(
      resolveFiscalPrinter({ ...CAJA, fiscal_printer_ip: null }),
    ).toBeNull();
    expect(
      resolveFiscalPrinter({ ...CAJA, fiscal_printer_ip: "   " }),
    ).toBeNull();
  });

  it("sin caja, null", () => {
    expect(resolveFiscalPrinter(null)).toBeNull();
  });

  it("el puerto cae en 9100 si no está seteado", () => {
    expect(
      resolveFiscalPrinter({ ...CAJA, fiscal_printer_port: null }),
    ).toEqual({ ip: "192.168.10.80", port: 9100 });
  });
});
