import { describe, expect, it } from "vitest";

import { startOfOperatingDayUtc, startOfTodayUtc } from "./orders-query";

/**
 * P06 · issue #259 — el board tiene que cortar por jornada operativa, no por
 * medianoche.
 *
 * El delivery de las 23:40 y el encargado que lo mira a las 00:05 están en la
 * MISMA jornada de trabajo (`business_day`, corte 6 AM, migración 0049). Con el
 * corte en medianoche el pedido se caía del board justo cuando todavía había
 * que entregarlo y cobrarlo.
 */
const TZ = "America/Argentina/Buenos_Aires";

/** Un instante dado en hora local de Buenos Aires (UTC−3). */
const enBsAs = (iso: string) => new Date(`${iso}-03:00`);

describe("startOfOperatingDayUtc", () => {
  it("a las 00:05 la jornada sigue siendo la que arrancó AYER a las 6", () => {
    const corte = startOfOperatingDayUtc(TZ, enBsAs("2026-09-07T00:05:00"));
    expect(corte.toISOString()).toBe("2026-09-06T09:00:00.000Z"); // 06:00 AR del 6
  });

  it("a las 07:00 la jornada es la de hoy", () => {
    const corte = startOfOperatingDayUtc(TZ, enBsAs("2026-09-07T07:00:00"));
    expect(corte.toISOString()).toBe("2026-09-07T09:00:00.000Z"); // 06:00 AR del 7
  });

  it("a las 05:59 todavía no cambió la jornada; a las 06:00 sí", () => {
    const antes = startOfOperatingDayUtc(TZ, enBsAs("2026-09-07T05:59:00"));
    const despues = startOfOperatingDayUtc(TZ, enBsAs("2026-09-07T06:00:00"));
    expect(antes.toISOString()).toBe("2026-09-06T09:00:00.000Z");
    expect(despues.toISOString()).toBe("2026-09-07T09:00:00.000Z");
  });

  it("el pedido de las 23:40 sigue entrando al board a las 00:05", () => {
    // Es el caso del hallazgo, escrito como lo vive el local.
    const pedido = enBsAs("2026-09-06T23:40:00");
    const cuandoLoMiran = enBsAs("2026-09-07T00:05:00");

    const corte = startOfOperatingDayUtc(TZ, cuandoLoMiran);
    expect(
      pedido >= corte,
      "el delivery que está en cocina no puede desaparecer del board",
    ).toBe(true);
  });

  it("no se confunde con medianoche: son dos cortes distintos", () => {
    // La jornada y el calendario NO son intercambiables. Reservas usa
    // medianoche a propósito («la del jueves» es del jueves aunque el local
    // siga sirviendo a la 1 AM); pedidos usa la jornada. Mezclarlas fue el bug
    // #259 en un sentido, y correría el libro de reservas tres horas en el otro.
    const cuando = enBsAs("2026-09-07T00:05:00");
    expect(startOfTodayUtc(TZ, cuando).toISOString()).toBe(
      "2026-09-07T03:00:00.000Z",
    );
    expect(startOfOperatingDayUtc(TZ, cuando).toISOString()).toBe(
      "2026-09-06T09:00:00.000Z",
    );
  });

  it("el de anteayer NO entra: la ventana sigue siendo de una jornada", () => {
    const viejo = enBsAs("2026-09-05T23:40:00");
    const corte = startOfOperatingDayUtc(TZ, enBsAs("2026-09-07T00:05:00"));
    expect(viejo >= corte).toBe(false);
  });
});
