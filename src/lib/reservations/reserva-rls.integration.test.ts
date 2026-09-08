// @vitest-environment node
//
// P08 · issue #261 — la reserva la decide el local, no el que la pidió.
//
// `reservations_update` era
//   USING/WITH CHECK (is_business_staff(business_id) OR user_id = auth.uid())
// así que el dueño de la reserva podía escribir **cualquier columna** de su
// propia fila. No pide hackear nada: el navegador del cliente ya tiene su
// access token (la página monta un cliente de Supabase para el realtime) y la
// anon key es pública.
//
// Se prueba con el **JWT real del cliente**, no con service_role: el service key
// pasa por encima de RLS por definición, así que un test que lo use da verde
// con la policy rota.
//
// Fix: migración 0079.
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

const TEST_TAG = `test-rls-res-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASS = "test-pass-12345";

describe.skipIf(!dbAvailable)("reservas · quién puede escribir la reserva", () => {
  const admin = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let clienteId: string;
  let reservaId: string;

  const comoCliente = async () => {
    const c = createClient(supabaseUrl!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await c.auth.signInWithPassword({
      email: `${TEST_TAG}-cliente@example.test`,
      password: PASS,
    });
    if (error) throw new Error(`login cliente: ${error.message}`);
    return c;
  };

  beforeAll(async () => {
    const email = `${TEST_TAG}-cliente@example.test`;
    const { data: u } = await admin.auth.admin.createUser({
      email, password: PASS, email_confirm: true,
    });
    clienteId = u!.user!.id;
    await admin.from("users").upsert({ id: clienteId, email, full_name: "Cliente" });

    const { data: biz } = await admin
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Reserva RLS", is_active: true })
      .select("id").single();
    businessId = biz!.id;

    const start = new Date(Date.now() + 86_400_000);
    const { data: r, error } = await admin
      .from("reservations")
      .insert({
        business_id: businessId,
        user_id: clienteId,
        customer_name: "Cliente",
        customer_phone: "111",
        party_size: 2,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
        status: "pending",
        source: "web",
      })
      .select("id").single();
    if (error) throw new Error(`seed reserva: ${error.message}`);
    reservaId = r!.id;
  });

  afterAll(async () => {
    if (businessId) await admin.from("businesses").delete().eq("id", businessId);
    if (clienteId) {
      await admin.from("users").delete().eq("id", clienteId);
      await admin.auth.admin.deleteUser(clienteId);
    }
  });

  it("el cliente NO se confirma su propia reserva", async () => {
    const c = await comoCliente();
    const { data } = await c
      .from("reservations")
      .update({ status: "confirmed" })
      .eq("id", reservaId)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    const { data: fila } = await admin
      .from("reservations").select("status").eq("id", reservaId).single();
    expect(fila!.status).toBe("pending");
  });

  it("tampoco se sienta solo ni se cambia comensales y horario", async () => {
    const c = await comoCliente();
    await c.from("reservations").update({ status: "seated" }).eq("id", reservaId);
    await c.from("reservations").update({ party_size: 40 }).eq("id", reservaId);

    const { data: fila } = await admin
      .from("reservations")
      .select("status, party_size")
      .eq("id", reservaId)
      .single();
    expect(fila!.status).toBe("pending");
    expect(fila!.party_size).toBe(2);
  });

  it("pero sigue viendo la suya: la pantalla de seguimiento la necesita", async () => {
    const c = await comoCliente();
    const { data } = await c
      .from("reservations").select("id, status").eq("id", reservaId);
    expect(data ?? []).toHaveLength(1);
  });
});
