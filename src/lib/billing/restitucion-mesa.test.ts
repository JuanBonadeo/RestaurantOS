import { describe, expect, it } from "vitest";

import { restitucionMesa } from "./restitucion-mesa";

const ORDEN = {
  id: "order-1",
  createdAt: "2026-08-06T21:00:00.000Z",
  billRequestedAt: null,
};

describe("restitucionMesa", () => {
  it("mesa liberada por el cobro vuelve OCUPADA si nunca pidió la cuenta", () => {
    // El caso que motiva la spec: cobraron la mesa equivocada, la gente sigue
    // comiendo. Volver a `pidio_cuenta` sería inventar un pedido que no pasó.
    const r = restitucionMesa(
      { operationalStatus: "libre", currentOrderId: null },
      ORDEN,
    );

    expect(r).toEqual({
      kind: "patch",
      operationalStatus: "ocupada",
      openedAt: ORDEN.createdAt,
      currentOrderId: "order-1",
    });
  });

  it("vuelve a PIDIO_CUENTA si la cuenta ya se había pedido antes del cobro", () => {
    const r = restitucionMesa(
      { operationalStatus: "libre", currentOrderId: null },
      { ...ORDEN, billRequestedAt: "2026-08-06T22:30:00.000Z" },
    );

    expect(r).toMatchObject({ kind: "patch", operationalStatus: "pidio_cuenta" });
  });

  it("restituye el puntero aunque la mesa NO haya quedado libre", () => {
    // Antes esto se saltaba entero (`if (fromStatus === 'libre')`) y la orden
    // quedaba abierta sin mesa que la muestre.
    const r = restitucionMesa(
      { operationalStatus: "ocupada", currentOrderId: null },
      ORDEN,
    );

    expect(r).toMatchObject({ kind: "patch", currentOrderId: "order-1" });
  });

  it("es idempotente: la mesa que ya apunta a esta orden se restituye igual", () => {
    const r = restitucionMesa(
      { operationalStatus: "ocupada", currentOrderId: "order-1" },
      ORDEN,
    );

    expect(r).toMatchObject({ kind: "patch", currentOrderId: "order-1" });
  });

  it("no toca la mesa si ya tiene otra cuenta encima", () => {
    const r = restitucionMesa(
      { operationalStatus: "ocupada", currentOrderId: "order-2" },
      ORDEN,
    );

    expect(r).toEqual({ kind: "skip", reason: "otra-cuenta" });
  });

  it("el opened_at restituido es el de la cuenta, no el momento de anular", () => {
    const r = restitucionMesa(
      { operationalStatus: "libre", currentOrderId: null },
      ORDEN,
    );

    expect(r).toMatchObject({ openedAt: "2026-08-06T21:00:00.000Z" });
  });
});
