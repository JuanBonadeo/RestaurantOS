// @vitest-environment node
//
// Spec 093 — el control de pedido tiene que **entrar en la base**.
//
// Este archivo existe por una razón concreta: el test unitario de al lado usa
// un fake que devuelve `{ error: null }` sin tocar Postgres, así que validaba la
// forma de la llamada y nunca la sentencia. Cuando la migración 0034 reemplazó
// `control_tickets` (único **total** sobre `order_id`, 0028:54) por `print_jobs`
// con un único **parcial** (`where kind = 'control'`, 0034:49-51), el
// `upsert({ onConflict: "order_id" })` pasó a devolver `42P10` en cada llamada
// —Postgres no puede inferir un índice parcial desde `ON CONFLICT`— y el error
// se tragaba dos veces. Resultado: ningún delivery emitió su control durante
// días, en silencio total, con la suite en verde.
//
// La única defensa contra eso es ejercitar el índice de verdad.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { emitControlTicket } from "./control-ticket-emit";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-control-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)(
  "emitControlTicket · contra Postgres real (spec 093)",
  () => {
    const supabase = createClient(supabaseUrl!, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let businessId: string;

    const seedOrder = async (
      deliveryType: "delivery" | "pickup" | "dine_in",
    ): Promise<string> => {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_number: 0, // 0 → lo asigna el trigger
          business_id: businessId,
          customer_name: "Control test",
          customer_phone: "-",
          delivery_type: deliveryType,
          lifecycle_status: "open",
          subtotal_cents: 1000,
          delivery_fee_cents: 0,
          total_cents: 1000,
          payment_method: "cash",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data!.id as string;
    };

    beforeAll(async () => {
      const { data, error } = await supabase
        .from("businesses")
        .insert({ slug: TEST_TAG, name: "Control Test", is_active: true })
        .select("id")
        .single();
      if (error) throw error;
      businessId = data!.id as string;
    }, 30_000);

    afterAll(async () => {
      if (businessId) {
        await supabase.from("businesses").delete().eq("id", businessId);
      }
    }, 30_000);

    it("emite el control de un delivery — la sentencia entra en la base", async () => {
      const orderId = await seedOrder("delivery");

      const res = await emitControlTicket(supabase, orderId, businessId);
      expect(res).toEqual({ emitted: true, failed: false });

      const { data: jobs } = await supabase
        .from("print_jobs")
        .select("id, kind, status")
        .eq("order_id", orderId);
      expect(jobs).toHaveLength(1);
      expect(jobs![0].kind).toBe("control");
      expect(jobs![0].status).toBe("pendiente");
    });

    it("marchar dos veces deja UN solo control, sin reportar fallo", async () => {
      const orderId = await seedOrder("pickup");

      const first = await emitControlTicket(supabase, orderId, businessId);
      const second = await emitControlTicket(supabase, orderId, businessId);

      expect(first).toEqual({ emitted: true, failed: false });
      // El segundo no emite, pero **no es un fallo**: el desenlace es correcto.
      expect(second).toEqual({ emitted: false, failed: false });

      const { count } = await supabase
        .from("print_jobs")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId)
        .eq("kind", "control");
      expect(count).toBe(1);
    });

    it("el índice de control NO bloquea varias cuentas de la misma orden", async () => {
      // La contracara del fix: `kind='cuenta'` se repite a propósito (0034:47-48),
      // así que el índice tiene que seguir siendo parcial. Si alguien lo
      // "arregla" con un único total sobre (order_id) o (order_id, kind), este
      // test se pone rojo — que es exactamente lo que queremos.
      const orderId = await seedOrder("delivery");
      await emitControlTicket(supabase, orderId, businessId);

      const { error: firstCuenta } = await supabase
        .from("print_jobs")
        .insert({ order_id: orderId, business_id: businessId, kind: "cuenta" });
      const { error: secondCuenta } = await supabase
        .from("print_jobs")
        .insert({ order_id: orderId, business_id: businessId, kind: "cuenta" });

      expect(firstCuenta).toBeNull();
      expect(secondCuenta).toBeNull();

      const { count } = await supabase
        .from("print_jobs")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId);
      expect(count).toBe(3); // 1 control + 2 cuentas
    });

    it("un pedido de mesa no genera control", async () => {
      const orderId = await seedOrder("dine_in");

      const res = await emitControlTicket(supabase, orderId, businessId);
      expect(res).toEqual({ emitted: false, failed: false });

      const { count } = await supabase
        .from("print_jobs")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId);
      expect(count).toBe(0);
    });
  },
);
