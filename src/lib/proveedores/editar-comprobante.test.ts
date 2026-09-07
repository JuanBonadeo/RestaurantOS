import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

/**
 * Spec 163 — editar un comprobante, con la guarda partida.
 *
 * Plata (total, fecha, tipo) sólo sin pagos vivos; clasificación (concepto,
 * vencimiento, número, notas) siempre. El caso que importa es el segundo: el
 * concepto mal puesto que se descubre a fin de mes con la compra ya paga, y que
 * hoy obliga a anular el pago —el que marca la sangría que el arqueo ya contó—,
 * así que nadie lo corrige y el informe queda sucio para siempre.
 */

const BIZ = "biz-1";
const INV = "00000000-0000-4000-8000-0000000000aa";
const CONCEPTO = "00000000-0000-4000-8000-0000000000bb";

let role: BusinessRole;
let invoice: Record<string, unknown> | null;
let allocsRes: { data: unknown[] | null; error: { message: string } | null };
let updates: Array<Record<string, unknown>>;

vi.mock("@/lib/tenant", () => ({ getBusiness: async () => ({ id: BIZ, slug: "demo" }) }));
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
          updates.push(row);
          return chain;
        },
        maybeSingle: async () =>
          tabla === "supplier_invoices"
            ? { data: invoice, error: null }
            : { data: null, error: null },
        then: (resolve: (v: unknown) => unknown) =>
          resolve(
            tabla === "supplier_payment_allocations" ? allocsRes : { data: [], error: null },
          ),
      };
      return chain;
    },
  }),
}));

const { editarComprobante } = await import("./cuenta-corriente-actions");

beforeEach(() => {
  role = "encargado";
  invoice = {
    id: INV,
    cancelled_at: null,
    total_cents: 100_000_00,
    document_type: "factura_a",
  };
  allocsRes = { data: [], error: null };
  updates = [];
});

const conPagoVivo = () => {
  allocsRes = {
    data: [{ payment_id: "p1", supplier_payments: { cancelled_at: null } }],
    error: null,
  };
};

describe("editarComprobante · clasificación (siempre se puede)", () => {
  it("corrige el concepto de un comprobante sin pagos", async () => {
    const r = await editarComprobante("demo", { id: INV, expense_concept_id: CONCEPTO });

    expect(r.ok).toBe(true);
    expect(updates[0]).toEqual({ expense_concept_id: CONCEPTO });
  });

  // EL caso de la spec: la compra ya está paga y el rótulo está mal.
  it("corrige el concepto AUNQUE el comprobante ya esté pago", async () => {
    conPagoVivo();

    const r = await editarComprobante("demo", { id: INV, expense_concept_id: CONCEPTO });

    expect(r.ok).toBe(true);
    expect(updates[0]).toEqual({ expense_concept_id: CONCEPTO });
  });

  it("y también el número, las notas y el vencimiento", async () => {
    conPagoVivo();

    const r = await editarComprobante("demo", {
      id: INV,
      invoice_number: "A-0001-00012345",
      notes: "llegó con el remito aparte",
      due_date: "2026-10-15",
    });

    expect(r.ok).toBe(true);
  });
});

describe("editarComprobante · plata (sólo sin pagos vivos)", () => {
  it("cambia el importe si no hay pagos", async () => {
    const r = await editarComprobante("demo", { id: INV, total_cents: 90_000_00 });

    expect(r.ok).toBe(true);
    expect(updates[0]).toEqual({ total_cents: 90_000_00 });
  });

  it("NO cambia el importe si hay un pago vivo", async () => {
    conPagoVivo();

    const r = await editarComprobante("demo", { id: INV, total_cents: 90_000_00 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya tiene pagos/i);
    expect(updates).toEqual([]);
  });

  it("con el pago anulado, la plata vuelve a ser editable", async () => {
    allocsRes = {
      data: [{ payment_id: "p1", supplier_payments: { cancelled_at: "2026-09-01T10:00:00Z" } }],
      error: null,
    };

    await expect(
      editarComprobante("demo", { id: INV, invoice_date: "2026-09-02" }),
    ).resolves.toMatchObject({ ok: true });
  });

  // Misma política que la guarda de anulación (spec 161 · D3): si no se puede
  // saber, no se toca.
  it("si falla la lectura de imputaciones, no toca la plata", async () => {
    allocsRes = { data: null, error: { message: "fetch failed" } };

    const r = await editarComprobante("demo", { id: INV, total_cents: 1 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no pudimos verificar/i);
    expect(updates).toEqual([]);
  });

  it("respeta el signo del tipo: una nota de crédito no va en positivo", async () => {
    const r = await editarComprobante("demo", {
      id: INV,
      document_type: "nota_credito",
      total_cents: 50_000_00,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/negativo/i);
    expect(updates).toEqual([]);
  });
});

describe("editarComprobante · lo que no se edita", () => {
  it("un comprobante anulado no se edita", async () => {
    invoice = { ...invoice!, cancelled_at: "2026-09-01T10:00:00Z" };

    const r = await editarComprobante("demo", { id: INV, notes: "algo" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anulado/i);
    expect(updates).toEqual([]);
  });

  it("uno que no existe tampoco", async () => {
    invoice = null;

    await expect(
      editarComprobante("demo", { id: INV, notes: "algo" }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("un mozo no edita comprobantes", async () => {
    role = "mozo";

    const r = await editarComprobante("demo", { id: INV, notes: "algo" });

    expect(r.ok).toBe(false);
    expect(updates).toEqual([]);
  });
});
