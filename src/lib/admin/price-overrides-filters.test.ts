import { describe, expect, it, vi } from "vitest";

// Regresión encontrada por la verificación adversarial de la spec 069: el
// filtro de órdenes anuladas usaba SÓLO `orders.status`. Pero en el salón,
// anular o liberar una mesa escribe `orders.lifecycle_status = 'cancelled'` y
// deja `status` como estaba — no hay trigger que las sincronice. Con eso, una
// mesa anulada con un ítem a mitad de precio sumaba a «se dejó de cobrar»
// plata que nunca se cobró ni se resignó.
//
// Se testea la CADENA de filtros, no el string del fuente: lo que importa es
// que la query pida las dos exclusiones.

const calls: { method: string; args: unknown[] }[] = [];

function chain(): Record<string, unknown> {
  const proxy: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "not", "gte", "lt", "in"]) {
    proxy[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return proxy;
    };
  }
  // Se resuelve como la respuesta final del query builder.
  proxy.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => chain() }),
}));

const { getPriceOverrides } = await import("./price-overrides-query");

describe("getPriceOverrides · exclusión de órdenes anuladas", () => {
  it("excluye por lifecycle_status ADEMÁS de status", async () => {
    calls.length = 0;
    await getPriceOverrides("biz1", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z");

    const neqs = calls
      .filter((c) => c.method === "neq")
      .map((c) => `${c.args[0]}=${c.args[1]}`);

    expect(neqs).toContain("orders.status=cancelled");
    // Sin esta, una mesa anulada sigue contando como plata resignada.
    expect(neqs).toContain("orders.lifecycle_status=cancelled");
  });

  it("scopea por negocio y filtra el rango con gte/lt sobre price_override_at", async () => {
    calls.length = 0;
    await getPriceOverrides("biz1", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z");

    expect(
      calls.some(
        (c) => c.method === "eq" && c.args[0] === "orders.business_id",
      ),
    ).toBe(true);
    // El rango va sobre el ACTO de cambiar el precio, no sobre la venta: el
    // encargado puede corregir hoy una mesa de ayer.
    expect(
      calls.some(
        (c) => c.method === "gte" && c.args[0] === "price_override_at",
      ),
    ).toBe(true);
    // Semiabierto: `lt`, nunca `lte` — con `lte` se cuenta un día de más.
    expect(
      calls.some((c) => c.method === "lt" && c.args[0] === "price_override_at"),
    ).toBe(true);
    expect(calls.some((c) => c.method === "lte")).toBe(false);
  });

  it("descarta ítems cancelados — no se cobraron en absoluto", async () => {
    calls.length = 0;
    await getPriceOverrides("biz1", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z");
    expect(
      calls.some((c) => c.method === "is" && c.args[0] === "cancelled_at"),
    ).toBe(true);
  });
});
