import { describe, expect, it } from "vitest";

import { resolveCuentaPrinter } from "./cuenta-printer";

// Spec 080, D2 — la comandera de cuentas: el salón manda, el negocio es el
// fallback. Es la regla que decide si el papel sale y dónde, así que va
// cubierta caso por caso.

const BIZ = {
  cuenta_printer_ip: "192.168.10.70",
  cuenta_printer_port: 9100,
  cuenta_printer_enabled: true,
};

describe("resolveCuentaPrinter", () => {
  it("el salón con IP propia gana sobre la del negocio", () => {
    expect(
      resolveCuentaPrinter(
        {
          cuenta_printer_ip: "192.168.10.71",
          cuenta_printer_port: 9101,
          cuenta_printer_enabled: true,
        },
        BIZ,
      ),
    ).toEqual({ ip: "192.168.10.71", port: 9101 });
  });

  it("el salón sin IP hereda la del negocio", () => {
    expect(
      resolveCuentaPrinter(
        { cuenta_printer_ip: null, cuenta_printer_enabled: true },
        BIZ,
      ),
    ).toEqual({ ip: "192.168.10.70", port: 9100 });
  });

  it("el salón apagado NO imprime, aunque el negocio tenga comandera", () => {
    // El "off" explícito tiene que ganar: si cayera al fallback, apagar la
    // comandera de un salón no serviría absolutamente de nada.
    expect(
      resolveCuentaPrinter(
        {
          cuenta_printer_ip: "192.168.10.71",
          cuenta_printer_enabled: false,
        },
        BIZ,
      ),
    ).toBeNull();
    expect(
      resolveCuentaPrinter(
        { cuenta_printer_ip: null, cuenta_printer_enabled: false },
        BIZ,
      ),
    ).toBeNull();
  });

  it("sin comandera en ningún lado, no imprime", () => {
    expect(
      resolveCuentaPrinter({ cuenta_printer_ip: null }, {
        cuenta_printer_ip: null,
      }),
    ).toBeNull();
    expect(resolveCuentaPrinter(null, null)).toBeNull();
  });

  it("el negocio apagado tampoco imprime para los salones que lo heredan", () => {
    expect(
      resolveCuentaPrinter({ cuenta_printer_ip: null }, {
        ...BIZ,
        cuenta_printer_enabled: false,
      }),
    ).toBeNull();
  });

  it("una IP en blanco cuenta como vacía (no como destino)", () => {
    expect(
      resolveCuentaPrinter({ cuenta_printer_ip: "   " }, BIZ),
    ).toEqual({ ip: "192.168.10.70", port: 9100 });
    expect(
      resolveCuentaPrinter({ cuenta_printer_ip: "   " }, {
        cuenta_printer_ip: "  ",
      }),
    ).toBeNull();
  });

  it("el puerto cae en 9100 si no está seteado", () => {
    expect(
      resolveCuentaPrinter(
        { cuenta_printer_ip: "10.0.0.5", cuenta_printer_port: null },
        null,
      ),
    ).toEqual({ ip: "10.0.0.5", port: 9100 });
  });
});
