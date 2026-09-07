import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

/**
 * Spec 160 — de qué caja sale el pago a proveedor.
 *
 * `registrarPagoProveedor` no tenía **ningún** test (la 158 la dejó sin red), y es
 * la función donde vive el bug que esta spec arregla: el egreso caía en el cajón
 * del turno y descuadraba el arqueo por su monto entero.
 *
 * Lo que se fija acá es el invariante que no se puede volver a romper: **la caja la
 * resuelve el server**. Mockeamos el borde (tenant, auth, la caja administrativa y
 * el service client) y afirmamos sobre lo que se escribe.
 *
 * **Spec 161 · D4 — cambió DÓNDE se observa, no qué se afirma.** Las tres
 * escrituras del pago (sangría, pago, imputaciones) dejaron de ser tres inserts
 * sueltos y pasaron a una RPC transaccional, porque un fallo en la tercera
 * devolvía OK con la caja descuadrada. El invariante de la 160 es el mismo: lo
 * que antes se leía en `inserts["caja_movimientos"][0].caja_id` ahora se lee en
 * el `p_caja_id` con el que la action llama a la RPC. Si alguien reintroduce el
 * `caja_id` en el input, estos tests lo siguen cazando.
 */

const BIZ = "biz-1";
const SUPPLIER = "00000000-0000-4000-8000-000000000001";
const CAJA_ADMIN = "11111111-1111-4111-8111-111111111111";
const CAJA_TURNO = "22222222-2222-4222-8222-222222222222";

let role: BusinessRole;
let cajaAdmin: { id: string; name: string; is_active: boolean } | null;

/** Todo lo insertado, por tabla, en orden. */
let inserts: Record<string, Record<string, unknown>[]>;

/** Las llamadas a RPC, en orden — acá vive ahora la escritura del pago. */
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) => (slug === "nope" ? null : { id: BIZ, slug }),
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role, isPlatformAdmin: false },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/caja/queries", () => ({
  getCajaAdministrativa: async () => cajaAdmin,
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: [{ payment_id: "pago-nuevo", caja_movimiento_id: "mov-nuevo" }], error: null };
    },
    from: (tabla: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
          const filas = Array.isArray(row) ? row : [row];
          inserts[tabla] = [...(inserts[tabla] ?? []), ...filas];
          return chain;
        },
        update: () => chain,
        single: async () => ({
          data: { id: `${tabla}-nuevo` },
          error: null,
        }),
        maybeSingle: async () =>
          tabla === "suppliers"
            ? { data: { id: SUPPLIER, name: "Verdulería del Sur" }, error: null }
            : { data: null, error: null },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const { registrarPagoProveedor } = await import("./cuenta-corriente-actions");

beforeEach(() => {
  role = "encargado";
  cajaAdmin = { id: CAJA_ADMIN, name: "Caja Mayor", is_active: true };
  inserts = {};
  rpcCalls = [];
});

/** El pago que la action mandó a la base, sea por RPC o por insert. */
const pagoEscrito = () => rpcCalls.find((c) => c.fn === "registrar_pago_proveedor_tx")?.args;

const pagar = (over: Record<string, unknown> = {}) =>
  registrarPagoProveedor("demo", {
    supplier_id: SUPPLIER,
    amount_cents: 482_100_00,
    method: "cash",
    invoice_ids: [],
    ...over,
  });

describe("registrarPagoProveedor · de qué caja sale (spec 160)", () => {
  it("el egreso en efectivo va a la caja ADMINISTRATIVA", async () => {
    const r = await pagar();
    expect(r.ok).toBe(true);

    const args = pagoEscrito();
    expect(args?.p_caja_id).toBe(CAJA_ADMIN);
    expect(args?.p_amount_cents).toBe(482_100_00);
    // El `kind: "sangria"` que el arqueo filtra (158 · D5) vive ahora dentro de
    // la RPC, y la migración 0069 lo deja escrito ahí. Lo que esta acción decide
    // —y lo que este test cuida— es la CAJA.
    expect(args?.p_caja_reason).toMatch(/Pago a proveedor/);
  });

  it("el pago guarda la caja que resolvió el server", async () => {
    await pagar();
    expect(pagoEscrito()?.p_caja_id).toBe(CAJA_ADMIN);
  });

  it("mandar una caja de turno NO la usa: el input ya no la lleva", async () => {
    // Éste es el invariante que la spec vino a fijar. Si alguien reintroduce
    // `caja_id` en el input, este test lo caza.
    await pagar({ caja_id: CAJA_TURNO });

    expect(pagoEscrito()?.p_caja_id).toBe(CAJA_ADMIN);
    expect(JSON.stringify(rpcCalls)).not.toContain(CAJA_TURNO);
  });

  it("sin caja administrativa no se cobra a ciegas: falla y no escribe nada", async () => {
    cajaAdmin = null;
    const r = await pagar();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Caja Mayor/i);
    expect(rpcCalls).toEqual([]);
  });

  it("con la caja administrativa inactiva tampoco", async () => {
    cajaAdmin = { id: CAJA_ADMIN, name: "Caja Mayor", is_active: false };
    const r = await pagar();

    expect(r.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it("la transferencia no toca ninguna caja", async () => {
    const r = await pagar({ method: "transfer" });

    expect(r.ok).toBe(true);
    // Sin caja no hay sangría: la RPC sólo inserta el movimiento si le llega
    // `p_caja_id`, y el CHECK `supplier_payments_caja_coherente` lo respalda.
    expect(pagoEscrito()?.p_caja_id).toBeNull();
  });

  it("un mozo no puede pagarle a un proveedor", async () => {
    role = "mozo";
    const r = await pagar();

    expect(r.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });
});
