// @vitest-environment node
//
// P01 · E-02 — el descuento por método tiene que saldar la cuenta.
//
// `payment_method_configs.adjustment_percent` admite negativos: es cómo se
// modela «pagar en efectivo sale menos», está ofrecido en la pantalla de
// Ajustes ("Positivo = recargo, negativo = descuento. Ej: -5") y
// `isCashShortPayment` lo contempla explícitamente — con 10% off, pagar $9.000
// de una cuenta de $10.000 **es pagar completo**.
//
// La RPC `registrar_pago_tx` (migración 0007) no hace esa cuenta: decide
// `fully_paid` con `sum(payments.amount_cents) >= orders.total_cents`, y
// `amount_cents` ya viene con el descuento adentro. Resultado: la cuenta nunca
// se salda, queda un saldo fantasma exactamente igual al descuento, y el mozo
// se lo cobra al cliente — que termina pagando el precio de lista.
//
// Caso de uso: wiki/qa/procesos/P01-piden-la-cuenta.md
// Corregido por la migración 0076 (issue #253): las comparaciones de saldado
// pasaron a usar la **base** (`amount_cents − adjustment_cents`) en vez del
// bruto. `payments.amount_cents` sigue siendo el bruto, que es lo que lee el
// arqueo — son dos magnitudes distintas y conviven a propósito.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-desc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: CURRENT_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: CURRENT_USER_ID } },
        error: null,
      }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { registrarPago } = await import("./cobro-actions");

describe.skipIf(!dbAvailable)("billing · descuento por método (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Cuenta de $100,00 con 10% de descuento por efectivo → se cobran $90,00.
  const TOTAL_CENTS = 10_000;
  const DESCUENTO_PCT = -10;
  const AJUSTE_CENTS = -1_000;
  const A_COBRAR_CENTS = TOTAL_CENTS + AJUSTE_CENTS;

  let businessId: string;
  let businessSlug: string;
  let mozoId: string;
  let cajaId: string;
  let floorPlanId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = created!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  const newOrder = async (label: string) => {
    const { data: t } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: floorPlanId,
        label,
        seats: 2,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
        operational_status: "pidio_cuenta",
        opened_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: `M${label}`,
        customer_phone: "0",
        delivery_type: "dine_in",
        table_id: t!.id,
        subtotal_cents: TOTAL_CENTS,
        total_cents: TOTAL_CENTS,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    await supabase.from("order_items").insert({
      order_id: order!.id,
      product_name: "Item",
      unit_price_cents: TOTAL_CENTS,
      quantity: 1,
      subtotal_cents: TOTAL_CENTS,
      loaded_by: mozoId,
    });
    return { tableId: t!.id, orderId: order!.id };
  };

  beforeAll(async () => {
    mozoId = await seedUser("Mozo");
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Descuento Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert({
      business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo",
    });
    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "S" })
      .select("id")
      .single();
    floorPlanId = fp!.id;

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Caja1" })
      .select("id")
      .single();
    cajaId = caja!.id;

    // El negocio da 10% de descuento pagando en efectivo.
    await supabase.from("payment_method_configs").insert({
      business_id: businessId,
      method: "cash",
      adjustment_percent: DESCUENTO_PCT,
    });
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    if (mozoId) {
      await supabase.from("users").delete().eq("id", mozoId);
      await supabase.auth.admin.deleteUser(mozoId);
    }
  });

  it(
    "pagar los $90 de una cuenta de $100 con 10% off deja la cuenta saldada",
    { timeout: 30_000 },
    async () => {
      const { orderId } = await newOrder("D1");
      CURRENT_USER_ID = mozoId;

      const r = await registrarPago({
        orderId,
        splitId: null,
        method: "cash",
        amount_cents: A_COBRAR_CENTS,
        tip_cents: 0,
        caja_id: cajaId,
        adjustment_percent: DESCUENTO_PCT,
        adjustment_cents: AJUSTE_CENTS,
        slug: businessSlug,
      });

      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // El cliente no debe nada más: pagó el precio con descuento, completo.
      expect(r.data.orderClosed).toBe(true);

      const { data: ord } = await supabase
        .from("orders")
        .select("lifecycle_status, total_paid_cents")
        .eq("id", orderId)
        .single();
      expect(ord!.lifecycle_status).toBe("closed");
    },
  );

  it(
    "no queda saldo pendiente igual al descuento",
    { timeout: 30_000 },
    async () => {
      const { orderId } = await newOrder("D2");
      CURRENT_USER_ID = mozoId;

      await registrarPago({
        orderId,
        splitId: null,
        method: "cash",
        amount_cents: A_COBRAR_CENTS,
        tip_cents: 0,
        caja_id: cajaId,
        adjustment_percent: DESCUENTO_PCT,
        adjustment_cents: AJUSTE_CENTS,
        slug: businessSlug,
      });

      const { data: ord } = await supabase
        .from("orders")
        .select("total_cents, total_paid_cents")
        .eq("id", orderId)
        .single();

      // Lo que la pantalla le va a pedir al cliente como «Falta cobrar».
      const faltaCobrar = ord!.total_cents - ord!.total_paid_cents;
      expect(faltaCobrar).toBe(0);
    },
  );

  it(
    "una sub-cuenta pagada con descuento queda saldada",
    { timeout: 30_000 },
    async () => {
      // Mismo bug, otro path: la RPC compara contra `expected_amount_cents`
      // (0007:109 y :157) sin restarle el ajuste. Dividir la cuenta no salva.
      const { orderId } = await newOrder("D4");
      const mitad = TOTAL_CENTS / 2;
      const { data: splits } = await supabase
        .from("order_splits")
        .insert([
          { order_id: orderId, business_id: businessId, split_index: 0,
            expected_amount_cents: mitad, status: "pending", split_mode: "por_personas" },
          { order_id: orderId, business_id: businessId, split_index: 1,
            expected_amount_cents: mitad, status: "pending", split_mode: "por_personas" },
        ])
        .select("id, split_index");
      const primero = splits!.find((s) => s.split_index === 0)!;

      CURRENT_USER_ID = mozoId;
      const r = await registrarPago({
        orderId,
        splitId: primero.id,
        method: "cash",
        amount_cents: mitad + AJUSTE_CENTS / 2,
        tip_cents: 0,
        caja_id: cajaId,
        adjustment_percent: DESCUENTO_PCT,
        adjustment_cents: AJUSTE_CENTS / 2,
        slug: businessSlug,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // Ese comensal pagó lo suyo: su sub-cuenta no puede seguir esperando plata.
      expect(r.data.splitDone).toBe(true);
    },
  );

  it(
    "un segundo cobro sobre la cuenta ya saldada se rechaza",
    { timeout: 30_000 },
    async () => {
      const { orderId } = await newOrder("D3");
      CURRENT_USER_ID = mozoId;

      await registrarPago({
        orderId,
        splitId: null,
        method: "cash",
        amount_cents: A_COBRAR_CENTS,
        tip_cents: 0,
        caja_id: cajaId,
        adjustment_percent: DESCUENTO_PCT,
        adjustment_cents: AJUSTE_CENTS,
        slug: businessSlug,
      });

      // El mozo ve la mesa abierta con «Falta cobrar $10» y vuelve a cobrar:
      // el cliente termina pagando los $100 de lista y el descuento se
      // evapora sin que nadie se entere — la caja cierra igual.
      const segundo = await registrarPago({
        orderId,
        splitId: null,
        method: "cash",
        amount_cents: -AJUSTE_CENTS,
        tip_cents: 0,
        caja_id: cajaId,
        slug: businessSlug,
      });

      expect(segundo.ok).toBe(false);

      const { data: pagos } = await supabase
        .from("payments")
        .select("amount_cents")
        .eq("order_id", orderId);
      const cobrado = (pagos ?? []).reduce((a, p) => a + p.amount_cents, 0);
      expect(cobrado).toBe(A_COBRAR_CENTS);
    },
  );
});
