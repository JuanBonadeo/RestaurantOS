import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calculateExpectedCash } from "./expected-cash";
import { calcularRendicionMozo } from "./liquidacion-mozo";
import { agruparVentasPorOrigen } from "./ventas-por-origen";
import type {
  Caja,
  CajaConEstado,
  CajaCorte,
  CajaLiveStats,
  CajaMovimiento,
  CajaUserAssignment,
  MozoRendicion,
  PaymentMethod,
  PaymentMethodConfig,
  RendicionMozoPendiente,
} from "./types";

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0044 applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

const EMPTY_BY_METHOD: Record<PaymentMethod, number> = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
};

export async function getCajasForBusiness(
  businessId: string,
): Promise<Caja[]> {
  const service = db();
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, sort_order, is_default")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Caja[];
}

export async function getAllCajasForBusiness(
  businessId: string,
): Promise<Caja[]> {
  const service = db();
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, sort_order, is_default")
    .eq("business_id", businessId)
    .order("is_active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as Caja[];
}

/**
 * Caja donde se asienta un cobro que no tuvo cajero: hoy, el pago online de un
 * delivery / take-away que acredita el webhook de MP.
 *
 * Si el negocio no marcó ninguna, cae en la primera caja activa por
 * `sort_order`. El fallback importa: `payments.caja_id` es NOT NULL, así que
 * sin él un negocio que nunca entró a la config perdería el pago.
 */
export async function getDefaultCaja(
  businessId: string,
): Promise<Caja | null> {
  const cajas = await getCajasForBusiness(businessId);
  if (cajas.length === 0) return null;
  return cajas.find((c) => c.is_default) ?? cajas[0];
}

async function getUltimoCorte(
  cajaId: string,
  businessId: string,
): Promise<CajaCorte | null> {
  const service = db();
  const { data } = await service
    .from("caja_cortes")
    .select("*")
    .eq("caja_id", cajaId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as CajaCorte | null;
}

export async function getCajasConEstado(
  businessId: string,
): Promise<CajaConEstado[]> {
  const cajas = await getCajasForBusiness(businessId);
  const service = db();

  const results: CajaConEstado[] = [];
  for (const caja of cajas) {
    const { data: corte } = await service
      .from("caja_cortes")
      .select("*")
      .eq("caja_id", caja.id)
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const ultimoCorte = corte as CajaCorte | null;
    const { data: cajaRow } = await service
      .from("cajas")
      .select("created_at")
      .eq("id", caja.id)
      .single();
    const cajaCreatedAt = (cajaRow as { created_at: string } | null)?.created_at ?? new Date().toISOString();

    results.push({
      ...caja,
      ultimo_corte: ultimoCorte,
      periodo_desde: ultimoCorte?.created_at ?? cajaCreatedAt,
    });
  }

  return results;
}

export async function getMovimientosPeriodoActual(
  cajaId: string,
  businessId: string,
): Promise<CajaMovimiento[]> {
  const ultimoCorte = await getUltimoCorte(cajaId, businessId);
  const service = db();

  let query = service
    .from("caja_movimientos")
    .select("id, caja_id, business_id, kind, amount_cents, reason, created_by, created_at")
    .eq("caja_id", cajaId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (ultimoCorte) {
    query = query.gt("created_at", ultimoCorte.created_at);
  }

  const { data } = await query;
  return (data ?? []) as CajaMovimiento[];
}

export type CajaPayment = {
  id: string;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  created_at: string;
  order_id: string;
  order_number: number;
  delivery_type: string;
  table_label: string | null;
  customer_name: string | null;
  attributed_mozo_name: string | null;
};

export async function getPaymentsPeriodoActual(
  cajaId: string,
  businessId: string,
): Promise<CajaPayment[]> {
  const ultimoCorte = await getUltimoCorte(cajaId, businessId);
  const service = db();

  let query = service
    .from("payments")
    .select(
      "id, method, amount_cents, tip_cents, created_at, attributed_mozo_id, order_id, orders!inner(order_number, delivery_type, customer_name, table_id, tables!orders_table_id_fkey(label))",
    )
    .eq("caja_id", cajaId)
    .eq("payment_status", "paid")
    .order("created_at", { ascending: true });

  if (ultimoCorte) {
    query = query.gt("created_at", ultimoCorte.created_at);
  }

  type Row = {
    id: string;
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    created_at: string;
    attributed_mozo_id: string | null;
    order_id: string;
    orders: {
      order_number: number;
      delivery_type: string;
      customer_name: string | null;
      table_id: string | null;
      tables: { label: string } | { label: string }[] | null;
    } | {
      order_number: number;
      delivery_type: string;
      customer_name: string | null;
      table_id: string | null;
      tables: { label: string } | { label: string }[] | null;
    }[] | null;
  };

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const mozoIds = Array.from(
    new Set(rows.map((r) => r.attributed_mozo_id).filter((x): x is string => !!x)),
  );
  const mozoNameById = new Map<string, string>();
  if (mozoIds.length > 0) {
    const { data: bu } = await service
      .from("business_users")
      .select("user_id, full_name")
      .eq("business_id", businessId)
      .in("user_id", mozoIds);
    for (const m of (bu ?? []) as { user_id: string; full_name: string | null }[]) {
      if (m.full_name) mozoNameById.set(m.user_id, m.full_name);
    }
  }

  return rows.map((r) => {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    const tbl = ord?.tables
      ? Array.isArray(ord.tables) ? ord.tables[0] : ord.tables
      : null;
    return {
      id: r.id,
      method: r.method,
      amount_cents: Number(r.amount_cents),
      tip_cents: Number(r.tip_cents),
      created_at: r.created_at,
      order_id: r.order_id,
      order_number: ord?.order_number ?? 0,
      delivery_type: ord?.delivery_type ?? "",
      table_label: tbl?.label ?? null,
      customer_name: ord?.customer_name ?? null,
      attributed_mozo_name: r.attributed_mozo_id
        ? mozoNameById.get(r.attributed_mozo_id) ?? null
        : null,
    };
  });
}

export async function getCajaLiveStats(
  cajaId: string,
  businessId: string,
): Promise<CajaLiveStats | null> {
  const service = db();

  const { data: cajaRow } = await service
    .from("cajas")
    .select("id, business_id, is_active, created_at")
    .eq("id", cajaId)
    .maybeSingle();
  if (!cajaRow) return null;
  if ((cajaRow as { business_id: string }).business_id !== businessId) return null;

  const ultimoCorte = await getUltimoCorte(cajaId, businessId);
  const periodoDesdeFecha = ultimoCorte?.created_at ?? (cajaRow as { created_at: string }).created_at;

  // `orders!inner` es seguro: `payments.order_id` es NOT NULL, así que el join
  // no puede descartar cobros y desbalancear los totales.
  let paymentsQuery = service
    .from("payments")
    .select("method, amount_cents, tip_cents, orders!inner(delivery_type)")
    .eq("caja_id", cajaId)
    .eq("payment_status", "paid");
  paymentsQuery = paymentsQuery.gt("created_at", periodoDesdeFecha);

  let movQuery = service
    .from("caja_movimientos")
    .select("kind, amount_cents")
    .eq("caja_id", cajaId);
  movQuery = movQuery.gt("created_at", periodoDesdeFecha);

  const [paymentsRes, movimientosRes] = await Promise.all([
    paymentsQuery,
    movQuery,
  ]);

  const paymentRows = (paymentsRes.data ?? []) as unknown as Array<{
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
    orders:
      | { delivery_type: string }
      | { delivery_type: string }[]
      | null;
  }>;
  const payments = paymentRows.map((r) => {
    const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    return {
      method: r.method,
      amount_cents: Number(r.amount_cents),
      tip_cents: Number(r.tip_cents),
      delivery_type: ord?.delivery_type ?? "",
    };
  });
  const movimientos = (movimientosRes.data ?? []) as Array<{
    kind: "sangria" | "ingreso";
    amount_cents: number;
  }>;

  const ventas_por_metodo: Record<PaymentMethod, number> = { ...EMPTY_BY_METHOD };
  let total_ventas_cents = 0;
  let total_propinas_cents = 0;
  for (const p of payments) {
    ventas_por_metodo[p.method] = (ventas_por_metodo[p.method] ?? 0) + p.amount_cents;
    total_ventas_cents += p.amount_cents;
    total_propinas_cents += p.tip_cents;
  }

  const expected_cash_cents = calculateExpectedCash({
    last_closing_cash_cents: ultimoCorte?.closing_cash_cents ?? 0,
    payments,
    movimientos,
  });

  return {
    caja_id: cajaId,
    total_ventas_cents,
    total_propinas_cents,
    ventas_por_metodo,
    ventas_por_origen: agruparVentasPorOrigen(payments),
    cobros_count: payments.length,
    expected_cash_cents,
    periodo_desde: periodoDesdeFecha,
  };
}

export async function getPaymentMethodConfigs(
  businessId: string,
): Promise<PaymentMethodConfig[]> {
  const service = db();
  const { data } = await service
    .from("payment_method_configs")
    .select("id, business_id, method, adjustment_percent, label, is_active, sort_order")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as unknown as PaymentMethodConfig[]).map((r) => ({
    ...r,
    adjustment_percent: Number(r.adjustment_percent),
  }));
}

export async function getAllPaymentMethodConfigs(
  businessId: string,
): Promise<PaymentMethodConfig[]> {
  const service = db();
  const { data } = await service
    .from("payment_method_configs")
    .select("id, business_id, method, adjustment_percent, label, is_active, sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true });
  return ((data ?? []) as unknown as PaymentMethodConfig[]).map((r) => ({
    ...r,
    adjustment_percent: Number(r.adjustment_percent),
  }));
}

export async function getCortesByCaja(
  cajaId: string,
  businessId: string,
): Promise<CajaCorte[]> {
  const service = db();
  const { data } = await service
    .from("caja_cortes")
    .select("*")
    .eq("caja_id", cajaId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return (data ?? []) as CajaCorte[];
}

export async function getCortesHoy(
  businessId: string,
): Promise<(CajaCorte & { caja_name: string; encargado_name: string | null })[]> {
  const service = db();
  // Inicio del día operativo en timezone AR (spec 36 · R-G2): antes usaba la TZ
  // del server (UTC en Vercel) → la ventana "hoy" arrancaba 21:00 AR del día
  // anterior y los cortes nocturnos caían en el día equivocado.
  const AR_TZ = "America/Argentina/Buenos_Aires";
  const todayAr = formatInTimeZone(new Date(), AR_TZ, "yyyy-MM-dd");
  const todayStart = fromZonedTime(`${todayAr}T00:00:00`, AR_TZ);

  const { data } = await service
    .from("caja_cortes")
    .select("*, cajas!inner(name)")
    .eq("business_id", businessId)
    .gte("created_at", todayStart.toISOString())
    .order("created_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const encargadoIds = Array.from(
    new Set(data.map((row) => (row as { encargado_id: string }).encargado_id)),
  );
  const { data: encargados } = await service
    .from("users")
    .select("id, full_name")
    .in("id", encargadoIds);
  const nameById = new Map(
    (encargados ?? []).map((u) => [u.id as string, u.full_name as string | null]),
  );

  return data.map((row) => {
    const r = row as unknown as CajaCorte & {
      cajas: { name: string } | { name: string }[];
    };
    const cajaName = Array.isArray(r.cajas) ? r.cajas[0].name : r.cajas.name;
    return {
      ...r,
      caja_name: cajaName,
      encargado_name: nameById.get(r.encargado_id) ?? null,
    };
  });
}

// ── Rendición de mozos ──────────────────────────────────────────

async function getUltimaRendicionMozo(
  mozoId: string,
  businessId: string,
): Promise<MozoRendicion | null> {
  const service = db();
  const { data } = await service
    .from("mozo_rendiciones")
    .select("*")
    .eq("business_id", businessId)
    .eq("mozo_id", mozoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as MozoRendicion | null;
}

export async function getRendicionPendienteMozo(
  mozoId: string,
  businessId: string,
  mozoName: string,
): Promise<RendicionMozoPendiente> {
  const ultima = await getUltimaRendicionMozo(mozoId, businessId);
  const service = db();

  let query = service
    .from("payments")
    .select("method, amount_cents, tip_cents")
    .eq("attributed_mozo_id", mozoId)
    // Scope por negocio (spec 36 · R-C2): sin esto, un mozo activo en dos
    // locales (House/Golf) veía en su rendición los pagos del OTRO negocio.
    .eq("business_id", businessId)
    .eq("payment_status", "paid");

  if (ultima) {
    query = query.gt("created_at", ultima.created_at);
  }

  const { data } = await query;
  const payments = (data ?? []) as Array<{
    method: PaymentMethod;
    amount_cents: number;
    tip_cents: number;
  }>;

  const rendicion = calcularRendicionMozo(payments);

  return {
    mozo_id: mozoId,
    mozo_name: mozoName,
    efectivo_cents: rendicion.efectivo_cents,
    tickets_cents: rendicion.tickets_cents,
    por_metodo: rendicion.por_metodo,
    total_propinas_cents: rendicion.total_propinas_cents,
    pagos_count: payments.length,
  };
}

export async function getRendicionesPendientesTodosLosMozos(
  businessId: string,
): Promise<RendicionMozoPendiente[]> {
  const service = db();

  const { data: mozos } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("role", ["mozo", "encargado"]);

  if (!mozos || mozos.length === 0) return [];

  const results: RendicionMozoPendiente[] = [];
  for (const m of mozos as Array<{ user_id: string; full_name: string | null; role: string }>) {
    const pendiente = await getRendicionPendienteMozo(
      m.user_id,
      businessId,
      m.full_name ?? "Sin nombre",
    );
    results.push(pendiente);
  }

  return results;
}

export async function getRendicionesHistorial(
  businessId: string,
  limit = 20,
): Promise<(MozoRendicion & { mozo_name: string; registered_by_name: string | null })[]> {
  const service = db();
  const { data } = await service
    .from("mozo_rendiciones")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data || data.length === 0) return [];

  const rows = data as MozoRendicion[];
  const userIds = Array.from(
    new Set([...rows.map((r) => r.mozo_id), ...rows.map((r) => r.registered_by)]),
  );
  const { data: users } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", userIds);
  const nameById = new Map(
    (users ?? []).map((u) => [
      (u as { user_id: string }).user_id,
      (u as { full_name: string | null }).full_name,
    ]),
  );

  return rows.map((r) => ({
    ...r,
    mozo_name: nameById.get(r.mozo_id) ?? "Sin nombre",
    registered_by_name: nameById.get(r.registered_by) ?? null,
  }));
}

// ── Asignación caja↔usuario ─────────────────────────────────────

export async function getCajaUserAssignments(
  businessId: string,
): Promise<(CajaUserAssignment & { user_name: string | null; caja_name: string })[]> {
  const service = db();
  const { data } = await service
    .from("caja_user_assignments")
    .select("*, cajas!inner(name)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) return [];

  const rows = data as unknown as (CajaUserAssignment & {
    cajas: { name: string } | { name: string }[];
  })[];

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: users } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", businessId)
    .in("user_id", userIds);
  const nameById = new Map(
    (users ?? []).map((u) => [
      (u as { user_id: string }).user_id,
      (u as { full_name: string | null }).full_name,
    ]),
  );

  return rows.map((r) => {
    const cajaName = Array.isArray(r.cajas) ? r.cajas[0].name : r.cajas.name;
    return {
      id: r.id,
      business_id: r.business_id,
      caja_id: r.caja_id,
      user_id: r.user_id,
      created_at: r.created_at,
      user_name: nameById.get(r.user_id) ?? null,
      caja_name: cajaName,
    };
  });
}
