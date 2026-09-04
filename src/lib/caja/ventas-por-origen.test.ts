import { describe, expect, it } from "vitest";
import { agruparVentasPorOrigen, cruzarOrigenYMetodo, origenDeDeliveryType } from "./ventas-por-origen";

describe("origenDeDeliveryType", () => {
  it("mapea los tres valores que existen hoy en la DB", () => {
    expect(origenDeDeliveryType("dine_in")).toBe("salon");
    expect(origenDeDeliveryType("delivery")).toBe("delivery");
    expect(origenDeDeliveryType("pickup")).toBe("takeaway");
  });

  it("take_away (legacy) cae en takeaway junto con pickup", () => {
    expect(origenDeDeliveryType("take_away")).toBe("takeaway");
  });

  it("cualquier valor desconocido o vacío cae en otro, no se pierde", () => {
    expect(origenDeDeliveryType("")).toBe("otro");
    expect(origenDeDeliveryType("catering")).toBe("otro");
  });
});

describe("agruparVentasPorOrigen", () => {
  it("sin cobros devuelve todos los orígenes en 0", () => {
    expect(agruparVentasPorOrigen([])).toEqual({
      salon: 0,
      delivery: 0,
      takeaway: 0,
      otro: 0,
    });
  });

  it("suma los montos por origen", () => {
    const total = agruparVentasPorOrigen([
      { delivery_type: "dine_in", amount_cents: 10_000 },
      { delivery_type: "dine_in", amount_cents: 5_000 },
      { delivery_type: "delivery", amount_cents: 8_000 },
      { delivery_type: "pickup", amount_cents: 3_000 },
      { delivery_type: "take_away", amount_cents: 2_000 },
      { delivery_type: "catering", amount_cents: 1_000 },
    ]);
    expect(total).toEqual({
      salon: 15_000,
      delivery: 8_000,
      takeaway: 5_000,
      otro: 1_000,
    });
  });

  it("la suma de los orígenes cierra con el total de ventas, con propinas de por medio", () => {
    // El mismo criterio que `total_ventas_cents`: venta = amount − tip.
    const cobros = [
      { delivery_type: "dine_in", amount_cents: 12_345, tip_cents: 1_000 },
      { delivery_type: "delivery", amount_cents: 6_789, tip_cents: 0 },
      { delivery_type: "pickup", amount_cents: 1_000, tip_cents: 100 },
      { delivery_type: "loquesea", amount_cents: 500, tip_cents: 0 },
    ];
    const porOrigen = agruparVentasPorOrigen(cobros);
    const suma = Object.values(porOrigen).reduce((a, b) => a + b, 0);
    expect(suma).toBe(
      cobros.reduce((a, c) => a + c.amount_cents - c.tip_cents, 0),
    );
  });

  it("no suma propinas — la propina viaja adentro de amount_cents", () => {
    // Igual que las filas que arma `getCajaLiveStats`: traen tip_cents al lado.
    // El cliente pagó $120 por una cuenta de $100: la venta es $100.
    const cobros = [
      { delivery_type: "dine_in", amount_cents: 12_000, tip_cents: 2_000 },
    ];
    expect(agruparVentasPorOrigen(cobros).salon).toBe(10_000);
  });
});

describe("cruzarOrigenYMetodo", () => {
  const pagos = [
    // Salón: parte en efectivo, parte con tarjeta.
    { delivery_type: "dine_in", method: "cash" as const, amount_cents: 168_000, tip_cents: 0 },
    { delivery_type: "dine_in", method: "card_manual" as const, amount_cents: 38_500, tip_cents: 0 },
    // Delivery cobrado con tarjeta: no pone un peso en el cajón.
    { delivery_type: "delivery", method: "card_manual" as const, amount_cents: 18_500, tip_cents: 0 },
    // Take away en efectivo: sí.
    { delivery_type: "pickup", method: "cash" as const, amount_cents: 42_000, tip_cents: 0 },
  ];

  it("parte cada origen por medio de cobro", () => {
    const c = cruzarOrigenYMetodo(pagos);
    expect(c.salon.cash).toBe(168_000);
    expect(c.salon.card_manual).toBe(38_500);
    expect(c.delivery.card_manual).toBe(18_500);
    expect(c.delivery.cash).toBe(0);
    expect(c.takeaway.cash).toBe(42_000);
  });

  it("cada fila cierra con el total de su origen", () => {
    const c = cruzarOrigenYMetodo(pagos);
    const porOrigen = agruparVentasPorOrigen(pagos);
    for (const origen of ["salon", "delivery", "takeaway", "otro"] as const) {
      const suma = Object.values(c[origen]).reduce((a, b) => a + b, 0);
      expect(suma, origen).toBe(porOrigen[origen]);
    }
  });

  it("cada columna cierra con el total de su método", () => {
    // Sumar por la otra dimensión tiene que dar `ventas_por_metodo`: si no,
    // las dos pantallas mostrarían plata distinta para los mismos cobros.
    const c = cruzarOrigenYMetodo(pagos);
    const efectivo = (["salon", "delivery", "takeaway", "otro"] as const).reduce(
      (a, o) => a + c[o].cash,
      0,
    );
    expect(efectivo).toBe(168_000 + 42_000);
  });

  it("descuenta la propina, igual que el resto de la plata (spec 098)", () => {
    const c = cruzarOrigenYMetodo([
      { delivery_type: "dine_in", method: "cash" as const, amount_cents: 11_000, tip_cents: 1_000 },
    ]);
    expect(c.salon.cash).toBe(10_000);
  });

  it("un delivery_type desconocido cae en `otro` y no se pierde", () => {
    const c = cruzarOrigenYMetodo([
      { delivery_type: "lo-que-sea", method: "transfer" as const, amount_cents: 5_000 },
    ]);
    expect(c.otro.transfer).toBe(5_000);
  });

  it("sin cobros, todo en cero", () => {
    const c = cruzarOrigenYMetodo([]);
    expect(c.salon.cash).toBe(0);
    expect(c.delivery.card_manual).toBe(0);
  });
});
