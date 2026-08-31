import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BusinessRole } from "@/lib/admin/context";

import type {
  DayServiceOption,
  FloorTable,
  Reservation,
  ReservationMode,
  ReservationService,
  ReservationSettings,
} from "@/lib/reservations/types";
import { DEFAULT_RESERVATION_SETTINGS } from "@/lib/reservations/types";
import {
  availabilityLookupWindow,
  computeAvailableSlots,
  type AvailableSlot,
} from "@/lib/reservations/availability";
import {
  computeFlexibleAvailability,
  flexibleServiceWindow,
  reservedCovers,
  type FlexibleAvailability,
  type ReservationForFlexible,
} from "@/lib/reservations/flexible-availability";
import { isTableAvailableForReservation } from "@/lib/reservations/assign-table";
import { DEFAULT_APPROVAL_EXPIRY_MIN, pendingExpiresAt } from "@/lib/reservations/pending-expiry";
import {
  localDate,
  ocupacionPorCubiertos,
  ocupacionPorMesas,
  type OcupacionContexto,
  type SolicitudEnBandeja,
} from "@/lib/reservations/pending-inbox";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

/**
 * Resuelve `{ id, timezone }` de un negocio por slug. Helper compartido por
 * booking-actions y availability-actions (antes cada uno tenía su propia copia
 * del select). Usa service client: corre en contextos públicos/anon.
 */
export async function getBusinessBySlug(
  slug: string,
): Promise<{ id: string; timezone: string } | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("businesses")
    .select("id, timezone")
    .eq("slug", slug)
    .maybeSingle();
  return (data as { id: string; timezone: string } | null) ?? null;
}

/**
 * Resuelve el rol efectivo de un usuario para un negocio + si es platform
 * admin. Reemplaza los `assertCanManage` hechos a mano que vivían en
 * booking-actions / settings-actions: el llamador combina esto con los helpers
 * puros de `lib/permissions/can.ts` (`canManageReservations`,
 * `canConfigureReservations`). Usa service client (corre en contextos públicos
 * donde RLS escondería la membership).
 */
export async function getReservationActor(
  businessId: string,
  userId: string,
): Promise<{ role: BusinessRole | null; isPlatformAdmin: boolean }> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const [{ data: profile }, { data: membership }] = await Promise.all([
    service.from("users").select("is_platform_admin").eq("id", userId).maybeSingle(),
    service
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  return {
    role: (membership as { role?: BusinessRole } | null)?.role ?? null,
    isPlatformAdmin:
      (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin ?? false,
  };
}

/**
 * Reads the reservation settings row, returning DB defaults when nothing was
 * saved yet. The form upserts on save so we never need to insert an empty row
 * up-front, but consumers (the customer-facing reservation flow especially)
 * need defaults to render before the admin has touched anything.
 */
export async function getReservationSettings(
  businessId: string,
  options: { useService?: boolean } = {},
): Promise<ReservationSettings> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);

  const { data } = await supabase
    .from("reservation_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (data) return data as ReservationSettings;

  return {
    business_id: businessId,
    ...DEFAULT_RESERVATION_SETTINGS,
    updated_at: new Date(0).toISOString(),
  };
}

/**
 * Returns the active+disabled tables of a business.
 *
 * Sin `floorPlanId`: comportamiento legacy — toma el primer floor_plan del
 * negocio (orden por created_at asc). Lo usan admin, mozo y el flujo legacy
 * que asumía un único salón.
 *
 * Con `floorPlanId`: filtra a ese salón específico. Antes de filtrar verifica
 * que el plan pertenezca al `businessId` para no leer mesas cross-tenant si
 * un cliente manda un uuid de otro negocio en el input.
 */
export async function getBusinessTables(
  businessId: string,
  options: {
    useService?: boolean;
    floorPlanId?: string | null;
    excludeBar?: boolean;
  } = {},
): Promise<FloorTable[]> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);

  let planId: string | null = null;

  if (options.floorPlanId) {
    const { data: plan } = await supabase
      .from("floor_plans")
      .select("id")
      .eq("id", options.floorPlanId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (!plan) return [];
    planId = (plan as { id: string }).id;
  } else {
    const { data: plan } = await supabase
      .from("floor_plans")
      .select("id")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!plan) return [];
    planId = (plan as { id: string }).id;
  }

  let tablesQuery = supabase
    .from("tables")
    .select("*")
    .eq("floor_plan_id", planId);
  // Las mesas de barra (is_bar) quedan fuera del motor de reservas: no se
  // auto-asignan, no se ofrecen ni cuentan para disponibilidad (spec 08).
  if (options.excludeBar) tablesQuery = tablesQuery.eq("is_bar", false);
  const { data: tables } = await tablesQuery;
  return (tables ?? []) as FloorTable[];
}

/**
 * Salones (floor_plans) del negocio que tienen al menos una mesa activa.
 * Usado por el flujo de reservas: si devuelve más de uno, el cliente elige
 * en cuál reservar antes de ver los horarios.
 */
export async function getBusinessSalones(
  businessId: string,
  options: { useService?: boolean } = {},
): Promise<Array<{ id: string; name: string }>> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);

  const { data: plans } = await supabase
    .from("floor_plans")
    .select("id, name")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  const rows = (plans ?? []) as Array<{ id: string; name: string }>;
  if (rows.length === 0) return [];

  const { data: activeTables } = await supabase
    .from("tables")
    .select("floor_plan_id")
    .in(
      "floor_plan_id",
      rows.map((r) => r.id),
    )
    .eq("status", "active");
  const planIdsWithActive = new Set(
    ((activeTables ?? []) as Array<{ floor_plan_id: string }>).map(
      (t) => t.floor_plan_id,
    ),
  );

  return rows.filter((r) => planIdsWithActive.has(r.id));
}

/**
 * Live (confirmed/seated) reservations whose [starts_at, ends_at) intersects
 * the given window. Used to feed the availability engine.
 */
export async function getReservationsInRange(
  businessId: string,
  fromIso: string,
  toIso: string,
  options: { useService?: boolean } = {},
): Promise<Reservation[]> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);

  const { data } = await supabase
    .from("reservations")
    .select("*")
    .eq("business_id", businessId)
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at", { ascending: true });
  return (data ?? []) as Reservation[];
}

/**
 * Disponibilidad de un negocio para una fecha + party_size, opcionalmente
 * restringida a un salón. Fuente ÚNICA del pipeline "settings + tables +
 * reservas → computeAvailableSlots": la usan el flujo web (`fetchAvailability`)
 * y las tools del chatbot (`checkAvailabilityForChatbot`, `createReservationIntent`).
 *
 * La ventana de reservas es TZ-aware (`availabilityLookupWindow`), así que
 * cubre el día local completo en cualquier offset — antes cada caller la
 * recalculaba a mano (uno en UTC fijo, con bug latente de borde de día).
 *
 * `computeAvailableSlots` (puro) sigue siendo la lógica de negocio; esto solo
 * orquesta la carga de datos.
 */
export async function getAvailability(
  businessId: string,
  timezone: string,
  params: { date: string; partySize: number; floorPlanId?: string | null },
  options: { useService?: boolean } = {},
): Promise<AvailableSlot[]> {
  const settings = await getReservationSettings(businessId, options);
  const tables = await getBusinessTables(businessId, {
    useService: options.useService,
    floorPlanId: params.floorPlanId ?? null,
    excludeBar: true,
  });
  const { fromIso, toIso } = availabilityLookupWindow(params.date, timezone);
  const reservations = await getReservationsInRange(businessId, fromIso, toIso, options);

  return computeAvailableSlots({
    date: params.date,
    partySize: params.partySize,
    settings,
    tables,
    reservations,
    timezone,
  });
}

// ── Spec 059 · modo flexible ────────────────────────────────────────────────

const FLEX_DAY_MS = 24 * 60 * 60 * 1000;

export function dayOfWeekFromDate(date: string): number | null {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export async function getReservationServices(
  businessId: string,
  options: { useService?: boolean } = {},
): Promise<ReservationService[]> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);
  const { data } = await supabase
    .from("reservation_services")
    .select("*")
    .eq("business_id", businessId)
    .order("opens_at", { ascending: true });
  return (data ?? []) as ReservationService[];
}

/**
 * Spec 097 — lo que el editor de reservas del admin necesita saber del negocio
 * para una fecha: en qué modo está y, si es flexible, qué servicios corren ese
 * día (deduplicados por nombre: el mismo servicio puede estar configurado por
 * zona). En estricto devuelve la lista vacía.
 */
export async function getReservationEditContext(
  businessId: string,
  date: string,
  options: { useService?: boolean } = {},
): Promise<{ mode: ReservationMode; services: DayServiceOption[] }> {
  const settings = await getReservationSettings(businessId, options);
  const mode = settings.mode ?? "estricto";
  if (mode !== "flexible") return { mode, services: [] };

  const dow = dayOfWeekFromDate(date);
  const all = await getReservationServices(businessId, options);
  const seen = new Set<string>();
  const services: DayServiceOption[] = [];
  for (const svc of all) {
    if (svc.day_of_week !== null && svc.day_of_week !== dow) continue;
    if (seen.has(svc.name)) continue;
    seen.add(svc.name);
    services.push({
      name: svc.name,
      opens_at: svc.opens_at.slice(0, 5),
      closes_at: svc.closes_at.slice(0, 5),
    });
  }
  return { mode, services };
}

/**
 * Resuelve el servicio por nombre para una fecha (y zona, si se pide).
 * Prioridad: día exacto + zona → día exacto + sin zona → todos los días + zona
 * → todos los días + sin zona. La zona importa porque el cupo blando puede
 * definirse por salón: sin este orden, un negocio con el mismo servicio en
 * varias zonas resolvía una fila arbitraria (y por lo tanto el cupo de otra).
 */
export async function getReservationServiceByName(
  businessId: string,
  name: string,
  dayOfWeek: number | null,
  options: { useService?: boolean; floorPlanId?: string | null } = {},
): Promise<ReservationService | null> {
  const services = await getReservationServices(businessId, options);
  const matches = services.filter((s) => s.name === name);
  const zoneId = options.floorPlanId ?? null;
  const sameDay = (s: ReservationService) => s.day_of_week === dayOfWeek;
  const anyDay = (s: ReservationService) => s.day_of_week === null;
  const sameZone = (s: ReservationService) => s.floor_plan_id === zoneId;
  const noZone = (s: ReservationService) => s.floor_plan_id === null;

  return (
    matches.find((s) => sameDay(s) && sameZone(s)) ??
    matches.find((s) => sameDay(s) && noZone(s)) ??
    matches.find((s) => anyDay(s) && sameZone(s)) ??
    matches.find((s) => anyDay(s) && noZone(s)) ??
    matches.find(sameDay) ??
    matches.find(anyDay) ??
    null
  );
}

/**
 * Spec 135 — la bandeja: todas las solicitudes que esperan respuesta, de
 * cualquier día.
 *
 * Es la consulta que la 131 no tenía: la pantalla de reservas carga un día, así
 * que una solicitud para el sábado no existía hasta que alguien navegaba al
 * sábado — y mientras tanto vencía sola. El índice parcial
 * `reservations_pending_idx` (migración 0053) sirve este `eq + gte + order`.
 */
export async function getPendingReservations(
  businessId: string,
  options: { useService?: boolean; now?: Date } = {},
): Promise<PendingReservationRow[]> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);
  const now = options.now ?? new Date();
  const { data } = await supabase
    .from("reservations")
    .select("*, tables(label, floor_plans(id, name))")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true });
  return (data ?? []) as PendingReservationRow[];
}

export type PendingReservationRow = Reservation & {
  tables?: { label: string; floor_plans?: { id: string; name: string } | null } | null;
};

/**
 * Spec 135 — las solicitudes con el contexto para decidirlas: cómo viene el
 * servicio al que entran y cuándo vencen.
 *
 * Carga en bloque (una consulta de reservas para todo el rango, una de mesas,
 * una de servicios) y calcula en memoria con las funciones puras. La
 * alternativa —preguntar disponibilidad por solicitud— es N consultas para
 * responder N veces casi lo mismo.
 */
export async function getPendingInbox(
  businessId: string,
  timezone: string,
  options: { useService?: boolean; now?: Date } = {},
): Promise<SolicitudEnBandeja[]> {
  const now = options.now ?? new Date();
  const pendings = await getPendingReservations(businessId, { ...options, now });
  if (pendings.length === 0) return [];

  const settings = await getReservationSettings(businessId, options);
  const expiryMin = settings.approval_expiry_min ?? DEFAULT_APPROVAL_EXPIRY_MIN;

  // Ventana que cubre todas las solicitudes, con un día de más a cada lado para
  // que los servicios que cruzan medianoche entren enteros.
  const desde = new Date(
    new Date(pendings[0].starts_at).getTime() - 24 * 60 * 60 * 1000,
  );
  const ultima = pendings[pendings.length - 1];
  const hasta = new Date(
    new Date(ultima.starts_at).getTime() + 48 * 60 * 60 * 1000,
  );

  const [reservasDelRango, mesas, servicios] = await Promise.all([
    getReservationsInRange(businessId, desde.toISOString(), hasta.toISOString(), options),
    getAllReservableTables(businessId, options),
    settings.mode === "flexible"
      ? getReservationServices(businessId, options)
      : Promise.resolve([] as ReservationService[]),
  ]);

  return pendings.map((reserva) => ({
    reserva,
    venceEn: pendingExpiresAt(reserva, expiryMin).toISOString(),
    ocupacion: contextoDeOcupacion({
      reserva,
      mode: settings.mode ?? "estricto",
      timezone,
      reservas: reservasDelRango,
      mesas,
      servicios,
    }),
  }));
}

/** El contexto de D5: cubiertos del servicio en flexible, mesas libres en estricto. */
function contextoDeOcupacion(input: {
  reserva: PendingReservationRow;
  mode: ReservationMode;
  timezone: string;
  reservas: Reservation[];
  mesas: FloorTable[];
  servicios: ReservationService[];
}): OcupacionContexto | null {
  const { reserva, mode, timezone, reservas, mesas, servicios } = input;

  if (mode === "flexible" && reserva.service) {
    const date = localDate(reserva.starts_at, timezone);
    const dow = dayOfWeekFromDate(date);
    const zoneId = reserva.floor_plan_id ?? reserva.tables?.floor_plans?.id ?? null;
    const matches = servicios.filter((s) => s.name === reserva.service);
    const svc =
      matches.find((s) => s.day_of_week === dow && s.floor_plan_id === zoneId) ??
      matches.find((s) => s.day_of_week === dow && s.floor_plan_id === null) ??
      matches.find((s) => s.day_of_week === null && s.floor_plan_id === zoneId) ??
      matches.find((s) => s.day_of_week === null && s.floor_plan_id === null) ??
      matches[0];
    if (!svc) return null;
    const window = flexibleServiceWindow(date, svc, timezone);
    if (!window) return null;
    return ocupacionPorCubiertos(
      reserva.service,
      reservedCovers(reservas, window, svc.floor_plan_id),
      svc.soft_capacity ?? null,
    );
  }

  // Estricto: no hay cupo configurado, así que se cuenta lo único cierto —
  // cuántas mesas quedan libres en la ventana de esta reserva.
  const activas = mesas.filter((t) => t.status === "active");
  if (activas.length === 0) return null;
  const windowStart = new Date(reserva.starts_at);
  const windowEnd = new Date(reserva.ends_at);
  const libres = activas.filter((t) =>
    isTableAvailableForReservation({
      tableId: t.id,
      reservations: reservas,
      windowStart,
      windowEnd,
      excludeReservationId: reserva.id,
    }),
  ).length;
  return ocupacionPorMesas(libres, activas.length);
}

/**
 * Todas las mesas reservables del negocio (todas las zonas, sin barra). El modo
 * flexible no asume un único salón, a diferencia del legacy `getBusinessTables`.
 */
export async function getAllReservableTables(
  businessId: string,
  options: { useService?: boolean } = {},
): Promise<FloorTable[]> {
  const supabase = options.useService
    ? (createSupabaseServiceClient() as unknown as GenericClient)
    : ((await createSupabaseServerClient()) as unknown as GenericClient);
  const { data: plans } = await supabase
    .from("floor_plans")
    .select("id")
    .eq("business_id", businessId);
  const planIds = ((plans ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (planIds.length === 0) return [];
  const { data } = await supabase
    .from("tables")
    .select("*")
    .in("floor_plan_id", planIds)
    .eq("is_bar", false);
  return (data ?? []) as FloorTable[];
}

/**
 * Disponibilidad del MODO FLEXIBLE (spec 059) para una fecha + servicio.
 * Devuelve mesas libres del servicio + cubiertos reservados (capacidad blanda),
 * y si se pide `tableId`, si esa mesa puntual está disponible. `null` si el
 * negocio no tiene ese servicio configurado / la ventana es inválida.
 */
export async function getFlexibleAvailability(
  businessId: string,
  timezone: string,
  params: {
    date: string;
    service: string;
    partySize: number;
    tableId?: string | null;
    floorPlanId?: string | null;
    /** Spec 077 — tope duro (canales de cliente). Default `false` = advisory. */
    enforceCapacity?: boolean;
    /**
     * Spec 097 — reserva que se está **editando**: no cuenta contra sí misma.
     * Sin esto, mover o agrandar una reserva ve su propia mesa ocupada y sus
     * propios cubiertos sumados dos veces.
     */
    excludeReservationId?: string | null;
  },
  options: { useService?: boolean } = {},
): Promise<FlexibleAvailability | null> {
  const dow = dayOfWeekFromDate(params.date);
  const svc = await getReservationServiceByName(businessId, params.service, dow, {
    ...options,
    floorPlanId: params.floorPlanId ?? null,
  });
  if (!svc) return null;
  const window = flexibleServiceWindow(params.date, svc, timezone);
  if (!window) return null;

  const tables = await getAllReservableTables(businessId, options);
  const reservations = await getReservationsInRange(
    businessId,
    new Date(window.starts.getTime() - FLEX_DAY_MS).toISOString(),
    new Date(window.ends.getTime() + FLEX_DAY_MS).toISOString(),
    options,
  );

  // Cubiertos por zona: las reservas con mesa derivan su zona de la mesa; las
  // genéricas ya traen floor_plan_id. Se resuelve acá para reservedCovers(zona).
  const tableZone = new Map(tables.map((t) => [t.id, t.floor_plan_id]));
  const forFlex: ReservationForFlexible[] = (reservations as Reservation[])
    .filter((r) => !params.excludeReservationId || r.id !== params.excludeReservationId)
    .map((r) => ({
      table_id: r.table_id,
      starts_at: r.starts_at,
      party_size: r.party_size,
      status: r.status,
      floor_plan_id: r.table_id
        ? tableZone.get(r.table_id) ?? r.floor_plan_id ?? null
        : r.floor_plan_id ?? null,
    }));

  return computeFlexibleAvailability({
    date: params.date,
    service: svc,
    partySize: params.partySize,
    tables,
    reservations: forFlex,
    timezone,
    tableId: params.tableId ?? null,
    floorPlanId: params.floorPlanId ?? null,
    enforceCapacity: params.enforceCapacity ?? false,
  });
}

