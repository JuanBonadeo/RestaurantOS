import { describe, expect, it } from "vitest";

import { conciliarRenglon } from "@/lib/proveedores/lectura/conciliar";

describe("conciliarRenglon", () => {
  it("los cinco renglones de la carnicería cierran", () => {
    // La nota de pedido real, tal cual está escrita a mano.
    const reales = [
      { cantidad: "82,600", precioUnitario: "17.500", totalLinea: "1.445.500", esperado: 82.6 },
      { cantidad: "14,600", precioUnitario: "24.500", totalLinea: "357.700", esperado: 14.6 },
      { cantidad: "22,100", precioUnitario: "21.000", totalLinea: "464.100", esperado: 22.1 },
      { cantidad: "5,100", precioUnitario: "24.500", totalLinea: "124.950", esperado: 5.1 },
      { cantidad: "4,100", precioUnitario: "20.000", totalLinea: "82.000", esperado: 4.1 },
    ];

    for (const r of reales) {
      const c = conciliarRenglon(r);
      expect(c.estado, `${r.cantidad} × ${r.precioUnitario}`).toBe("cuadra");
      expect(c.cantidad).toBeCloseTo(r.esperado, 3);
    }
  });

  it("la aritmética desambigua el separador cuando la lectura AR no cierra", () => {
    // «2,500 × 4 = 10.000»: con la coma decimal daría 10, que no cierra. La
    // lectura de miles sí, así que gana — el modelo propone, la aritmética decide.
    const c = conciliarRenglon({
      cantidad: "4",
      precioUnitario: "2,500",
      totalLinea: "10.000",
    });

    expect(c.estado).toBe("cuadra");
    expect(c.precioUnitario).toBe(2500);
    expect(c.totalLinea).toBe(10000);
  });

  it("reconstruye el total cuando la línea no lo trae", () => {
    const c = conciliarRenglon({
      cantidad: "3",
      precioUnitario: "9.740,26",
      totalLinea: null,
    });

    expect(c.estado).toBe("reconstruido");
    expect(c.reconstruido).toBe("total");
    expect(c.totalLinea).toBeCloseTo(29220.78, 2);
  });

  it("reconstruye el precio unitario — el caso del ticket térmico", () => {
    // El ticket parte la línea en dos y a veces el unitario queda cortado.
    const c = conciliarRenglon({
      cantidad: "4",
      precioUnitario: null,
      totalLinea: "110.000",
    });

    expect(c.estado).toBe("reconstruido");
    expect(c.reconstruido).toBe("precio");
    expect(c.precioUnitario).toBe(27500);
  });

  it("reconstruye la cantidad — el caso de la factura A4 desalineada", () => {
    const c = conciliarRenglon({
      cantidad: null,
      precioUnitario: "17.062,92",
      totalLinea: "136.503,36",
    });

    expect(c.estado).toBe("reconstruido");
    expect(c.reconstruido).toBe("cantidad");
    expect(c.cantidad).toBeCloseTo(8, 3);
  });

  it("marca no_cuadra sin descartar ni corregir la línea", () => {
    const c = conciliarRenglon({
      cantidad: "3",
      precioUnitario: "1.000",
      totalLinea: "50.000",
    });

    expect(c.estado).toBe("no_cuadra");
    // Los tres números quedan a la vista para que decida la persona: descartar
    // en silencio pierde una compra, «arreglar» es adivinar cuál está mal.
    expect(c.cantidad).toBe(3);
    expect(c.precioUnitario).toBe(1000);
    expect(c.totalLinea).toBe(50000);
  });

  it("una lista de pedido sin precios es incompleta, no un error", () => {
    // La verdulería: «Papa Lavada  x1B» y nada más.
    const c = conciliarRenglon({
      cantidad: "1",
      precioUnitario: null,
      totalLinea: null,
    });

    expect(c.estado).toBe("incompleto");
    expect(c.cantidad).toBe(1);
    expect(c.precioUnitario).toBeNull();
  });

  it("tolera el redondeo del papel", () => {
    // 0,4260 × 1.652,89 = 704,13… y el ticket imprime 704,13.
    const c = conciliarRenglon({
      cantidad: "0,4260",
      precioUnitario: "1.652,89",
      totalLinea: "704,13",
    });

    expect(c.estado).toBe("cuadra");
  });

  it("un renglón vacío no explota", () => {
    const c = conciliarRenglon({ cantidad: null, precioUnitario: null, totalLinea: null });

    expect(c.estado).toBe("incompleto");
    expect(c.cantidad).toBeNull();
  });

  it("no divide por cero al reconstruir", () => {
    const c = conciliarRenglon({ cantidad: "0", precioUnitario: null, totalLinea: "5.000" });

    expect(c.estado).toBe("incompleto");
  });
});
