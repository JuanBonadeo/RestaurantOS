// @vitest-environment node
//
// P11 — la guarda de rendiciones tiene que vivir EN LA RPC, no sólo en TS.
//
// La 0056 (spec 139 · D1/D5) la puso ahí a propósito, y dejó escrito por qué:
// «vive acá y no sólo en la server action por la misma carrera que las cuentas
// abiertas: entre que el modal lista y el encargado aprieta, un mozo puede
// cobrar la 14». Entre el chequeo en TS y la llamada a la RPC hay varios
// `await`.
//
// La 0063 hizo `create or replace` de la función entera para agregar el ticket
// en papel y no reincorporó el bloque. `OPEN_TABLE_ORDERS`, dos líneas más
// arriba, sí sobrevivió — o sea que no fue un cambio de criterio, se perdió al
// reescribir. Estuvo así hasta la 0077, y nadie se enteró: **no había un solo
// test que ejerciera la RPC directamente**, y por la UI la rama de error nunca
// llegaba a correr porque el chequeo en TS cortaba antes.
//
// Por eso este test llama `cerrar_caja_tx` **salteando la server action**: es
// la única forma de probar la capa que se cayó. Un test que pase por
// `cerrarCaja()` habría seguido en verde los tres meses que el agujero estuvo
// abierto.
//
// Hallazgo: issue #264 · fix: migración 0077
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-guarda-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("caja · guarda de rendiciones en la RPC", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let mozoId: string;
  let encargadoId: string;
  let cajaId: string;

  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = data!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  beforeAll(async () => {
    mozoId = await seedUser("Mozo");
    encargadoId = await seedUser("Encargado");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Guarda Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: mozoId, role: "mozo", full_name: "Mozo" },
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
    ]);

    const { data: caja } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Principal", is_default: true })
      .select("id")
      .single();
    cajaId = caja!.id;

    // El mozo cobró y no rindió: $50.000 en su bolsillo, atribuidos a él.
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        customer_name: "Mesa",
        customer_phone: "0",
        delivery_type: "dine_in",
        subtotal_cents: 50_000,
        total_cents: 50_000,
        lifecycle_status: "closed",
      })
      .select("id")
      .single();
    await supabase.from("payments").insert({
      order_id: order!.id,
      business_id: businessId,
      caja_id: cajaId,
      operated_by: mozoId,
      attributed_mozo_id: mozoId,
      method: "cash",
      amount_cents: 50_000,
      tip_cents: 0,
      payment_status: "paid",
    });
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
    for (const id of [mozoId, encargadoId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  const cerrar = (barrerSalon: boolean) =>
    supabase.rpc("cerrar_caja_tx", {
      p_caja_id: cajaId,
      p_business_id: businessId,
      p_encargado_id: encargadoId,
      p_expected_cash_cents: 50_000,
      p_closing_cash_cents: 50_000,
      p_closing_notes: null,
      p_denomination_count: null,
      p_retirar: true,
      p_barrer_salon: barrerSalon,
    });

  it("la RPC rechaza el cierre con un mozo sin rendir, sin pasar por la action", async () => {
    const { error } = await cerrar(true);

    // El mensaje es el contrato: la server action lo mapea a castellano.
    expect(error?.message ?? "").toMatch(/UNRENDERED_MOZOS/);
  });

  it("una caja que no barre el salón cierra igual: la asimetría del bar se conserva", async () => {
    // El bar puede tener que cortar en plena cena, así que no pide rendiciones.
    // Se prueba junto a lo de arriba porque son la misma condición leída al
    // revés: si alguien "arregla" la guarda quitándole el `if p_barrer_salon`,
    // este test lo agarra.
    const { error } = await cerrar(false);
    expect(error).toBeNull();
  });
});
