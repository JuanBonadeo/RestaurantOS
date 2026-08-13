import { describe, expect, it } from "vitest";
import { agruparVentasPorOrigen, origenDeDeliveryType } from "./ventas-por-origen";

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
