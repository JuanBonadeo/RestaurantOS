import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

/**
 * Spec 161 · D3 — la guarda de anulación falla CERRADA.
 *
 * `anularComprobante` no destructuraba el `error` de la lectura de imputaciones.
 * Como postgrest-js devuelve `{data: null, error}` en vez de lanzar, una lectura
 * caída dejaba `conPagoVivo` en `false` y **el comprobante pago se anulaba
 * igual** — justo lo que la guarda de la 158 vino a impedir. Abajo no hay red:
 * el FK `ON DELETE RESTRICT` protege el borrado, no la anulación lógica.
 */

const BIZ = "biz-1";
const INVOICE = "00000000-0000-4000-8000-0000000000aa";

let role: BusinessRole;
/** Qué devuelve la lectura de `supplier_payment_allocations`. */
let allocsRes: { data: unknown[] | null; error: { message: string } | null };
let updates: Array<Record<string, unknown>>;

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
    from: (tabla: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        update: (row: Record<string, unknown>) => {
          updates.push({ tabla, ...row });
          return chain;
        },
        maybeSingle: async () =>
          tabla === "supplier_invoices"
            ? { data: { id: INVOICE, cancelled_at: null }, error: null }
            : { data: null, error: null },
        then: (resolve: (v: unknown) => unknown) =>
          resolve(
            tabla === "supplier_payment_allocations"
              ? allocsRes
              : { data: [], error: null },
          ),
      };
      return chain;
    },
  }),
}));

const { anularComprobante } = await import("./cuenta-corriente-actions");

beforeEach(() => {
  role = "encargado";
  allocsRes = { data: [], error: null };
  updates = [];
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
    allocsRes = {
      data: [{ payment_id: "p1", supplier_payments: { cancelled_at: null } }],
      error: null,
    };

    const r = await anular();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anulá primero el pago/i);
    expect(updates).toEqual([]);
  });

  it("con el pago ya anulado, sí anula: la deuda volvió", async () => {
    allocsRes = {
      data: [{ payment_id: "p1", supplier_payments: { cancelled_at: "2026-09-01T10:00:00Z" } }],
      error: null,
    };

    await expect(anular()).resolves.toMatchObject({ ok: true });
  });

  // EL caso de la spec: antes de este fix, esto devolvía ok:true y el
  // comprobante quedaba anulado con un pago vivo colgando.
  it("si la lectura de imputaciones FALLA, no anula", async () => {
    allocsRes = { data: null, error: { message: "fetch failed" } };

    const r = await anular();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no pudimos verificar/i);
    expect(updates, "se anuló sin poder saber si tenía pagos").toEqual([]);
  });

  it("tampoco si vuelve sin datos y sin error", async () => {
    allocsRes = { data: null, error: null };

    await expect(anular()).resolves.toMatchObject({ ok: false });
    expect(updates).toEqual([]);
  });

  it("un mozo no anula comprobantes", async () => {
    role = "mozo";

    const r = await anular();

    expect(r.ok).toBe(false);
    expect(updates).toEqual([]);
  });
});
