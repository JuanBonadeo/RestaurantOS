import { describe, expect, it } from "vitest";

import { encadenarPeriodos, ventanaDelCorte } from "./historial-cortes";

const corte = (id: string, caja_id: string, created_at: string) => ({
  id,
  caja_id,
  created_at,
});

describe("encadenarPeriodos", () => {
  it("el turno de un corte arranca en el corte anterior de su misma caja", () => {
    const rows = [
      corte("c3", "principal", "2026-09-03T04:14:00Z"),
      corte("c2", "principal", "2026-09-02T04:06:00Z"),
      corte("c1", "principal", "2026-09-01T04:52:00Z"),
    ];

    const { desdePorCorte } = encadenarPeriodos(rows);

    expect(desdePorCorte.get("c3")).toBe("2026-09-02T04:06:00Z");
    expect(desdePorCorte.get("c2")).toBe("2026-09-01T04:52:00Z");
  });

  it("no encadena cortes de cajas distintas aunque vengan pegados", () => {
    // El cierre del bar cae justo entre dos cierres de la principal: si se
    // encadenara por posición y no por caja, el turno de la principal
    // arrancaría en un corte que no es suyo.
    const rows = [
      corte("principal-2", "principal", "2026-09-03T04:14:00Z"),
      corte("bar-1", "bar", "2026-09-03T02:58:00Z"),
      corte("principal-1", "principal", "2026-09-02T04:06:00Z"),
    ];

    const { desdePorCorte } = encadenarPeriodos(rows);

    expect(desdePorCorte.get("principal-2")).toBe("2026-09-02T04:06:00Z");
    expect(desdePorCorte.has("bar-1")).toBe(false);
  });

  it("marca sin predecesor al más viejo de CADA caja, no sólo al último", () => {
    const rows = [
      corte("principal-2", "principal", "2026-09-03T04:14:00Z"),
      corte("bar-1", "bar", "2026-09-03T02:58:00Z"),
      corte("principal-1", "principal", "2026-09-02T04:06:00Z"),
    ];

    const { sinPredecesor } = encadenarPeriodos(rows);

    expect(sinPredecesor.map((c) => c.id).sort()).toEqual([
      "bar-1",
      "principal-1",
    ]);
  });

  it("una lista vacía no rompe", () => {
    const { desdePorCorte, sinPredecesor } = encadenarPeriodos([]);
    expect(desdePorCorte.size).toBe(0);
    expect(sinPredecesor).toEqual([]);
  });

  it("un solo corte queda sin predecesor", () => {
    const { desdePorCorte, sinPredecesor } = encadenarPeriodos([
      corte("c1", "principal", "2026-09-03T04:14:00Z"),
    ]);
    expect(desdePorCorte.size).toBe(0);
    expect(sinPredecesor.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("ventanaDelCorte", () => {
  const cajaCreatedAt = "2026-01-15T12:00:00Z";

  it("va del corte anterior a este, y arrastra lo que aquel contó", () => {
    const ventana = ventanaDelCorte(
      { created_at: "2026-09-03T04:14:00Z" },
      { created_at: "2026-09-02T04:06:00Z", closing_cash_cents: 31_280_000 },
      cajaCreatedAt,
    );

    expect(ventana).toEqual({
      desde: "2026-09-02T04:06:00Z",
      hasta: "2026-09-03T04:14:00Z",
      arrastreBrutoCents: 31_280_000,
    });
  });

  it("el primer corte de una caja arranca en el alta de la caja, sin arrastre", () => {
    const ventana = ventanaDelCorte(
      { created_at: "2026-09-03T04:14:00Z" },
      null,
      cajaCreatedAt,
    );

    expect(ventana).toEqual({
      desde: cajaCreatedAt,
      hasta: "2026-09-03T04:14:00Z",
      arrastreBrutoCents: 0,
    });
  });

  it("dos turnos consecutivos no comparten ni pierden el instante del corte", () => {
    // El piso es exclusivo y el techo inclusivo: el corte del medio pertenece
    // a su propio turno y no vuelve a entrar en el siguiente. Si ambos bordes
    // fueran inclusivos, un cobro registrado en ese instante se contaría dos
    // veces; si ambos fueran exclusivos, se perdería.
    const delMedio = { created_at: "2026-09-02T04:06:00Z", closing_cash_cents: 0 };

    const primero = ventanaDelCorte(delMedio, null, cajaCreatedAt);
    const segundo = ventanaDelCorte(
      { created_at: "2026-09-03T04:14:00Z" },
      delMedio,
      cajaCreatedAt,
    );

    expect(primero.hasta).toBe(delMedio.created_at);
    expect(segundo.desde).toBe(delMedio.created_at);
  });
});
