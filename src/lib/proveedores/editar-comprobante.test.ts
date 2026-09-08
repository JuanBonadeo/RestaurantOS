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
 *
 * ── Por qué este archivo cambió (issue #268) ──────────────────────────────
 *
 * La guarda vivía acá, en TS: se leían las imputaciones con una consulta y se
 * escribía el update con otra. Entre las dos entraba entero un
 * `registrar_pago_proveedor_tx`, así que la regla «la plata no se toca con pagos
 * vivos» era cierta en el papel y falsa en la carrera. Ahora la guarda y la
 * escritura viven en `editar_comprobante_tx` (0085), bajo el mismo `for update`
 * que toma el pago.
 *
 * Estos tests siguen cubriendo **qué ve el usuario en cada caso**; el fake de
 * `rpc` de abajo reproduce la política de la RPC a partir de las mismas fixtures
 * de antes. Que la guarda realmente aguante la carrera se verifica contra la
 * base en `anular-vs-pagar.integration.test.ts` — un mock no puede probar un
 * lock.
 */

const BIZ = "biz-1";
const INV = "00000000-0000-4000-8000-0000000000aa";
const CONCEPTO = "00000000-0000-4000-8000-0000000000bb";

let role: BusinessRole;
let invoice: Record<string, unknown> | null;
/** Imputaciones de pagos VIVOS sobre este comprobante (lo que cuenta la RPC). */
let pagosVivos: number;
/** La RPC se cae por una razón que no es de negocio (red, permisos). */
let rpcRota: boolean;
/** ¿El concepto que se manda es de este negocio? */
let conceptoPropio: boolean;
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

const CAMPOS_DE_PLATA = ["total_cents", "invoice_date", "document_type"];

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    // Reproduce `editar_comprobante_tx` (0085): mismo orden de guardas y mismos
    // nombres de excepción, que es lo que la action traduce a mensajes.
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "editar_comprobante_tx") return { data: null, error: null };
      if (rpcRota) return { data: null, error: { message: "connection reset" } };

      const campos = args.p_campos as Record<string, unknown>;
      if (!invoice) return { data: null, error: { message: "COMPROBANTE_NO_ENCONTRADO" } };
      if (invoice.cancelled_at) return { data: null, error: { message: "COMPROBANTE_ANULADO" } };

      const tocaPlata = CAMPOS_DE_PLATA.some((k) => k in campos);
      if (tocaPlata) {
        if (pagosVivos > 0) {
          return { data: null, error: { message: "COMPROBANTE_CON_PAGO_VIVO" } };
        }
        const tipo = (campos.document_type ?? invoice.document_type) as string;
        const total = (campos.total_cents ?? invoice.total_cents) as number;
        if (tipo === "nota_credito" ? total > 0 : total < 0) {
          return { data: null, error: { message: "SIGNO_INVALIDO" } };
        }
      }

      updates.push(campos);
      return { data: null, error: null };
    },
    from: (tabla: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () =>
          tabla === "expense_concepts"
            ? { data: conceptoPropio ? { id: CONCEPTO } : null, error: null }
            : { data: null, error: null },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
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
  pagosVivos = 0;
  rpcRota = false;
  conceptoPropio = true;
  updates = [];
});

const conPagoVivo = () => {
  pagosVivos = 1;
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

  // Issue #268 · el concepto es el único campo editable con pagos vivos, así que
  // es la puerta más expuesta para meter un id de otro negocio: el FK sólo
  // chequea existencia y el service client bypassa RLS.
  it("no acepta un concepto de otro negocio", async () => {
    conceptoPropio = false;

    const r = await editarComprobante("demo", { id: INV, expense_concept_id: CONCEPTO });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no es de este negocio/i);
    expect(updates).toEqual([]);
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
    pagosVivos = 0;

    await expect(
      editarComprobante("demo", { id: INV, invoice_date: "2026-09-02" }),
    ).resolves.toMatchObject({ ok: true });
  });

  // Misma política que antes (spec 161 · D3): si no se puede saber, no se toca.
  // Lo que cambió es dónde: la lectura de imputaciones ya no vuelve a TS, así
  // que un fallo de la RPC es el fallo de toda la transacción — no queda un
  // update a medias.
  it("si la RPC falla, no se guarda nada", async () => {
    rpcRota = true;

    const r = await editarComprobante("demo", { id: INV, total_cents: 1 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no pudimos guardar/i);
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
