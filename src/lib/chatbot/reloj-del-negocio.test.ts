// @vitest-environment node
//
// El reloj del bot: qué día y qué hora cree que es en el local.
//
// Este archivo fija la TZ del PROCESO antes de importar nada, porque ése es
// exactamente el eje del bug: el cálculo viejo (`toZonedTime(now, tz).getUTCDay()`)
// sólo acierta cuando el server corre en UTC. En Vercel corre en UTC y por eso
// nunca se vio; en `pnpm dev` desde Argentina —y en cualquier runtime que no sea
// UTC— el bot leía un día de más y tres horas de más.
process.env.TZ = "America/Argentina/Buenos_Aires";

import { describe, expect, it } from "vitest";

import { buildDateContext, positionInBusinessWeek } from "./agent";

const TZ = "America/Argentina/Buenos_Aires";

// Viernes 11/09/2026, 21:00 en Argentina = sábado 00:00 UTC. El instante donde
// el offset del server (UTC-3) empuja el eje al día siguiente.
const viernes21EnArgentina = new Date("2026-09-12T00:00:00Z");

describe("positionInBusinessWeek — el eje semanal es el del local, no el del server", () => {
  it("un viernes 21:00 en Argentina sigue siendo viernes 21:00", () => {
    const { dow, dayMinutes } = positionInBusinessWeek(
      viernes21EnArgentina,
      TZ,
    );
    expect(dow).toBe(5); // viernes
    expect(dayMinutes).toBe(21 * 60);
  });

  it("los minutos de la semana arrancan el domingo 00:00 del local", () => {
    const { weekMinutes } = positionInBusinessWeek(viernes21EnArgentina, TZ);
    expect(weekMinutes).toBe(5 * 1440 + 21 * 60);
  });

  it("un negocio en otra zona horaria se ubica en la suya", () => {
    // Mismo instante, negocio en Madrid: allá ya son las 02:00 del sábado.
    const { dow, dayMinutes } = positionInBusinessWeek(
      viernes21EnArgentina,
      "Europe/Madrid",
    );
    expect(dow).toBe(6); // sábado
    expect(dayMinutes).toBe(2 * 60);
  });
});

describe("buildDateContext — el nombre del día y la fecha tienen que ser el mismo día", () => {
  it("dice viernes cuando es viernes a la noche", () => {
    const ctx = buildDateContext(viernes21EnArgentina, TZ);
    expect(ctx).toContain("Hoy es viernes 2026-09-11");
  });

  it("no mezcla el nombre de un día con la fecha de otro", () => {
    // El bug viejo armaba "Hoy es sábado 2026-09-11": el nombre salía de
    // `getUTCDay()` (corrido por el offset del server) y la fecha de
    // `formatInTimeZone` (correcta). Con eso, "el sábado" se resolvía a hoy y
    // la reserva se tomaba para el día equivocado.
    const ctx = buildDateContext(viernes21EnArgentina, TZ);
    expect(ctx).not.toContain("sábado 2026-09-11");
  });
});
