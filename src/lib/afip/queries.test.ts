import { describe, expect, it, vi } from "vitest";

import { getInvoiceKPIs } from "./queries";

// #274 · 5 — el panel de Facturación sumaba las notas de crédito como si
// fueran ventas.
//
// Una NC es un crédito: RESTA. Los agregadores filtraban sólo por
// `status = 'authorized'` y nunca por `tipo_comprobante`, así que cada
// anulación entraba con signo positivo. El flujo «el cliente pide la A al
// irse» (spec 156 · D5) deja tres filas —la B `cancelled` (que sale de la
// suma), su NC `authorized` y la A `authorized`— y el ticket terminaba contado
// DOS veces. En la anulación pura, sin re-facturar, el panel muestra el ticket
// entero facturado cuando lo correcto es cero.

type Row = {
  total_cents: number;
  status: string;
  tipo_comprobante: string;
};

/** Service client de mentira: devuelve las filas que le pasás, sin red. */
function stubRows(rows: Row[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    then: (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: rows }),
  };
  return { from: () => chain };
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => stubRows(current),
}));

let current: Row[] = [];

function conFilas(rows: Row[]) {
  current = rows;
}

const FACTURA_B: Row = {
  total_cents: 100_000,
  status: "authorized",
  tipo_comprobante: "factura_b",
};

describe("getInvoiceKPIs · las notas de crédito no son ventas", () => {
  it("«Cambiar a Factura A» factura el ticket UNA vez, no dos", async () => {
    // Las tres filas exactas que deja el flujo D5 sobre una mesa de $1.000.
    conFilas([
      { ...FACTURA_B, status: "cancelled" },
      {
        total_cents: 100_000,
        status: "authorized",
        tipo_comprobante: "nota_credito_b",
      },
      {
        total_cents: 100_000,
        status: "authorized",
        tipo_comprobante: "factura_a",
      },
    ]);

    const kpis = await getInvoiceKPIs("biz-1");

    expect(kpis.totalCents).toBe(100_000);
    expect(kpis.count).toBe(1);
    expect(kpis.countA).toBe(1);
    expect(kpis.countB).toBe(0);
  });

  it("una anulación sin re-facturar deja el período en cero facturado", async () => {
    conFilas([
      { ...FACTURA_B, status: "cancelled" },
      {
        total_cents: 100_000,
        status: "authorized",
        tipo_comprobante: "nota_credito_b",
      },
    ]);

    const kpis = await getInvoiceKPIs("biz-1");

    expect(kpis.totalCents).toBe(0);
    expect(kpis.count).toBe(0);
    expect(kpis.countNotasCredito).toBe(1);
    expect(kpis.notasCreditoCents).toBe(100_000);
  });

  it("una NC tipo A no se cuenta como Factura A en el desglose", async () => {
    conFilas([
      {
        total_cents: 50_000,
        status: "authorized",
        tipo_comprobante: "nota_credito_a",
      },
    ]);

    const kpis = await getInvoiceKPIs("biz-1");

    expect(kpis.countA).toBe(0);
    expect(kpis.countB).toBe(0);
    expect(kpis.countNotasCredito).toBe(1);
  });

  it("el camino feliz no cambia: dos B autorizadas suman su total", async () => {
    conFilas([
      FACTURA_B,
      { ...FACTURA_B, total_cents: 50_000 },
      { ...FACTURA_B, status: "failed" },
      { ...FACTURA_B, status: "pending" },
    ]);

    const kpis = await getInvoiceKPIs("biz-1");

    expect(kpis.totalCents).toBe(150_000);
    expect(kpis.count).toBe(2);
    expect(kpis.countB).toBe(2);
    expect(kpis.countFailed).toBe(1);
    expect(kpis.countPending).toBe(1);
  });
});
