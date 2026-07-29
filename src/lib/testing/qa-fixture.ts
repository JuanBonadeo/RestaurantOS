import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Negocio fijo para los tests de integración.
//
// Antes cada archivo de test sembraba **su propio negocio** (business +
// usuarios + plano + caja + configs) en el `beforeAll` y lo borraba al final:
// 17 archivos × ~8 round-trips contra la cloud antes de probar nada. Ese setup
// es lo que hacía que tests que verifican lógica de 3 líneas se cayeran por
// `Test timed out in 5000ms` cuando la nube estaba lenta.
//
// Acá el negocio es **persistente e idempotente**: se crea la primera vez y
// después se reutiliza. A partir de la segunda corrida, `ensureQaBusiness()`
// son dos SELECT.
//
// Lo que cada test SÍ sigue creando es lo suyo (mesas, órdenes, pagos): es
// barato y es lo que garantiza que dos tests no se pisen.
//
// **No es `demo`, a propósito.** `demo` es para probar a mano; si los tests
// escribieran ahí, su caja mostraría ventas que nadie cobró y el arqueo dejaría
// de servir para verificar nada.
// ============================================================================

export const QA_SLUG = "qa-fixture";

export type QaFixture = {
  businessId: string;
  businessSlug: string;
  floorPlanId: string;
  cajaId: string;
  adminId: string;
  encargadoId: string;
  mozoId: string;
  /** Segundo mozo — para permisos cruzados y traslados entre mozos. */
  mozo2Id: string;
};

type Client = SupabaseClient;

/** Usuarios del fixture. La contraseña es un literal de test sobre cuentas
 *  descartables `@qa.test`; no son credenciales de nadie ni sirven para otro
 *  negocio. */
const USERS = [
  { key: "adminId", label: "QA Admin", role: "admin" },
  { key: "encargadoId", label: "QA Encargado", role: "encargado" },
  { key: "mozoId", label: "QA Mozo", role: "mozo" },
  { key: "mozo2Id", label: "QA Mozo 2", role: "mozo" },
] as const;

async function ensureUser(
  supabase: Client,
  label: string,
  slot: string,
): Promise<string> {
  const email = `qa-${slot}@qa.test`;

  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password: `qa-fixture-${slot}-pass`,
    email_confirm: true,
  });
  // Carrera entre archivos de test que corren en paralelo: si otro lo creó
  // entre el SELECT y el INSERT, lo leemos.
  if (error || !created?.user) {
    const { data: retry } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (retry) return (retry as { id: string }).id;
    throw new Error(`qa-fixture: no se pudo crear ${email}: ${error?.message}`);
  }

  const id = created.user.id;
  await supabase.from("users").upsert({ id, email, full_name: label });
  return id;
}

/**
 * Devuelve el negocio de QA, creándolo sólo si no existe.
 *
 * Idempotente y seguro de llamar desde varios archivos en paralelo: cada paso
 * chequea antes de insertar.
 */
export async function ensureQaBusiness(supabase: Client): Promise<QaFixture> {
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    ids[u.key] = await ensureUser(supabase, u.label, u.key);
  }

  let { data: biz } = await supabase
    .from("businesses")
    .select("id, slug")
    .eq("slug", QA_SLUG)
    .maybeSingle();

  if (!biz) {
    const { data: created } = await supabase
      .from("businesses")
      .insert({ slug: QA_SLUG, name: "QA Fixture", is_active: true })
      .select("id, slug")
      .single();
    biz = created;
  }
  const businessId = (biz as { id: string }).id;

  for (const u of USERS) {
    await supabase.from("business_users").upsert(
      {
        business_id: businessId,
        user_id: ids[u.key],
        role: u.role,
        full_name: u.label,
      },
      { onConflict: "business_id,user_id" },
    );
  }

  let { data: fp } = await supabase
    .from("floor_plans")
    .select("id")
    .eq("business_id", businessId)
    .limit(1)
    .maybeSingle();
  if (!fp) {
    const { data: created } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "QA Salón" })
      .select("id")
      .single();
    fp = created;
  }

  let { data: caja } = await supabase
    .from("cajas")
    .select("id")
    .eq("business_id", businessId)
    .limit(1)
    .maybeSingle();
  if (!caja) {
    const { data: created } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "QA Caja", is_default: true })
      .select("id")
      .single();
    caja = created;
  }

  return {
    businessId,
    businessSlug: QA_SLUG,
    floorPlanId: (fp as { id: string }).id,
    cajaId: (caja as { id: string }).id,
    adminId: ids.adminId,
    encargadoId: ids.encargadoId,
    mozoId: ids.mozoId,
    mozo2Id: ids.mozo2Id,
  };
}

/**
 * Recargo/descuento por método para el negocio de QA. Se pasa el porcentaje y
 * queda seteado — sin esto cada test tendría que insertar (y limpiar) su propia
 * config, que es justo el tipo de setup que este fixture elimina.
 */
export async function setQaMethodAdjustment(
  supabase: Client,
  businessId: string,
  method: string,
  percent: number,
): Promise<void> {
  await supabase
    .from("payment_method_configs")
    .upsert(
      {
        business_id: businessId,
        method,
        adjustment_percent: percent,
        is_active: true,
      },
      { onConflict: "business_id,method" },
    );
}

/**
 * Borra lo que creó un test: sus órdenes (con sus pagos e items en cascada) y
 * sus mesas. El negocio, los usuarios y la caja **quedan** — esa es la idea.
 *
 * `tag` es el prefijo que el test usó en `customer_name` / `tables.label`.
 */
export async function cleanupQaData(
  supabase: Client,
  businessId: string,
  tag: string,
): Promise<void> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("business_id", businessId)
    .like("customer_name", `${tag}%`);

  for (const o of (orders ?? []) as Array<{ id: string }>) {
    await supabase.from("payments").delete().eq("order_id", o.id);
    await supabase.from("order_splits").delete().eq("order_id", o.id);
    await supabase.from("order_items").delete().eq("order_id", o.id);
    await supabase.from("orders").delete().eq("id", o.id);
  }

  const { data: fps } = await supabase
    .from("floor_plans")
    .select("id")
    .eq("business_id", businessId);
  for (const fp of (fps ?? []) as Array<{ id: string }>) {
    await supabase
      .from("tables")
      .delete()
      .eq("floor_plan_id", fp.id)
      .like("label", `${tag}%`);
  }
}
