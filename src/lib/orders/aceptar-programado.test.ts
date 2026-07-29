import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

/**
 * Spec 061 — `aceptarPedidoProgramado`: el encargado avala un programado sin
 * marcharlo. Es la pieza que hace que un delivery programado en efectivo llegue
 * a cocina algún día sin romper la política de spec 047 ("imprime solo lo que
 * el local ya avaló"). Lo que se prueba acá son las guardas y, sobre todo, que
 * **no** rutee a cocina.
 */

type OrderRow = {
  id: string;
  business_id: string;
  status: string;
  delivery_type: string;
  scheduled_at: string | null;
};

let currentRole: BusinessRole;
let orderRow: OrderRow | null;
let captured: { updates: Record<string, unknown>[]; routed: string[] };

const FUTURO = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
const PASADO = new Date(Date.now() - 60 * 60_000).toISOString();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) =>
    slug === "nope" ? null : { id: "biz1", slug },
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role: currentRole, isPlatformAdmin: false },
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: orderRow }) }),
      }),
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          captured.updates.push(vals);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

vi.mock("./route-to-cocina", () => ({
  routeOrderToCocina: async (orderId: string) => {
    captured.routed.push(orderId);
    return {
      ok: true as const,
      data: { order_id: orderId, comanda_ids: ["c1"], items_without_station: 0 },
    };
  },
}));

const { aceptarPedidoProgramado } = await import("./confirm-order");

beforeEach(() => {
  currentRole = "encargado";
  orderRow = {
    id: "o1",
    business_id: "biz1",
    status: "pending",
    delivery_type: "delivery",
    scheduled_at: FUTURO,
  };
  captured = { updates: [], routed: [] };
});

describe("aceptarPedidoProgramado", () => {
  it("el encargado lo pasa a confirmed SIN crear comandas", async () => {
    const res = await aceptarPedidoProgramado("o1", "house");
    expect(res.ok).toBe(true);
    expect(captured.updates).toEqual([{ status: "confirmed" }]);
    // Lo central: no se imprime nada al aceptar.
    expect(captured.routed).toEqual([]);
  });

  it("el admin también puede", async () => {
    currentRole = "admin";
    expect((await aceptarPedidoProgramado("o1", "house")).ok).toBe(true);
  });

  it("el mozo no puede", async () => {
    currentRole = "mozo";
    const res = await aceptarPedidoProgramado("o1", "house");
    expect(res.ok).toBe(false);
    expect(captured.updates).toEqual([]);
  });

  it("rechaza un pedido de otro negocio", async () => {
    orderRow = { ...orderRow!, business_id: "biz2" };
    const res = await aceptarPedidoProgramado("o1", "house");
    expect(res).toMatchObject({ ok: false, error: "Pedido no encontrado." });
  });

  it("rechaza un pedido en mesa", async () => {
    orderRow = { ...orderRow!, delivery_type: "dine_in" };
    const res = await aceptarPedidoProgramado("o1", "house");
    expect(res).toMatchObject({
      ok: false,
      error: "Los pedidos en mesa no se programan.",
    });
  });

  it("rechaza un pedido que no es diferido (para ahora)", async () => {
    orderRow = { ...orderRow!, scheduled_at: null };
    const res = await aceptarPedidoProgramado("o1", "house");
    expect(res.ok).toBe(false);
    expect(captured.updates).toEqual([]);
  });

  it("rechaza un programado cuya hora ya pasó", async () => {
    orderRow = { ...orderRow!, scheduled_at: PASADO };
    expect((await aceptarPedidoProgramado("o1", "house")).ok).toBe(false);
  });

  it("aceptar dos veces no hace nada la segunda", async () => {
    orderRow = { ...orderRow!, status: "confirmed" };
    const res = await aceptarPedidoProgramado("o1", "house");
    expect(res.ok).toBe(false);
    expect(captured.updates).toEqual([]);
  });
});
