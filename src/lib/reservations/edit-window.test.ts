import { describe, expect, it } from "vitest";

import { estrictoEditWindow, flexibleEditWindow, localDateOf } from "@/lib/reservations/edit-window";

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3, sin DST

/** 2026-08-05 21:00 local. */
const START_2100 = "2026-08-06T00:00:00.000Z";

const CENA = { opens_at: "20:00:00", closes_at: "22:30:00" };
const CENA_TRASNOCHE = { opens_at: "20:00:00", closes_at: "00:30:00" };

describe("localDateOf", () => {
  it("usa el día LOCAL del negocio, no el UTC", () => {
    // 00:00Z del 6 son las 21:00 del 5 en AR.
    expect(localDateOf(new Date(START_2100), TZ)).toBe("2026-08-05");
  });

  it("no se corre de día con horarios de madrugada", () => {
    expect(localDateOf(new Date("2026-08-06T02:30:00.000Z"), TZ)).toBe("2026-08-05");
  });
});

describe("estrictoEditWindow", () => {
  it("mueve el arranque a la hora nueva del MISMO día local", () => {
    const w = estrictoEditWindow({
      currentStartsAt: START_2100,
      time: "22:00",
      timezone: TZ,
      slotDurationMin: 90,
    });
    expect(w?.starts.toISOString()).toBe("2026-08-06T01:00:00.000Z");
  });

  it("recalcula el cierre con la duración de slot del negocio", () => {
    const w = estrictoEditWindow({
      currentStartsAt: START_2100,
      time: "22:00",
      timezone: TZ,
      slotDurationMin: 90,
    });
    expect(w?.ends.toISOString()).toBe("2026-08-06T02:30:00.000Z");

    const corto = estrictoEditWindow({
      currentStartsAt: START_2100,
      time: "22:00",
      timezone: TZ,
      slotDurationMin: 60,
    });
    expect(corto?.ends.toISOString()).toBe("2026-08-06T02:00:00.000Z");
  });

  it("devuelve null si la hora no es una hora", () => {
    expect(
      estrictoEditWindow({
        currentStartsAt: START_2100,
        time: "25:99",
        timezone: TZ,
        slotDurationMin: 90,
      }),
    ).toBeNull();
  });

  it("devuelve null si la reserva no tiene un arranque válido", () => {
    expect(
      estrictoEditWindow({
        currentStartsAt: "no-es-fecha",
        time: "22:00",
        timezone: TZ,
        slotDurationMin: 90,
      }),
    ).toBeNull();
  });
});

describe("flexibleEditWindow", () => {
  it("el cierre es el CIERRE DEL SERVICIO, no arranque + duración", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: CENA,
      time: "21:00",
      timezone: TZ,
      serviceChanged: false,
      currentStartsAt: START_2100,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.starts.toISOString()).toBe("2026-08-06T00:00:00.000Z");
    expect(r.ends.toISOString()).toBe("2026-08-06T01:30:00.000Z"); // 22:30 local
  });

  it("rechaza una hora fuera de la ventana del servicio", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: CENA,
      time: "23:00",
      timezone: TZ,
      serviceChanged: false,
      currentStartsAt: START_2100,
    });
    expect(r).toEqual({ ok: false, reason: "fuera-de-servicio" });
  });

  it("sin hora, cambiar de servicio arranca en la apertura del nuevo", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: CENA,
      timezone: TZ,
      serviceChanged: true,
      currentStartsAt: "2026-08-05T15:30:00.000Z", // era del almuerzo
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.starts.toISOString()).toBe("2026-08-05T23:00:00.000Z"); // 20:00 local
  });

  it("sin hora y sin cambio de servicio, conserva el arranque", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: CENA,
      timezone: TZ,
      serviceChanged: false,
      currentStartsAt: START_2100,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.starts.toISOString()).toBe(START_2100);
  });

  it("una hora de madrugada cae en el servicio que cruza la medianoche", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: CENA_TRASNOCHE,
      time: "00:15",
      timezone: TZ,
      serviceChanged: false,
      currentStartsAt: START_2100,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 00:15 del 6 local = 03:15Z del 6, dentro de [20:00 del 5, 00:30 del 6].
    expect(r.starts.toISOString()).toBe("2026-08-06T03:15:00.000Z");
    expect(r.ends.toISOString()).toBe("2026-08-06T03:30:00.000Z");
  });

  it("rechaza una ventana de servicio inválida", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: { opens_at: "nope", closes_at: "22:30:00" },
      time: "21:00",
      timezone: TZ,
      serviceChanged: false,
      currentStartsAt: START_2100,
    });
    expect(r).toEqual({ ok: false, reason: "ventana-invalida" });
  });

  it("rechaza una hora que no es una hora", () => {
    const r = flexibleEditWindow({
      serviceDate: "2026-08-05",
      service: CENA,
      time: "99:99",
      timezone: TZ,
      serviceChanged: false,
      currentStartsAt: START_2100,
    });
    expect(r).toEqual({ ok: false, reason: "hora-invalida" });
  });
});
