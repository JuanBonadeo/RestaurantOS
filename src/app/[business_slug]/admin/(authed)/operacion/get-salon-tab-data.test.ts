import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 102 — `getSalonTabData` (refetch de la tab Mesas). Foco: el GATE de
// membresía. `loadSalon` corre con el cliente **service-role** (RLS bypass):
// órdenes abiertas, reservas del día con nombre y teléfono, el plano entero y
// la nómina de mozos. Sin el gate, cualquier autenticado leería todo eso de
// otro negocio pasando un slug foráneo. Mismo test que blindó la spec 052.
// Los bordes van mockeados para no tocar la DB.

let gateOk: boolean;

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) =>
    slug === "nope"
      ? null
      : { id: "biz1", slug, timezone: "America/Argentina/Buenos_Aires" },
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () =>
    gateOk
      ? {
          ok: true as const,
          data: { userId: "u1", role: "encargado", isPlatformAdmin: false },
        }
      : { ok: false as const, error: "No tenés acceso a este negocio." },
}));

const loadSalon = vi.fn(async () => ({
  floorPlans: [{ plan: { id: "fp1" }, tables: [] }],
  dineInOrders: [{ id: "o1" }],
  reservations: [{ id: "r1" }],
  mozos: [{ user_id: "u1", full_name: "Ana", role: "mozo" }],
}));
vi.mock("./data", () => ({
  loadSalon: (...args: unknown[]) => loadSalon(...(args as [])),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}),
}));

import { getSalonTabData } from "./actions";

beforeEach(() => {
  gateOk = true;
  vi.clearAllMocks();
});

describe("getSalonTabData", () => {
  it("negocio inexistente → error, sin tocar el loader", async () => {
    const res = await getSalonTabData("nope");
    expect(res.ok).toBe(false);
    expect(loadSalon).not.toHaveBeenCalled();
  });

  it("no-miembro → error y NO se lee el salón (sin fuga cross-tenant)", async () => {
    gateOk = false;
    const res = await getSalonTabData("golf");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/acceso/i);
    // La clave: el loader service-role no llega a correr.
    expect(loadSalon).not.toHaveBeenCalled();
  });

  it("miembro → devuelve las 4 partes de la tab", async () => {
    const res = await getSalonTabData("golf");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.floorPlans).toHaveLength(1);
      expect(res.data.dineInOrders).toHaveLength(1);
      expect(res.data.reservations).toHaveLength(1);
      expect(res.data.mozos).toHaveLength(1);
    }
  });

  it("la ventana de reservas se calcula en la TZ del negocio, no la del server", async () => {
    await getSalonTabData("golf");
    const [businessId, , window] = loadSalon.mock.calls[0] as unknown as [
      string,
      unknown,
      { todayStart: Date; tomorrowStart: Date },
    ];
    expect(businessId).toBe("biz1");
    // Medianoche de Buenos Aires = 03:00 UTC (UTC-3, sin DST).
    expect(window.todayStart.getUTCHours()).toBe(3);
    expect(window.tomorrowStart.getTime() - window.todayStart.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
