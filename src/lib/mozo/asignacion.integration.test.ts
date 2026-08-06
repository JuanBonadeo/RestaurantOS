// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-asign-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Quien actúa como caller en cada test cambia: usamos una variable mutable
// que el mock lee, y la flipemoamos antes de cada bloque.
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

const { assignMozoToTable, clearMozoAssignments, transferTable } = await import(
  "./actions"
);
const { getMyTables } = await import("./queries");

describe.skipIf(!dbAvailable)("asignación y transferencia (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let otherBusinessId: string;
  let otherTableId: string;
  let tableActiva: string;
  let tableLibre: string;

  let encargadoId = "";
  let mozoAId = "";
  let mozoBId = "";
  let mozoCId = ""; // mozo no involucrado

  const seedUser = async (label: string, role: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = created!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return { id, role, email };
  };

  beforeAll(async () => {
    const enc = await seedUser("Encargado", "encargado");
    const ma = await seedUser("MozoA", "mozo");
    const mb = await seedUser("MozoB", "mozo");
    const mc = await seedUser("MozoC", "mozo");
    encargadoId = enc.id;
    mozoAId = ma.id;
    mozoBId = mb.id;
    mozoCId = mc.id;

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Asign Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    const { data: other } = await supabase
      .from("businesses")
      .insert({
        slug: `${TEST_TAG}-other`,
        name: "Otro Asign",
        is_active: true,
      })
      .select("id")
      .single();
    otherBusinessId = other!.id;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
      { business_id: businessId, user_id: mozoAId, role: "mozo", full_name: "MozoA" },
      { business_id: businessId, user_id: mozoBId, role: "mozo", full_name: "MozoB" },
      { business_id: businessId, user_id: mozoCId, role: "mozo", full_name: "MozoC" },
    ]);

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "Salón" })
      .select("id")
      .single();
    const { data: t1 } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "1",
        seats: 4,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        operational_status: "ocupada",
        opened_at: new Date().toISOString(),
        mozo_id: mozoAId,
      })
      .select("id")
      .single();
    tableActiva = t1!.id;
    const { data: t2 } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "2",
        seats: 2,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      })
      .select("id")
      .single();
    tableLibre = t2!.id;

    const { data: otherFp } = await supabase
      .from("floor_plans")
      .insert({ business_id: otherBusinessId, name: "Salón B" })
      .select("id")
      .single();
    const { data: otherTable } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: otherFp!.id,
        label: "Z",
        seats: 2,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      })
      .select("id")
      .single();
    otherTableId = otherTable!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase
        .from("businesses")
        .delete()
        .in("id", [businessId, otherBusinessId].filter(Boolean));
    }
    for (const id of [encargadoId, mozoAId, mozoBId, mozoCId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("encargado asigna mozo → query getMyTables refleja", async () => {
    CURRENT_USER_ID = encargadoId;
    const result = await assignMozoToTable(tableLibre, mozoBId, businessSlug);
    expect(result.ok).toBe(true);
    const tablesB = await getMyTables(mozoBId, businessId);
    expect(tablesB.find((t) => t.id === tableLibre)).toBeUndefined(); // libre, no aparece
    // Cambiamos la mesa a ocupada para que la query la traiga.
    await supabase
      .from("tables")
      .update({ operational_status: "ocupada", opened_at: new Date().toISOString() })
      .eq("id", tableLibre);
    const tablesB2 = await getMyTables(mozoBId, businessId);
    expect(tablesB2.find((t) => t.id === tableLibre)).toBeTruthy();
  });

  it("mozo no puede asignar a otros (no-encargado)", async () => {
    CURRENT_USER_ID = mozoCId;
    const result = await assignMozoToTable(tableLibre, mozoCId, businessSlug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/encargado|admin/i);
    }
  });

  it("transferencia desde origen (mozoA) → audit log + notif al encargado", async () => {
    CURRENT_USER_ID = mozoAId;
    const result = await transferTable(
      tableActiva,
      mozoBId,
      businessSlug,
      "salgo a fumar",
    );
    expect(result.ok).toBe(true);

    const { data: tableRow } = await supabase
      .from("tables")
      .select("mozo_id")
      .eq("id", tableActiva)
      .single();
    expect(tableRow!.mozo_id).toBe(mozoBId);

    const { data: audit } = await supabase
      .from("tables_audit_log")
      .select("kind, from_value, to_value, reason")
      .eq("table_id", tableActiva)
      .eq("kind", "transfer")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(audit).toHaveLength(1);
    expect(audit![0].from_value).toBe(mozoAId);
    expect(audit![0].to_value).toBe(mozoBId);
    expect(audit![0].reason).toBe("salgo a fumar");

    // La transferencia genera la notif al encargado (broadcast por rol) y otra
    // al mozo destino (por user_id). Buscamos puntualmente la del encargado —
    // no asumimos cuál quedó con created_at más reciente entre las dos.
    const { data: notifs } = await supabase
      .from("notifications")
      .select("type, target_role, payload")
      .eq("business_id", businessId)
      .eq("type", "mesa.transferred")
      .eq("target_role", "encargado")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(notifs).toHaveLength(1);
    expect(notifs![0].target_role).toBe("encargado");
    const payload = notifs![0].payload as { tableLabel?: string };
    expect(payload.tableLabel).toBe("1");
  });

  it("mozo no-origen no puede transferir", async () => {
    CURRENT_USER_ID = mozoCId; // no es origen ni destino
    const result = await transferTable(tableActiva, mozoAId, businessSlug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no podés/i);
    }
  });

  it("encargado puede transferir aunque no sea origen", async () => {
    CURRENT_USER_ID = encargadoId;
    const result = await transferTable(tableActiva, mozoCId, businessSlug);
    expect(result.ok).toBe(true);
    const { data: tableRow } = await supabase
      .from("tables")
      .select("mozo_id")
      .eq("id", tableActiva)
      .single();
    expect(tableRow!.mozo_id).toBe(mozoCId);
  });

  it("cross-tenant en assignMozoToTable → error", async () => {
    CURRENT_USER_ID = encargadoId;
    const result = await assignMozoToTable(otherTableId, mozoAId, businessSlug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no encontrada/i);
    }
  });

  it("cross-tenant en transferTable → error", async () => {
    CURRENT_USER_ID = encargadoId;
    const result = await transferTable(otherTableId, mozoAId, businessSlug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no encontrada/i);
    }
  });

  it("asignar mismo mozo (no-op) no falla y no deja audit", async () => {
    CURRENT_USER_ID = encargadoId;
    // Asegurar estado: tableActiva está con mozoCId después del test anterior.
    const { data: before } = await supabase
      .from("tables_audit_log")
      .select("id")
      .eq("table_id", tableActiva)
      .eq("kind", "assignment");
    const beforeCount = before?.length ?? 0;

    const result = await assignMozoToTable(tableActiva, mozoCId, businessSlug);
    expect(result.ok).toBe(true);

    const { data: after } = await supabase
      .from("tables_audit_log")
      .select("id")
      .eq("table_id", tableActiva)
      .eq("kind", "assignment");
    expect(after?.length ?? 0).toBe(beforeCount);
  });

  it("mozo no puede limpiar la distribución", async () => {
    CURRENT_USER_ID = mozoCId;
    const result = await clearMozoAssignments(businessSlug);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/encargado|admin/i);
    }
  });

  it("encargado limpia la distribución → todas las mesas libres, audit por mesa, otro negocio intacto", async () => {
    CURRENT_USER_ID = encargadoId;
    // Estado de partida: las dos mesas del negocio con mozo, y una mesa del
    // otro negocio también asignada (la limpieza no puede tocarla).
    await supabase
      .from("tables")
      .update({ mozo_id: mozoAId })
      .in("id", [tableActiva, tableLibre]);
    await supabase
      .from("tables")
      .update({ mozo_id: mozoAId })
      .eq("id", otherTableId);

    const result = await clearMozoAssignments(businessSlug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cleared).toBe(2);

    const { data: rows } = await supabase
      .from("tables")
      .select("id, mozo_id")
      .in("id", [tableActiva, tableLibre]);
    expect(rows!.every((r) => r.mozo_id === null)).toBe(true);

    const { data: otherRow } = await supabase
      .from("tables")
      .select("mozo_id")
      .eq("id", otherTableId)
      .single();
    expect(otherRow!.mozo_id).toBe(mozoAId);

    const { data: audit } = await supabase
      .from("tables_audit_log")
      .select("table_id, kind, from_value, to_value, reason")
      .eq("business_id", businessId)
      .eq("reason", "Limpiar distribución");
    expect(audit).toHaveLength(2);
    expect(audit!.every((a) => a.kind === "assignment")).toBe(true);
    expect(audit!.every((a) => a.to_value === null)).toBe(true);
    expect(audit!.every((a) => a.from_value === mozoAId)).toBe(true);

    // Idempotente: sin nada asignado, no rompe ni suma audit.
    const again = await clearMozoAssignments(businessSlug);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.cleared).toBe(0);
  });
});
