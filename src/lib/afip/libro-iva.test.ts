import { describe, expect, it } from "vitest";

import { acumularLibroIva, type FilaComprobante } from "./libro-iva";

/**
 * La regla que estaba escrita dos veces y arreglada de un lado nomás:
 * `getInvoiceKPIs` (panel de Facturación) la corrigió en #274·5 y
 * `getFiscalSummary` (/admin/reportes) quedó sumando las notas de crédito.
 *
 * Estos casos son los que separan una implementación de la otra. Si alguien
 * vuelve a escribir el `if` a mano en cualquiera de los dos lectores, acá se ve.
 */

const factura = (over: Partial<FilaComprobante> = {}): FilaComprobante => ({
  total_cents: 100_000_00,
  iva_cents: 21_000_00,
  status: "authorized",
  tipo_comprobante: "factura_b",
  ...over,
});

describe("acumularLibroIva", () => {
  it("una nota de crédito RESTA del facturado, no suma", () => {
    const libro = acumularLibroIva([
      factura(),
      factura({ tipo_comprobante: "nota_credito_b" }),
    ]);

    // El bug daba 200.000: el mismo ticket contado dos veces.
    expect(libro.netoCents).toBe(0);
    expect(libro.notasCreditoCents).toBe(100_000_00);
    expect(libro.countNotasCredito).toBe(1);
  });

  it("y también resta del IVA — la mitad que sólo tenía el reporte fiscal", () => {
    const libro = acumularLibroIva([
      factura(),
      factura({ tipo_comprobante: "nota_credito_b" }),
    ]);

    // `getFiscalSummary` es el único de los dos lectores que muestra IVA, así
    // que este caso no lo cubría ningún test del panel.
    expect(libro.ivaCents).toBe(0);
  });

  it("la NC no cuenta como comprobante vigente ni como factura B", () => {
    const libro = acumularLibroIva([
      factura(),
      factura({ tipo_comprobante: "nota_credito_b" }),
    ]);

    expect(libro.count).toBe(1);
    expect(libro.countB).toBe(1);
  });

  it("el flujo D5 (pide la A al irse) cuenta UN ticket, no cero ni dos", () => {
    // Quedan tres filas: la B anulada, su NC autorizada, y la A nueva.
    // La `cancelled` TIENE CAE y sigue en Mis Comprobantes: excluirla mientras
    // se incluye su NC daba cero sobre una venta que existió.
    const libro = acumularLibroIva([
      factura({ status: "cancelled" }),
      factura({ tipo_comprobante: "nota_credito_b" }),
      factura({ tipo_comprobante: "factura_a" }),
    ]);

    expect(libro.netoCents).toBe(100_000_00);
    expect(libro.count).toBe(1);
    expect(libro.countA).toBe(1);
    expect(libro.countB).toBe(0);
  });

  it("puede dar negativo, y no se tapa", () => {
    // Primer día del mes con NC de ventas del mes anterior. Es un dato: un
    // `Math.max(0, …)` sería volver a maquillar el número.
    const libro = acumularLibroIva([
      factura({ tipo_comprobante: "nota_credito_a" }),
    ]);

    expect(libro.netoCents).toBe(-100_000_00);
  });

  it("pending y failed se cuentan pero no mueven un peso", () => {
    const libro = acumularLibroIva([
      factura({ status: "pending" }),
      factura({ status: "failed" }),
    ]);

    expect(libro.netoCents).toBe(0);
    expect(libro.ivaCents).toBe(0);
    expect(libro.countPending).toBe(1);
    expect(libro.countFailed).toBe(1);
    expect(libro.count).toBe(0);
  });

  it("una NC que nunca tomó CAE no resta nada", () => {
    // Sólo la `authorized` es una anulación real ante ARCA. Una NC `failed`
    // restando dejaría el libro corto contra la declaración.
    const libro = acumularLibroIva([
      factura(),
      factura({ tipo_comprobante: "nota_credito_b", status: "failed" }),
    ]);

    expect(libro.netoCents).toBe(100_000_00);
    expect(libro.countNotasCredito).toBe(0);
  });

  it("sin iva_cents (el panel no lo lee) el IVA queda en cero, no en NaN", () => {
    const libro = acumularLibroIva([
      { total_cents: 50_000_00, status: "authorized", tipo_comprobante: "factura_b" },
    ]);

    expect(libro.netoCents).toBe(50_000_00);
    expect(libro.ivaCents).toBe(0);
  });
});
