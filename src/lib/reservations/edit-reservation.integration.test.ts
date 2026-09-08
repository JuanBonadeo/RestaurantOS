// @vitest-environment node
//
// Spec 097 — editar una reserva (mesa, comensales, horario) contra Postgres de
// verdad: acá es donde vive el GIST anti-solape y donde el modo del negocio
// cambia cómo se deriva la ventana.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-resvedit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: CURRENT_USER_ID ? { id: CURRENT_USER_ID } : null },
        error: null,
      }),
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { updateReservationDetails } = await import("./booking-actions");

// Todo transcurre el 2027-01-15 local (AR = UTC-3).
const AT = (hhmm: string, nextDay = false) =>
  `2027-01-${nextDay ? "16" : "15"}T${hhmm}:00.000Z`;

describe.skipIf(!dbAvailable)("reservas · editar (spec 097)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let encargadoId = "";
  // Negocio estricto
  let strictId = "";
  let strictSlug = "";
  let strictTableA = "";
  let strictTableB = "";
  // Negocio flexible
  let flexId = "";
  let flexSlug = "";
  let flexPlanId = "";
  let flexTableA = "";

  const mkBusiness = async (suffix: string) => {
    const { data } = await supabase
      .from("businesses")
      .insert({
        slug: `${TEST_TAG}-${suffix}`,
        name: `Resv Edit ${suffix}`,
        is_active: true,
        timezone: "America/Argentina/Buenos_Aires",
      })
      .select("id, slug")
      .single();
    await supabase
      .from("business_users")
      .insert({ business_id: data!.id, user_id: encargadoId, role: "encargado" });
    return data!;
  };

  const mkTable = async (planId: string, label: string, seats: number) => {
    const { data } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: planId,
        label,
        seats,
        shape: "circle",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
      })
      .select("id")
      .single();
    return data!.id as string;
  };

  /** Crea una reserva viva y devuelve su id. */
  const mkReservation = async (row: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from("reservations")
      .insert({
        customer_name: "Cliente Test",
        customer_phone: "+5491100000000",
        status: "confirmed",
        source: "admin",
        ...row,
      })
      .select("id")
      .single();
    if (error) throw new Error(`reserva: ${error.message}`);
    return data!.id as string;
  };

  const readReservation = async (id: string) => {
    const { data } = await supabase
      .from("reservations")
      .select("id, table_id, party_size, starts_at, ends_at, status, service")
      .eq("id", id)
      .single();
    return data!;
  };

  beforeAll(async () => {
    const email = `${TEST_TAG}@example.test`;
    const { data: authUser, error } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    if (error || !authUser?.user) throw new Error(`auth user: ${error?.message}`);
    encargadoId = authUser.user.id;
    await supabase.from("users").upsert({ id: encargadoId, email, full_name: "Encargado" });

    // ── Negocio ESTRICTO: slots de 90 min, dos mesas ──
    const strict = await mkBusiness("estricto");
    strictId = strict.id;
    strictSlug = strict.slug;
    await supabase.from("reservation_settings").insert({
      business_id: strictId,
      mode: "estricto",
      slot_duration_min: 90,
      buffer_min: 15,
    });
    const { data: strictPlan } = await supabase
      .from("floor_plans")
      .insert({ business_id: strictId, name: "Salón" })
      .select("id")
      .single();
    strictTableA = await mkTable(strictPlan!.id, "1", 4);
    strictTableB = await mkTable(strictPlan!.id, "2", 2);

    // ── Negocio FLEXIBLE: servicio Cena 20:00–22:30 todos los días ──
    const flex = await mkBusiness("flexible");
    flexId = flex.id;
    flexSlug = flex.slug;
    await supabase
      .from("reservation_settings")
      .insert({ business_id: flexId, mode: "flexible" });
    const { data: flexPlan } = await supabase
      .from("floor_plans")
      .insert({ business_id: flexId, name: "Salón" })
      .select("id")
      .single();
    flexPlanId = flexPlan!.id;
    flexTableA = await mkTable(flexPlanId, "1", 8);
    await mkTable(flexPlanId, "2", 8);
    await supabase.from("reservation_services").insert({
      business_id: flexId,
      name: "Cena",
      day_of_week: null,
      opens_at: "20:00",
      closes_at: "22:30",
      soft_capacity: null,
    });

    CURRENT_USER_ID = encargadoId;
  });

  afterAll(async () => {
    for (const id of [strictId, flexId].filter(Boolean)) {
      await supabase.from("businesses").delete().eq("id", id);
    }
    if (encargadoId) {
      await supabase.from("users").delete().eq("id", encargadoId);
      await supabase.auth.admin.deleteUser(encargadoId);
    }
  });

  describe("modo estricto", () => {
    it("mueve el horario y recalcula el cierre con la duración de slot", async () => {
      const id = await mkReservation({
        business_id: strictId,
        table_id: strictTableA,
        party_size: 2,
        starts_at: AT("23:00"), // 20:00 local
        ends_at: AT("00:30", true),
      });

      const result = await updateReservationDetails({
        business_slug: strictSlug,
        reservation_id: id,
        table_id: strictTableA,
        party_size: 2,
        time: "21:00",
      });
      expect(result.ok).toBe(true);

      const after = await readReservation(id);
      expect(after.starts_at).toBe("2027-01-16T00:00:00+00:00");
      expect(after.ends_at).toBe("2027-01-16T01:30:00+00:00");
      // Sigue siendo LA MISMA reserva: no se cancela y se recrea.
      expect(after.id).toBe(id);
      expect(after.status).toBe("confirmed");

      await supabase.from("reservations").delete().eq("id", id);
    });

    it("no se pisa a sí misma al mover sin cambiar de mesa", async () => {
      const id = await mkReservation({
        business_id: strictId,
        table_id: strictTableA,
        party_size: 2,
        starts_at: AT("23:00"),
        ends_at: AT("00:30", true),
      });
      // 20:15: se solapa con su propio horario viejo — y aun así entra.
      const result = await updateReservationDetails({
        business_slug: strictSlug,
        reservation_id: id,
        table_id: strictTableA,
        party_size: 2,
        time: "20:15",
      });
      expect(result.ok).toBe(true);
      await supabase.from("reservations").delete().eq("id", id);
    });

    it("rechaza mover a un horario donde la mesa ya está tomada", async () => {
      const id = await mkReservation({
        business_id: strictId,
        table_id: strictTableA,
        party_size: 2,
        starts_at: AT("23:00"), // 20:00 → 21:30
        ends_at: AT("00:30", true),
      });
      const otra = await mkReservation({
        business_id: strictId,
        table_id: strictTableA,
        party_size: 2,
        starts_at: AT("01:00", true), // 22:00 → 23:30
        ends_at: AT("02:30", true),
      });

      const result = await updateReservationDetails({
        business_slug: strictSlug,
        reservation_id: id,
        table_id: strictTableA,
        party_size: 2,
        time: "22:00",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/ya está reservada/i);

      // Y no escribió nada.
      const after = await readReservation(id);
      expect(after.starts_at).toBe("2027-01-15T23:00:00+00:00");

      await supabase.from("reservations").delete().in("id", [id, otra]);
    });

    it("rechaza dejar la reserva sin mesa (en estricto la mesa es obligatoria)", async () => {
      const id = await mkReservation({
        business_id: strictId,
        table_id: strictTableA,
        party_size: 2,
        starts_at: AT("23:00"),
        ends_at: AT("00:30", true),
      });
      const result = await updateReservationDetails({
        business_slug: strictSlug,
        reservation_id: id,
        table_id: null,
        party_size: 2,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/mesa/i);
      await supabase.from("reservations").delete().eq("id", id);
    });

    it("rechaza un party más grande que la mesa", async () => {
      const id = await mkReservation({
        business_id: strictId,
        table_id: strictTableA,
        party_size: 2,
        starts_at: AT("23:00"),
        ends_at: AT("00:30", true),
      });
      const result = await updateReservationDetails({
        business_slug: strictSlug,
        reservation_id: id,
        table_id: strictTableB, // 2 lugares
        party_size: 4,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/lugares/i);
      await supabase.from("reservations").delete().eq("id", id);
    });
  });

  describe("modo flexible", () => {
    /** Reserva genérica (sin mesa) del servicio Cena. */
    const mkGenerica = () =>
      mkReservation({
        business_id: flexId,
        table_id: null,
        floor_plan_id: flexPlanId,
        service: "Cena",
        party_size: 4,
        starts_at: AT("23:00"), // 20:00 local = apertura
        ends_at: AT("01:30", true), // 22:30 local = cierre
      });

    it("edita los comensales de una reserva SIN mesa y la deja sin mesa", async () => {
      const id = await mkGenerica();
      const result = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: null,
        party_size: 6,
      });
      expect(result.ok).toBe(true);

      const after = await readReservation(id);
      expect(after.party_size).toBe(6);
      expect(after.table_id).toBeNull();

      await supabase.from("reservations").delete().eq("id", id);
    });

    it("mueve la hora de llegada y mantiene el cierre del SERVICIO", async () => {
      const id = await mkGenerica();
      const result = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: null,
        party_size: 4,
        time: "21:00",
      });
      expect(result.ok).toBe(true);

      const after = await readReservation(id);
      expect(after.starts_at).toBe("2027-01-16T00:00:00+00:00"); // 21:00 local
      expect(after.ends_at).toBe("2027-01-16T01:30:00+00:00"); // 22:30 = cierre
      expect(after.service).toBe("Cena");

      await supabase.from("reservations").delete().eq("id", id);
    });

    it("rechaza una hora fuera de la ventana del servicio", async () => {
      const id = await mkGenerica();
      const result = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: null,
        party_size: 4,
        time: "23:00", // la cena cierra 22:30
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/fuera de Cena/i);
      await supabase.from("reservations").delete().eq("id", id);
    });

    it("rechaza una mesa ya comprometida en ese servicio", async () => {
      const id = await mkGenerica();
      const ocupante = await mkReservation({
        business_id: flexId,
        table_id: flexTableA,
        floor_plan_id: flexPlanId,
        service: "Cena",
        party_size: 2,
        starts_at: AT("00:00", true), // 21:00 local, mismo servicio
        ends_at: AT("01:30", true),
      });

      const result = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: flexTableA,
        party_size: 4,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/reservada en ese servicio/i);

      await supabase.from("reservations").delete().in("id", [id, ocupante]);
    });

    it("edita igual una reserva vieja SIN servicio (fila pre-059)", async () => {
      // En golf-jcr existen filas así (canales que todavía no son mode-aware).
      // Antes de la 097 se editaban; no pueden dejar de poder editarse.
      const id = await mkReservation({
        business_id: flexId,
        table_id: flexTableA,
        floor_plan_id: flexPlanId,
        service: null,
        party_size: 4,
        starts_at: AT("23:00"),
        ends_at: AT("00:30", true),
      });
      const result = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: flexTableA,
        party_size: 5,
        time: "21:00",
      });
      expect(result.ok).toBe(true);

      const after = await readReservation(id);
      expect(after.party_size).toBe(5);
      expect(after.starts_at).toBe("2027-01-16T00:00:00+00:00");

      await supabase.from("reservations").delete().eq("id", id);
    });

    it("asigna mesa a una genérica y después la vuelve a dejar sin mesa", async () => {
      const id = await mkGenerica();

      const asignar = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: flexTableA,
        party_size: 4,
      });
      expect(asignar.ok).toBe(true);
      expect((await readReservation(id)).table_id).toBe(flexTableA);

      const liberar = await updateReservationDetails({
        business_slug: flexSlug,
        reservation_id: id,
        table_id: null,
        party_size: 4,
      });
      expect(liberar.ok).toBe(true);
      expect((await readReservation(id)).table_id).toBeNull();

      await supabase.from("reservations").delete().eq("id", id);
    });
  });

  // La regla se ensanchó en #204 («la solicitud se edita antes de decidirla»):
  // desde entonces se editan las **activas**, que son `confirmed` Y `pending`.
  // El test seguía afirmando sobre el texto viejo («confirmadas») y quedó rojo
  // en cada corrida — un rojo crónico que entrena a ignorar `pnpm test`
  // (issue #256). Ahora afirma sobre el estado, que es lo que la regla dice, y
  // no sobre cómo está redactado el mensaje.
  it("no edita una reserva que ya no está activa", async () => {
    const id = await mkReservation({
      business_id: strictId,
      table_id: strictTableA,
      party_size: 2,
      starts_at: AT("23:00"),
      ends_at: AT("00:30", true),
      status: "seated",
    });
    const result = await updateReservationDetails({
      business_slug: strictSlug,
      reservation_id: id,
      table_id: strictTableA,
      party_size: 2,
      time: "21:00",
    });
    // `seated` no es activa: la mesa ya se sentó, editarla no tiene sentido.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/activas/i);

    // Y la contracara, que es lo que #204 vino a habilitar: una `pending` SÍ se
    // edita. Sin esto el test sólo fija la mitad de la regla.
    // Otro horario: la `seated` de arriba sigue viva en la misma mesa y el
    // constraint de solapamiento (`reservations_no_overlap`) las rechazaría.
    const pendiente = await mkReservation({
      business_id: strictId,
      table_id: strictTableA,
      party_size: 2,
      starts_at: AT("13:00"),
      ends_at: AT("14:30"),
      status: "pending",
    });
    const editable = await updateReservationDetails({
      business_slug: strictSlug,
      reservation_id: pendiente,
      table_id: strictTableA,
      party_size: 3,
      time: "13:00",
    });
    expect(editable.ok).toBe(true);

    await supabase.from("reservations").delete().eq("id", pendiente);
    await supabase.from("reservations").delete().eq("id", id);
  });
});
