import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

/**
 * La anulación de un comprobante, y su guarda de pagos vivos.
 *
 * ── Spec 161 · D3 — la guarda fallaba ABIERTA ─────────────────────────────
 *
 * `anularComprobante` no destructuraba el `error` de la lectura de imputaciones.
 * Como postgrest-js devuelve `{data: null, error}` en vez de lanzar, una lectura
 * caída dejaba `conPagoVivo` en `false` y el comprobante pago **se anulaba
 * igual**. Abajo no hay red: el FK `ON DELETE RESTRICT` protege el borrado, no
 * la anulación lógica.
 *
 * ── Issue #268 — y además fallaba TARDE ───────────────────────────────────
 *
 * Cerrar la lectura no alcanzaba, porque la guarda seguía siendo una consulta y
 * la anulación otra, con la RPC de reversión de stock en el medio. En esa
 * ventana entra entero un `registrar_pago_proveedor_tx`: ganaban las dos
 * operaciones y quedaba un comprobante ANULADO con un pago VIVO imputado —
 * exactamente el estado que la guarda dice impedir.
 *
 * Ahora la guarda, la reversión de stock y la anulación viven en
 * `anular_comprobante_tx` (0085), bajo el mismo `for update` que toma el pago.
 * Estos tests cubren **qué ve el usuario en cada caso**; el fake de `rpc`
 * reproduce la política de la RPC. Que el lock aguante la carrera se verifica
 * contra la base en `anular-vs-pagar.integration.test.ts`: un mock no puede
 * probar un lock.
 */

const BIZ = "biz-1";
const INVOICE = "00000000-0000-4000-8000-0000000000aa";

let role: BusinessRole;
let invoice: { cancelled_at: string | null } | null;
/** Imputaciones de pagos VIVOS sobre el comprobante. */
let pagosVivos: number;
/** La RPC se cae por algo que no es de negocio (red, permisos, deadlock). */
let rpcRota: boolean;
/** Las anulaciones efectivamente escritas. */
let updates: Array<Record<string, unknown>>;
let rpcCalls: string[];

vi.mock("@/lib/tenant", () => ({
  getBusiness: async () => ({ id: BIZ, slug: "demo" }),
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role, isPlatformAdmin: false },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/caja/queries", () => ({ getCajaAdministrativa: async () => null }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    // Reproduce `anular_comprobante_tx` (0085): mismo orden de guardas y mismos
    // nombres de excepción, que es lo que la action traduce a mensajes.
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(fn);
      if (fn !== "anular_comprobante_tx") return { data: 0, error: null };
      if (rpcRota) return { data: null, error: { message: "connection reset" } };
      if (!invoice) return { data: null, error: { message: "COMPROBANTE_NO_ENCONTRADO" } };
      if (invoice.cancelled_at) {
        return { data: null, error: { message: "COMPROBANTE_YA_ANULADO" } };
      }
      if (pagosVivos > 0) {
        return { data: null, error: { message: "COMPROBANTE_CON_PAGO_VIVO" } };
      }
      updates.push({
        cancelled_by: args.p_cancelled_by,
        cancelled_reason: args.p_reason,
      });
      return { data: null, error: null };
    },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const { anularComprobante } = await import("./cuenta-corriente-actions");

beforeEach(() => {
  role = "encargado";
  invoice = { cancelled_at: null };
  pagosVivos = 0;
  rpcRota = false;
  updates = [];
  rpcCalls = [];
});

const anular = () =>
  anularComprobante("demo", { id: INVOICE, reason: "cargado dos veces" });

describe("anularComprobante · la guarda no falla abierta (spec 161 · D3)", () => {
  it("sin imputaciones, anula", async () => {
    const r = await anular();

    expect(r.ok).toBe(true);
    expect(updates[0]?.cancelled_reason).toBe("cargado dos veces");
  });

  it("con un pago vivo imputado, no anula", async () => {
    pagosVivos = 1;

    const r = await anular();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anulá primero el pago/i);
    expect(updates).toEqual([]);
  });

  it("con el pago ya anulado, sí anula: la deuda volvió", async () => {
    pagosVivos = 0;

    await expect(anular()).resolves.toMatchObject({ ok: true });
  });

  // La lectura de imputaciones ya no vuelve a TS: si algo de la transacción se
  // cae, se cae entera. No queda ni la anulación ni el stock revertido a medias
  // — que era el otro modo de falla del camino de tres round-trips.
  it("si la transacción FALLA, no anula", async () => {
    rpcRota = true;

    const r = await anular();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no pudimos anular/i);
    expect(updates, "se anuló sin poder saber si tenía pagos").toEqual([]);
  });

  it("un comprobante ya anulado no se vuelve a anular", async () => {
    invoice = { cancelled_at: "2026-09-01T10:00:00Z" };

    const r = await anular();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya estaba anulado/i);
    expect(updates).toEqual([]);
  });

  it("uno que no existe tampoco", async () => {
    invoice = null;

    await expect(anular()).resolves.toMatchObject({ ok: false });
    expect(updates).toEqual([]);
  });

  it("un mozo no anula comprobantes", async () => {
    role = "mozo";

    const r = await anular();

    expect(r.ok).toBe(false);
    expect(updates).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });
});
