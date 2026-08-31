import { describe, expect, it } from "vitest";

import {
  agruparPorDia,
  esUrgente,
  labelDelDia,
  labelDeVencimiento,
  localDate,
  ocupacionPorCubiertos,
  ocupacionPorMesas,
  type SolicitudEnBandeja,
} from "./pending-inbox";

const TZ = "America/Argentina/Buenos_Aires";
/** 2026-09-01 18:00 ART. */
const NOW = new Date("2026-09-01T21:00:00Z");

function solicitud(startsAt: string, venceEn: string, id = startsAt): SolicitudEnBandeja {
  return {
    reserva: {
      id,
      business_id: "b1",
      table_id: null,
      user_id: null,
      customer_name: "X",
      customer_phone: "0",
      party_size: 2,
      starts_at: startsAt,
      ends_at: startsAt,
      status: "pending",
      notes: null,
      source: "web",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    venceEn,
    ocupacion: null,
  };
}

describe("localDate", () => {
  it("usa la TZ del negocio, no UTC", () => {
    // 2026-09-02 02:00Z = 2026-09-01 23:00 ART: sigue siendo el día 1 en el local.
    expect(localDate("2026-09-02T02:00:00Z", TZ)).toBe("2026-09-01");
  });
});

describe("labelDelDia", () => {
  it("hoy y mañana se dicen por su nombre", () => {
    expect(labelDelDia("2026-09-01", TZ, NOW)).toBe("Hoy");
    expect(labelDelDia("2026-09-02", TZ, NOW)).toBe("Mañana");
  });

  it("el resto lleva fecha", () => {
    expect(labelDelDia("2026-09-06", TZ, NOW)).toContain("6");
  });
});

describe("labelDeVencimiento", () => {
  it("minutos, horas, días y vencida", () => {
    const en = (min: number) =>
      new Date(NOW.getTime() + min * 60_000).toISOString();
    expect(labelDeVencimiento(en(25), NOW)).toBe("vence en 25 min");
    expect(labelDeVencimiento(en(120), NOW)).toBe("vence en 2 h");
    expect(labelDeVencimiento(en(60 * 48), NOW)).toBe("vence en 2 d");
    expect(labelDeVencimiento(en(-5), NOW)).toBe("vencida");
  });
});

describe("esUrgente", () => {
  it("marca lo que vence dentro de tres horas", () => {
    const en = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
    expect(esUrgente(en(2), NOW)).toBe(true);
    expect(esUrgente(en(4), NOW)).toBe(false);
  });
});

describe("ocupación", () => {
  it("cubiertos con cupo da texto y barra", () => {
    const o = ocupacionPorCubiertos("Cena", 48, 100);
    expect(o.label).toBe("Cena · 48/100");
    expect(o.ratio).toBeCloseTo(0.48);
  });

  it("cubiertos sin cupo configurado no inventa una barra", () => {
    const o = ocupacionPorCubiertos("Cena", 48, null);
    expect(o.label).toBe("Cena · 48 cubiertos");
    expect(o.ratio).toBeNull();
  });

  it("mesas: el caso sin lugar se dice con todas las letras", () => {
    expect(ocupacionPorMesas(0, 20).label).toBe("sin mesas libres a esa hora");
    expect(ocupacionPorMesas(7, 20).label).toBe("7 de 20 mesas libres");
    expect(ocupacionPorMesas(7, 20).ratio).toBeCloseTo(0.65);
  });
});

describe("agruparPorDia", () => {
  it("agrupa por día local y ordena por la que vence primero", () => {
    const tarde = solicitud(
      "2026-09-06T23:00:00Z",
      new Date(NOW.getTime() + 5 * 3600_000).toISOString(),
      "tarde",
    );
    const urgente = solicitud(
      "2026-09-06T16:00:00Z",
      new Date(NOW.getTime() + 1 * 3600_000).toISOString(),
      "urgente",
    );
    const hoy = solicitud(
      "2026-09-02T00:00:00Z",
      new Date(NOW.getTime() + 2 * 3600_000).toISOString(),
      "hoy",
    );

    const dias = agruparPorDia([tarde, urgente, hoy], TZ, NOW);
    expect(dias.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-06"]);
    expect(dias[0].label).toBe("Hoy");
    expect(dias[1].solicitudes.map((s) => s.reserva.id)).toEqual([
      "urgente",
      "tarde",
    ]);
  });

  it("sin solicitudes, sin días", () => {
    expect(agruparPorDia([], TZ, NOW)).toEqual([]);
  });
});
