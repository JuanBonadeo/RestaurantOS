// @vitest-environment node
//
// P11 — la rendición la toma el encargado, no el que la debe.
//
// `registrarRendicionMozo` chequea `canRendirMozo` (admin | encargado) en la
// server action, pero la policy de la base era
// `WITH CHECK (is_platform_admin() OR is_business_member(business_id))`:
// cualquier miembro del negocio, incluido el mozo, podía insertar su propia
// rendición. Con su JWT —el que el navegador ya tiene— y la anon key pública,
// un mozo se firmaba la entrega de los $50.000 que tenía encima y desaparecía
// de «deben rendir». La fila quedaba con `registered_by` = él mismo, pero una
// rendición más no llama la atención de nadie.
//
// Estos tests entran con el **rol real** (JWT del mozo y del encargado), nunca
// con `service_role`: el service key pasa por encima de RLS por definición, así
// que un test que lo use da verde con la policy rota.
//
// Hallazgo: issue #264 · fix: migración 0078
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey && anonKey);

const TEST_TAG = `test-rls-rend-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASS = "test-pass-12345";

describe.skipIf(!dbAvailable)("caja · quién puede firmar una rendición", () => {
  const admin = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let mozoId: string;
  let encargadoId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data } = await admin.auth.admin.createUser({
      email,
      password: PASS,
      email_confirm: true,
    });
    const id = data!.user!.id;
    await admin.from("users").upsert({ id, email, full_name: label });
    return { id, email };
  };

  /** Un cliente con la sesión REAL de ese usuario — como el navegador. */
  const comoUsuario = async (email: string) => {
    const c = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await c.auth.signInWithPassword({ email, password: PASS });
    if (error) throw new Error(`login ${email}: ${error.message}`);
    return c;
  };

  let mozoEmail: string;
  let encargadoEmail: string;

  beforeAll(async () => {
    const m = await seedUser("Mozo");
    const e = await seedUser("Encargado");
    mozoId = m.id;
    mozoEmail = m.email;
    encargadoId = e.id;
    encargadoEmail = e.email;

    const { data: biz } = await admin
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "RLS Rendición", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;

    await admin.from("business_users").insert([
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
    ]);
  });

  afterAll(async () => {
    if (businessId) await admin.from("businesses").delete().eq("id", businessId);
    for (const id of [mozoId, encargadoId].filter(Boolean)) {
      await admin.from("users").delete().eq("id", id);
      await admin.auth.admin.deleteUser(id);
    }
  });

  const fila = (registeredBy: string) => ({
    business_id: businessId,
    mozo_id: mozoId,
    registered_by: registeredBy,
    expected_cash_cents: 50_000,
    delivered_cash_cents: 50_000,
    difference_cents: 0,
    estado: "rendida",
  });

  it("el mozo NO puede firmarse su propia rendición", async () => {
    const comoMozo = await comoUsuario(mozoEmail);
    const { error } = await comoMozo
      .from("mozo_rendiciones")
      .insert(fila(mozoId));

    // La base tiene que rechazarlo **por RLS**, no por otra cosa: un nombre de
    // columna mal escrito también devuelve error, y ese verde no probaría nada.
    expect(error?.code, error?.message).toBe("42501");

    const { count } = await admin
      .from("mozo_rendiciones")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId);
    expect(count).toBe(0);
  });

  it("el encargado sí puede tomarle la rendición", async () => {
    const comoEncargado = await comoUsuario(encargadoEmail);
    const { error } = await comoEncargado
      .from("mozo_rendiciones")
      .insert(fila(encargadoId));

    // La contracara: apretar la policy no puede romper el camino normal.
    expect(error).toBeNull();
  });
});
