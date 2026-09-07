import { describe, expect, it } from "vitest";

import {
  armarLibroProveedor,
  calcularSaldoProveedor,
  calcularVencimiento,
  comprobantesConSaldo,
  comprobantesImpagos,
  diasVencido,
  filtrarPorPeriodo,
  pagosDeComprobante,
  proyeccionPorDia,
  repartirPago,
  totalesDelPeriodo,
  totalizarPorClave,
  type ComprobanteCompra,
  type ImputacionPago,
  type PagoProveedor,
} from "./cuenta-corriente";

const comprobante = (over: Partial<ComprobanteCompra> = {}): ComprobanteCompra => ({
  id: "c1",
  total_cents: 482_100_00,
  invoice_date: "2026-09-01",
  due_date: "2026-09-08",
  document_type: "interno",
  invoice_number: null,
  cancelled_at: null,
  ...over,
});

const pago = (over: Partial<PagoProveedor> = {}): PagoProveedor => ({
  id: "p1",
  amount_cents: 482_100_00,
  paid_at: "2026-09-05",
  method: "cash",
  cancelled_at: null,
  ...over,
});

const imputacion = (over: Partial<ImputacionPago> = {}): ImputacionPago => ({
  payment_id: "p1",
  invoice_id: "c1",
  amount_cents: 482_100_00,
  ...over,
});

describe("calcularSaldoProveedor", () => {
  it("sin movimientos no se debe nada", () => {
    expect(calcularSaldoProveedor([], [])).toBe(0);
  });

  it("los comprobantes suman y los pagos restan", () => {
    const saldo = calcularSaldoProveedor(
      [
        comprobante({ id: "a", total_cents: 25_000_00 }),
        comprobante({ id: "b", total_cents: 15_000_00 }),
      ],
      [pago({ amount_cents: 30_000_00 })],
    );
    expect(saldo).toBe(10_000_00);
  });

  it("un comprobante anulado deja de deberse", () => {
    const saldo = calcularSaldoProveedor(
      [
        comprobante({ id: "a", total_cents: 25_000_00 }),
        comprobante({ id: "b", total_cents: 15_000_00, cancelled_at: "2026-09-03T10:00:00Z" }),
      ],
      [],
    );
    expect(saldo).toBe(25_000_00);
  });

  it("anular un pago devuelve la deuda", () => {
    const saldo = calcularSaldoProveedor(
      [comprobante({ total_cents: 25_000_00 })],
      [pago({ amount_cents: 25_000_00, cancelled_at: "2026-09-06T10:00:00Z" })],
    );
    expect(saldo).toBe(25_000_00);
  });

  it("un pago a cuenta deja saldo a favor (negativo), no cero", () => {
    const saldo = calcularSaldoProveedor([], [pago({ amount_cents: 50_000_00 })]);
    expect(saldo).toBe(-50_000_00);
  });

  it("la nota de crédito resta sola, con su total negativo", () => {
    const saldo = calcularSaldoProveedor(
      [
        comprobante({ id: "a", total_cents: 100_000_00 }),
        comprobante({
          id: "nc",
          total_cents: -30_000_00,
          document_type: "nota_credito",
        }),
      ],
      [],
    );
    expect(saldo).toBe(70_000_00);
  });
});

describe("comprobantesConSaldo", () => {
  it("descuenta lo imputado", () => {
    const [c] = comprobantesConSaldo(
      [comprobante({ total_cents: 100_000_00 })],
      [imputacion({ amount_cents: 40_000_00 })],
      [pago()],
    );
    expect(c.pagado_cents).toBe(40_000_00);
    expect(c.saldo_cents).toBe(60_000_00);
  });

  it("la imputación de un pago anulado no cuenta", () => {
    const [c] = comprobantesConSaldo(
      [comprobante({ total_cents: 100_000_00 })],
      [imputacion({ amount_cents: 100_000_00 })],
      [pago({ cancelled_at: "2026-09-06T10:00:00Z" })],
    );
    expect(c.saldo_cents).toBe(100_000_00);
  });

  it("suma varias imputaciones sobre el mismo comprobante", () => {
    const [c] = comprobantesConSaldo(
      [comprobante({ total_cents: 100_000_00 })],
      [
        imputacion({ payment_id: "p1", amount_cents: 40_000_00 }),
        imputacion({ payment_id: "p2", amount_cents: 25_000_00 }),
      ],
      [pago({ id: "p1" }), pago({ id: "p2" })],
    );
    expect(c.saldo_cents).toBe(35_000_00);
  });
});

describe("comprobantesImpagos", () => {
  it("ordena por vencimiento, del más viejo al más nuevo", () => {
    const impagos = comprobantesImpagos(
      [
        comprobante({ id: "nuevo", due_date: "2026-09-20" }),
        comprobante({ id: "viejo", due_date: "2026-09-02" }),
        comprobante({ id: "medio", due_date: "2026-09-10" }),
      ],
      [],
      [],
    );
    expect(impagos.map((c) => c.id)).toEqual(["viejo", "medio", "nuevo"]);
  });

  it("deja afuera los saldados y los anulados", () => {
    const impagos = comprobantesImpagos(
      [
        comprobante({ id: "pagado", total_cents: 10_000_00 }),
        comprobante({ id: "anulado", total_cents: 20_000_00, cancelled_at: "2026-09-03T10:00:00Z" }),
        comprobante({ id: "debe", total_cents: 30_000_00 }),
      ],
      [imputacion({ invoice_id: "pagado", amount_cents: 10_000_00 })],
      [pago()],
    );
    expect(impagos.map((c) => c.id)).toEqual(["debe"]);
  });

  it("una nota de crédito no figura como impago", () => {
    const impagos = comprobantesImpagos(
      [comprobante({ id: "nc", total_cents: -30_000_00, document_type: "nota_credito" })],
      [],
      [],
    );
    expect(impagos).toEqual([]);
  });

  it("sin vencimiento se ordena por la fecha del comprobante", () => {
    const impagos = comprobantesImpagos(
      [
        comprobante({ id: "b", invoice_date: "2026-09-05", due_date: null }),
        comprobante({ id: "a", invoice_date: "2026-09-01", due_date: null }),
      ],
      [],
      [],
    );
    expect(impagos.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("calcularVencimiento", () => {
  it("suma los días de crédito del proveedor", () => {
    expect(calcularVencimiento("2026-09-01", 7)).toBe("2026-09-08");
  });

  it("con 0 días vence el mismo día: es contado, no un error", () => {
    expect(calcularVencimiento("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("cruza el fin de mes", () => {
    expect(calcularVencimiento("2026-08-28", 5)).toBe("2026-09-02");
  });

  it("cruza el fin de año", () => {
    expect(calcularVencimiento("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("no se corre un día en el cambio de horario de verano del sur", () => {
    // Un huso negativo con DST rompería esto si la cuenta fuera en hora local.
    expect(calcularVencimiento("2026-11-01", 1)).toBe("2026-11-02");
    expect(calcularVencimiento("2026-03-31", 1)).toBe("2026-04-01");
  });
});

describe("diasVencido", () => {
  it("positivo cuando ya venció", () => {
    expect(diasVencido(comprobante({ due_date: "2026-09-01" }), "2026-09-10")).toBe(9);
  });

  it("negativo cuando falta", () => {
    expect(diasVencido(comprobante({ due_date: "2026-09-20" }), "2026-09-10")).toBe(-10);
  });

  it("cero el día que vence", () => {
    expect(diasVencido(comprobante({ due_date: "2026-09-10" }), "2026-09-10")).toBe(0);
  });
});

describe("repartirPago", () => {
  const impagos = comprobantesImpagos(
    [
      comprobante({ id: "a", total_cents: 10_000_00, due_date: "2026-09-02" }),
      comprobante({ id: "b", total_cents: 20_000_00, due_date: "2026-09-09" }),
    ],
    [],
    [],
  );

  it("cancela primero lo que vence antes", () => {
    const r = repartirPago(10_000_00, impagos);
    expect(r.imputaciones).toEqual([{ invoice_id: "a", amount_cents: 10_000_00 }]);
    expect(r.a_cuenta_cents).toBe(0);
  });

  it("un pago parcial se aplica al más viejo y no inventa el resto", () => {
    const r = repartirPago(4_000_00, impagos);
    expect(r.imputaciones).toEqual([{ invoice_id: "a", amount_cents: 4_000_00 }]);
    expect(r.a_cuenta_cents).toBe(0);
  });

  it("cubre varios comprobantes en orden", () => {
    const r = repartirPago(25_000_00, impagos);
    expect(r.imputaciones).toEqual([
      { invoice_id: "a", amount_cents: 10_000_00 },
      { invoice_id: "b", amount_cents: 15_000_00 },
    ]);
  });

  it("lo que sobra queda a cuenta, no forzado contra un comprobante", () => {
    const r = repartirPago(50_000_00, impagos);
    expect(r.imputaciones).toHaveLength(2);
    expect(r.a_cuenta_cents).toBe(20_000_00);
  });

  it("sin impagos, todo es pago a cuenta", () => {
    const r = repartirPago(15_000_00, []);
    expect(r.imputaciones).toEqual([]);
    expect(r.a_cuenta_cents).toBe(15_000_00);
  });
});

describe("armarLibroProveedor", () => {
  it("mezcla comprobantes y pagos, del más nuevo al más viejo", () => {
    const libro = armarLibroProveedor(
      [
        comprobante({ id: "c1", invoice_date: "2026-09-01" }),
        comprobante({ id: "c2", invoice_date: "2026-09-07" }),
      ],
      [pago({ id: "p1", paid_at: "2026-09-05" })],
    );
    expect(libro.map((m) => m.id)).toEqual(["c2", "p1", "c1"]);
  });

  it("lo anulado sigue en el libro, marcado", () => {
    const libro = armarLibroProveedor(
      [comprobante({ cancelled_at: "2026-09-03T10:00:00Z" })],
      [],
    );
    expect(libro).toHaveLength(1);
    expect(libro[0].anulado).toBe(true);
  });

  it("sin número de comprobante muestra el tipo, no un '#' vacío", () => {
    const libro = armarLibroProveedor(
      [comprobante({ invoice_number: "  ", document_type: "interno" })],
      [],
    );
    expect(libro[0].detalle).toBe("Sin comprobante");
  });

  it("con número lo muestra", () => {
    const libro = armarLibroProveedor(
      [comprobante({ invoice_number: "0001-00012345", document_type: "factura_a" })],
      [],
    );
    expect(libro[0].detalle).toBe("#0001-00012345");
  });

  it("el pago se identifica por su método", () => {
    const libro = armarLibroProveedor([], [pago({ method: "transfer" })]);
    expect(libro[0].detalle).toBe("Transferencia");
  });
});

describe("totalizarPorClave", () => {
  it("agrupa el gasto y ordena por importe", () => {
    const totales = totalizarPorClave(
      [
        { total_cents: 10_000_00, rubro: "mercaderias" },
        { total_cents: 5_000_00, rubro: "servicios" },
        { total_cents: 30_000_00, rubro: "mercaderias" },
      ],
      (c) => c.rubro,
    );
    expect(totales).toEqual([
      { clave: "mercaderias", total_cents: 40_000_00, comprobantes: 2 },
      { clave: "servicios", total_cents: 5_000_00, comprobantes: 1 },
    ]);
  });

  it("no cuenta lo anulado", () => {
    const totales = totalizarPorClave(
      [
        { total_cents: 10_000_00, rubro: "mercaderias" },
        { total_cents: 90_000_00, rubro: "mercaderias", cancelled_at: "2026-09-03T10:00:00Z" },
      ],
      (c) => c.rubro,
    );
    expect(totales).toEqual([
      { clave: "mercaderias", total_cents: 10_000_00, comprobantes: 1 },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// spec 159 · leer la cuenta como en MaxiRest
// ═══════════════════════════════════════════════════════════════════

describe("pagosDeComprobante", () => {
  it("trae los pagos que cancelaron ese comprobante", () => {
    const r = pagosDeComprobante(
      "c1",
      [
        imputacion({ payment_id: "p1", invoice_id: "c1", amount_cents: 30_000_00 }),
        imputacion({ payment_id: "p2", invoice_id: "otro", amount_cents: 10_000_00 }),
      ],
      [pago({ id: "p1" }), pago({ id: "p2" })],
    );
    expect(r.map((p) => p.id)).toEqual(["p1"]);
  });

  it("muestra lo IMPUTADO a ese comprobante, no el total del pago", () => {
    // Un pago de $100.000 repartido: acá le tocaron $30.000.
    const r = pagosDeComprobante(
      "c1",
      [imputacion({ payment_id: "p1", invoice_id: "c1", amount_cents: 30_000_00 })],
      [pago({ id: "p1", amount_cents: 100_000_00 })],
    );
    expect(r[0].imputado_cents).toBe(30_000_00);
    expect(r[0].amount_cents).toBe(100_000_00);
  });

  it("un pago anulado no figura: su imputación ya no cancela nada", () => {
    const r = pagosDeComprobante(
      "c1",
      [imputacion({ payment_id: "p1", invoice_id: "c1" })],
      [pago({ id: "p1", cancelled_at: "2026-09-06T10:00:00Z" })],
    );
    expect(r).toEqual([]);
  });

  it("ordena del pago más nuevo al más viejo", () => {
    const r = pagosDeComprobante(
      "c1",
      [
        imputacion({ payment_id: "viejo", invoice_id: "c1" }),
        imputacion({ payment_id: "nuevo", invoice_id: "c1" }),
      ],
      [
        pago({ id: "viejo", paid_at: "2026-09-01" }),
        pago({ id: "nuevo", paid_at: "2026-09-08" }),
      ],
    );
    expect(r.map((p) => p.id)).toEqual(["nuevo", "viejo"]);
  });
});

describe("filtrarPorPeriodo", () => {
  const compras = [
    comprobante({ id: "a", invoice_date: "2026-08-31" }),
    comprobante({ id: "b", invoice_date: "2026-09-01" }),
    comprobante({ id: "c", invoice_date: "2026-09-30" }),
    comprobante({ id: "d", invoice_date: "2026-10-01" }),
  ];

  it("los bordes entran", () => {
    const r = filtrarPorPeriodo(compras, "2026-09-01", "2026-09-30");
    expect(r.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("sin fechas devuelve todo", () => {
    expect(filtrarPorPeriodo(compras).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("acepta un borde solo", () => {
    expect(filtrarPorPeriodo(compras, "2026-09-30").map((c) => c.id)).toEqual(["c", "d"]);
  });
});

describe("totalesDelPeriodo", () => {
  it("total, saldo y pago a cuenta por separado", () => {
    const t = totalesDelPeriodo(
      [
        comprobante({ id: "a", total_cents: 100_000_00 }),
        comprobante({ id: "b", total_cents: 50_000_00 }),
      ],
      [imputacion({ payment_id: "p1", invoice_id: "a", amount_cents: 40_000_00 })],
      [pago({ id: "p1", amount_cents: 40_000_00 }), pago({ id: "p2", amount_cents: 25_000_00 })],
    );
    expect(t.total_cents).toBe(150_000_00);
    expect(t.saldo_cents).toBe(110_000_00);
    // p2 no está imputado a nada: es pago a cuenta y va aparte.
    expect(t.pago_a_cuenta_cents).toBe(25_000_00);
  });

  // Spec 163 — el pago MIXTO se evaporaba del pie. `repartirPago` produce este
  // caso: pagás $100.000, se imputan $60.000 al comprobante y $40.000 quedan a
  // cuenta. El toast dice «$40.000 quedaron a cuenta» y el pie decía **$0**,
  // porque el filtro era un Set de payment_id: bastaba UNA imputación para que
  // el pago entero dejara de contar como a-cuenta.
  it("un pago imputado en parte deja el resto a cuenta", () => {
    const t = totalesDelPeriodo(
      [comprobante({ id: "a", total_cents: 60_000_00 })],
      [imputacion({ payment_id: "p1", invoice_id: "a", amount_cents: 60_000_00 })],
      [pago({ id: "p1", amount_cents: 100_000_00 })],
    );
    expect(t.saldo_cents).toBe(0);
    expect(t.pago_a_cuenta_cents).toBe(40_000_00);
  });

  it("un pago imputado por completo no deja nada a cuenta", () => {
    const t = totalesDelPeriodo(
      [comprobante({ id: "a", total_cents: 60_000_00 })],
      [imputacion({ payment_id: "p1", invoice_id: "a", amount_cents: 60_000_00 })],
      [pago({ id: "p1", amount_cents: 60_000_00 })],
    );
    expect(t.pago_a_cuenta_cents).toBe(0);
  });

  it("lo anulado no suma ni al total ni al saldo", () => {
    const t = totalesDelPeriodo(
      [
        comprobante({ id: "a", total_cents: 100_000_00 }),
        comprobante({ id: "x", total_cents: 90_000_00, cancelled_at: "2026-09-03T10:00:00Z" }),
      ],
      [],
      [],
    );
    expect(t.total_cents).toBe(100_000_00);
    expect(t.saldo_cents).toBe(100_000_00);
  });

  it("un pago a cuenta anulado no cuenta", () => {
    const t = totalesDelPeriodo(
      [],
      [],
      [pago({ id: "p1", amount_cents: 25_000_00, cancelled_at: "2026-09-06T10:00:00Z" })],
    );
    expect(t.pago_a_cuenta_cents).toBe(0);
  });
});

describe("proyeccionPorDia", () => {
  const impagos = (xs: Array<Partial<ComprobanteCompra> & { saldo?: number }>) =>
    xs.map((x, i) => ({
      ...comprobante({ id: `c${i}`, ...x }),
      pagado_cents: 0,
      saldo_cents: x.saldo ?? x.total_cents ?? 10_000_00,
    }));

  it("agrupa la plata por día de vencimiento", () => {
    const r = proyeccionPorDia(
      impagos([
        { due_date: "2026-09-11", total_cents: 10_000_00 },
        { due_date: "2026-09-11", total_cents: 5_000_00 },
        { due_date: "2026-09-18", total_cents: 7_000_00 },
      ]),
      "2026-09",
      "2026-09-04",
    );
    expect(r.map((d) => [d.fecha, d.total_cents])).toEqual([
      ["2026-09-11", 15_000_00],
      ["2026-09-18", 7_000_00],
    ]);
  });

  it("lo vencido se acumula en HOY y queda marcado", () => {
    const r = proyeccionPorDia(
      impagos([
        { due_date: "2026-08-28", total_cents: 20_000_00 },
        { due_date: "2026-09-11", total_cents: 5_000_00 },
      ]),
      "2026-09",
      "2026-09-04",
    );
    expect(r[0].fecha).toBe("2026-09-04");
    expect(r[0].total_cents).toBe(20_000_00);
    expect(r[0].items[0].atrasado).toBe(true);
    expect(r[1].items[0].atrasado).toBe(false);
  });

  it("mirando otro mes, lo atrasado no se cuela en un día que no es hoy", () => {
    const r = proyeccionPorDia(
      impagos([{ due_date: "2026-08-28", total_cents: 20_000_00 }]),
      "2026-10",
      "2026-09-04",
    );
    expect(r).toEqual([]);
  });

  it("deja afuera los vencimientos de otros meses", () => {
    const r = proyeccionPorDia(
      impagos([
        { due_date: "2026-09-11", total_cents: 5_000_00 },
        { due_date: "2026-10-11", total_cents: 9_000_00 },
      ]),
      "2026-09",
      "2026-09-04",
    );
    expect(r).toHaveLength(1);
    expect(r[0].fecha).toBe("2026-09-11");
  });

  it("el que vence hoy no es atraso", () => {
    const r = proyeccionPorDia(
      impagos([{ due_date: "2026-09-04", total_cents: 5_000_00 }]),
      "2026-09",
      "2026-09-04",
    );
    expect(r[0].items[0].atrasado).toBe(false);
  });

  it("suma el SALDO, no el total del comprobante", () => {
    const r = proyeccionPorDia(
      impagos([{ due_date: "2026-09-11", total_cents: 100_000_00, saldo: 30_000_00 }]),
      "2026-09",
      "2026-09-04",
    );
    expect(r[0].total_cents).toBe(30_000_00);
  });
});
