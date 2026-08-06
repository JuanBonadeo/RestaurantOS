// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-caja-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
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

const {
  hacerCorte,
  registrarSangria,
  registrarIngreso,
  distribuirSalon,
} = await import("./actions");
const { getCajaLiveStats } = await import("./queries");

describe.skipIf(!dbAvailable)("caja continua (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let cajaA: string;
  let encargadoId: string;
  let mozoAId: string;
  let adminId: string;
  let table1: string;
  let table2: string;

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

  beforeAll(async () => {
    encargadoId = await seedUser("Encargado");
    mozoAId = await seedUser("MozoA");
    adminId = await seedUser("Admin");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Caja Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
      { business_id: businessId, user_id: mozoAId, role: "mozo", full_name: "MozoA" },
      { business_id: businessId, user_id: adminId, role: "admin", full_name: "Admin" },
    ]);

    const { data: cA } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    cajaA = cA!.id;

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "S1" })
      .select("id")
      .single();
    const { data: t1 } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "1",
        seats: 2,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
      })
      .select("id")
      .single();
    table1 = t1!.id;
    const { data: t2 } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "2",
        seats: 4,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
      })
      .select("id")
      .single();
    table2 = t2!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
    for (const id of [encargadoId, mozoAId, adminId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("caja disponible inmediatamente sin abrir nada", async () => {
    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats).not.toBeNull();
    expect(stats!.expected_cash_cents).toBe(0);
    expect(stats!.cobros_count).toBe(0);
  });

  it("registrar sangría contra caja → OK", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await registrarSangria(cajaA, 5_000, "depósito en banco", businessSlug);
    expect(r.ok).toBe(true);
  });

  it("sangría sin motivo → falla", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await registrarSangria(cajaA, 5_000, "", businessSlug);
    expect(r.ok).toBe(false);
  });

  it("registrar ingreso contra caja → OK", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await registrarIngreso(cajaA, 20_000, "fondo extra", businessSlug);
    expect(r.ok).toBe(true);
  });

  it("expected_cash refleja movimientos (0 + ingreso 20k - sangría 5k)", async () => {
    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats).not.toBeNull();
    expect(stats!.expected_cash_cents).toBe(0 + 20_000 - 5_000);
  });

  it("hacer corte con diff $0 → OK sin notes", async () => {
    CURRENT_USER_ID = encargadoId;
    const expected = 15_000; // 0 + 20k - 5k
    const r = await hacerCorte(cajaA, expected, null, null, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.corte.difference_cents).toBe(0);
  });

  it("post-corte: nuevo período arranca con closing_cash del corte anterior", async () => {
    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats).not.toBeNull();
    // Nuevo período: last_closing = 15_000, sin movimientos nuevos.
    expect(stats!.expected_cash_cents).toBe(15_000);
  });

  it("hacer corte con diff sin notes → falla", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await hacerCorte(cajaA, 20_000, null, null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/diferencia/i);
  });

  it("hacer corte con diff + notes (encargado) → OK", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await hacerCorte(cajaA, 20_000, "sobrante por vuelto", null, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.corte.difference_cents).toBe(20_000 - 15_000);
  });

  it("hacer corte con diff $10k como encargado → falla por permiso", async () => {
    CURRENT_USER_ID = encargadoId;
    // Nuevo período: last_closing = 20_000, expected = 20_000.
    // Closing = 20_000 + 1_000_000 → diff = 1_000_000 cents = $10.000
    const r = await hacerCorte(cajaA, 20_000 + 1_000_000, "sobrante grande", null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/excede/i);
  });

  it("hacer corte con diff $10k como admin → OK", async () => {
    CURRENT_USER_ID = adminId;
    const r = await hacerCorte(cajaA, 20_000 + 1_000_000, "sobrante grande", null, businessSlug);
    expect(r.ok).toBe(true);
  });

  it("mozo no puede hacer corte → falla permiso", async () => {
    CURRENT_USER_ID = mozoAId;
    const r = await hacerCorte(cajaA, 0, null, null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/encargado|admin/i);
  });

  it("distribuirSalon funciona independiente de caja", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await distribuirSalon({
      assignments: [
        { tableId: table1, mozoId: mozoAId },
        { tableId: table2, mozoId: mozoAId },
      ],
      slug: businessSlug,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.count).toBe(2);
  });

  // El corte de la caja principal cierra el día → libera la distribución de
  // mozos. El de una caja secundaria (el bar) puede pasar en plena cena, así
  // que no la toca.
  it("corte de caja NO principal deja la distribución intacta", async () => {
    CURRENT_USER_ID = encargadoId;
    // table1/table2 quedaron con mozoA del test anterior.
    const stats = await getCajaLiveStats(cajaA, businessId);
    const r = await hacerCorte(
      cajaA,
      stats!.expected_cash_cents,
      null,
      null,
      businessSlug,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.mesasLiberadas).toBe(0);

    const { data: rows } = await supabase
      .from("tables")
      .select("mozo_id")
      .in("id", [table1, table2]);
    expect(rows!.every((t) => t.mozo_id === mozoAId)).toBe(true);
  });

  it("corte de la caja principal libera la distribución de mozos", async () => {
    CURRENT_USER_ID = encargadoId;
    await supabase.from("cajas").update({ is_default: true }).eq("id", cajaA);

    const stats = await getCajaLiveStats(cajaA, businessId);
    const r = await hacerCorte(
      cajaA,
      stats!.expected_cash_cents,
      null,
      null,
      businessSlug,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.mesasLiberadas).toBe(2);

    const { data: rows } = await supabase
      .from("tables")
      .select("mozo_id")
      .in("id", [table1, table2]);
    expect(rows!.every((t) => t.mozo_id === null)).toBe(true);

    const { data: audit } = await supabase
      .from("tables_audit_log")
      .select("kind, to_value, reason")
      .eq("business_id", businessId)
      .eq("reason", "Corte de caja");
    expect(audit).toHaveLength(2);
    expect(audit!.every((a) => a.kind === "assignment")).toBe(true);
    expect(audit!.every((a) => a.to_value === null)).toBe(true);
  });
});
