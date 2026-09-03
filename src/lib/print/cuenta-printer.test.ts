import { describe, expect, it } from "vitest";

import { resolveCierrePrinter, resolveCuentaPrinter } from "./cuenta-printer";

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

describe("resolveCierrePrinter (spec 139 · Parte B)", () => {
  it("el caso real de golf: la IP está en control, no en la cuenta del negocio", () => {
    // golf-jcr tiene la cuenta cargada POR SALÓN (192.168.100.210 en «Salón
    // principal») y a nivel negocio sólo la de control — la misma térmica. Sin
    // el fallback el papel del cierre no saldría nunca, en silencio.
    expect(
      resolveCierrePrinter({
        cuenta_printer_ip: null,
        control_printer_ip: "192.168.100.210",
      }),
    ).toEqual({ ip: "192.168.100.210", port: 9100 });
  });

  it("si el negocio tiene la de la cuenta, gana esa", () => {
    expect(
      resolveCierrePrinter({
        cuenta_printer_ip: "192.168.10.210",
        control_printer_ip: "192.168.10.99",
      }),
    ).toEqual({ ip: "192.168.10.210", port: 9100 });
  });

  it("apagar la de la cuenta apaga el cierre: no se escapa por la de control", () => {
    // Si el fallback ignorara el "off" explícito, apagarla no serviría de nada.
    expect(
      resolveCierrePrinter({
        cuenta_printer_ip: "192.168.10.210",
        cuenta_printer_enabled: false,
        control_printer_ip: "192.168.10.99",
      }),
    ).toBeNull();
  });

  it("la de control apagada tampoco se usa", () => {
    expect(
      resolveCierrePrinter({
        cuenta_printer_ip: null,
        control_printer_ip: "192.168.10.99",
        control_printer_enabled: false,
      }),
    ).toBeNull();
  });

  it("un negocio sin ninguna configurada no imprime — queda pendiente", () => {
    expect(resolveCierrePrinter({})).toBeNull();
    expect(resolveCierrePrinter(null)).toBeNull();
  });

  it("respeta el puerto configurado", () => {
    expect(
      resolveCierrePrinter({ cuenta_printer_ip: "10.0.0.5", cuenta_printer_port: 9200 }),
    ).toEqual({ ip: "10.0.0.5", port: 9200 });
  });
});
