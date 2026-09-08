// @vitest-environment node
//
// P09 · issue #262 — el alta flexible y el servicio que cruza la medianoche.
//
// Una cena 20:00→00:30 tiene horarios de llegada legítimos después de las doce:
// la grilla del modal ofrece 23:45, 00:00, 00:15. Pero «00:15» es de la
// madrugada SIGUIENTE, y el alta lo armaba con `${date}T00:15` a secas — o sea
// 24 horas antes. Con `ends` ya rodado al día siguiente, la reserva abarcaba más
// de un día entero y le comía la mesa el almuerzo y la cena del día anterior.
//
// La corrección existía escrita en `edit-window.ts` para el camino de edición,
// con el mismo comentario. Al alta nunca se le puso.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TAG = `test-medianoche-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { createFlexibleReservation } = await import("./booking-actions");

describe.skipIf(!dbAvailable)("reservas · alta flexible con cena que cruza las doce", () => {
  const db = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let encargadoId: string;
  /** Mañana, para que «ya pasó» no interfiera. */
  const fecha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const email = `${TAG}@example.test`;
    const { data: u } = await db.auth.admin.createUser({
      email, password: "test-pass-12345", email_confirm: true,
    });
    encargadoId = u!.user!.id;
    CURRENT_USER_ID = encargadoId;
    await db.from("users").upsert({ id: encargadoId, email, full_name: "Encargada" });

    const { data: biz } = await db
      .from("businesses")
      .insert({ slug: TAG, name: "Medianoche", is_active: true,
                timezone: "America/Argentina/Buenos_Aires" })
      .select("id").single();
    businessId = biz!.id;
    await db.from("business_users").insert({
      business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargada",
    });
    await db.from("reservation_settings")
      .upsert({ business_id: businessId, mode: "flexible" }, { onConflict: "business_id" });

    // Cena todos los días, 20:00 → 00:30.
    const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    await db.from("reservation_services").insert({
      business_id: businessId, name: "Cena", day_of_week: dow,
      opens_at: "20:00", closes_at: "00:30", soft_capacity: 50,
    });
  });

  afterAll(async () => {
    if (businessId) await db.from("businesses").delete().eq("id", businessId);
    if (encargadoId) {
      await db.from("users").delete().eq("id", encargadoId);
      await db.auth.admin.deleteUser(encargadoId);
    }
  });

  it("una llegada a las 00:15 cae en la madrugada siguiente, no 24 h antes", async () => {
    const r = await createFlexibleReservation({
      business_slug: TAG,
      date: fecha,
      service: "Cena",
      arrival_time: "00:15",
      party_size: 2,
      customer_name: "Cliente",
      customer_phone: "1122334455",
      source: "admin",
      allow_overbook: true,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;

    const { data: fila } = await db
      .from("reservations")
      .select("starts_at, ends_at")
      .eq("id", r.data.id)
      .single();

    const starts = new Date(fila!.starts_at);
    const ends = new Date(fila!.ends_at);
    const duracionH = (ends.getTime() - starts.getTime()) / 3_600_000;

    // Antes: 00:15 del día D contra un cierre en D+1 00:30 → más de 24 h de mesa
    // bloqueada. Ahora la reserva dura lo que dura una cena.
    expect(duracionH).toBeGreaterThan(0);
    expect(duracionH).toBeLessThan(2);
  });

  it("un horario fuera del servicio se rechaza", async () => {
    const r = await createFlexibleReservation({
      business_slug: TAG,
      date: fecha,
      service: "Cena",
      arrival_time: "13:00",
      party_size: 2,
      customer_name: "Cliente",
      customer_phone: "1122334455",
      source: "admin",
      allow_overbook: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fuera del servicio/i);
  });
});
