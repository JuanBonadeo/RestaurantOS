// @vitest-environment node
//
// P10 · issue #263 — la forma del comprobante se valida ANTES de cobrar.
//
// El `safeParse` del comprobante vivía DESPUÉS de la RPC, o sea después de que
// el `payments` estaba commiteado, y devolvía `actionError`. Para el caller eso
// significa «no se cobró»: `venderMostrador` cancela la orden por el rescate de
// FR-007 y queda un pago vivo contra una orden cancelada. El operador lee
// «Datos del comprobante inválidos» y asume que no entró nada, mientras la caja
// ya lo cuenta.
//
// El test afirma lo único que importa: con un comprobante mal formado, la RPC
// **no se llama**.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "u1" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  getBusiness: async () => ({ id: "b1", slug: "golf", name: "Golf" }),
}));
vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role: "encargado" },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: rpcMock,
    from: (tabla: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (tabla === "orders") {
            return {
              data: {
                id: "o1", business_id: "b1", order_number: 1, table_id: null,
                lifecycle_status: "open", status: "preparing",
                total_cents: 10_000, total_paid_cents: 0, tip_cents: 0,
                discount_cents: 0, created_at: new Date().toISOString(),
                bill_requested_at: null, closed_at: null,
              },
            };
          }
          if (tabla === "cajas") {
            return {
              data: { id: "c1", business_id: "b1", is_active: true, is_administrative: false },
            };
          }
          return { data: null };
        },
      };
      return chain;
    },
  }),
}));

const { registrarPago } = await import("./cobro-actions");

describe("registrarPago · el comprobante se valida antes de la plata", () => {
  beforeEach(() => rpcMock.mockReset());

  it("con un comprobante mal formado no llama a la RPC", async () => {
    const r = await registrarPago({
      orderId: "o1",
      splitId: null,
      method: "cash",
      amount_cents: 10_000,
      tip_cents: 0,
      caja_id: "c1",
      slug: "golf",
      // `condicionIvaReceptor: 3` no está en el union permitido.
      comprobante: { tipo: "factura_a", condicionIvaReceptor: 3 } as never,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/comprobante/i);
    // Lo que importa: la plata nunca se tocó.
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
