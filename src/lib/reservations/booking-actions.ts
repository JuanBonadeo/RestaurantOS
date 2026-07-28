"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createNotification } from "@/lib/notifications/create";
import { notifyReservationConfirmed } from "@/lib/notifications/reservation-notify";
import { canManageReservations } from "@/lib/permissions/can";
import { isTableAvailableForReservation, pickTableExcluding } from "@/lib/reservations/assign-table";
import {
  getAllReservableTables,
  getBusinessBySlug,
  getBusinessTables,
  getReservationActor,
  getReservationServiceByName,
  getReservationSettings,
  getReservationsInRange,
} from "@/lib/reservations/queries";
import { flexibleServiceWindow } from "@/lib/reservations/flexible-availability";
import {
  AdminCreateReservationInputSchema,
  CancelOwnReservationInputSchema,
  CreateFlexibleReservationInputSchema,
  CreateReservationInputSchema,
  SentarReservaInputSchema,
  UpdateReservationDetailsInputSchema,
  UpdateReservationStatusInputSchema,
} from "@/lib/reservations/schema";
import { openTable } from "@/lib/mozo/open-table";
import type { Reservation, ReservationSource } from "@/lib/reservations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

const EXCLUSION_VIOLATION = "23P01";
const MAX_ASSIGN_RETRIES = 5;

/**
 * Autoriza gestionar reservas (crear walk-in, sentar, cambiar estado, editar):
 * admin/encargado/mozo o platform admin (spec 22). Centralizado en
 * `canManageReservations` de `lib/permissions/can.ts`.
 */
async function canManage(businessId: string, userId: string): Promise<boolean> {
  const { role, isPlatformAdmin } = await getReservationActor(businessId, userId);
  return isPlatformAdmin || canManageReservations(role);
}

type CreateContext = {
  source: ReservationSource;
  businessId: string;
  timezone: string;
  userId: string | null;
  /** Email del cliente logueado (auth), para el canal email (spec 45). */
  customerEmail: string | null;
  date: string;
  slot: string;
  partySize: number;
  customerName: string;
  customerPhone: string;
  notes: string | null;
  forcedTableId?: string | null;
  /** Restringe el pool de mesas al salón elegido. Si null, comportamiento
   *  legacy (primer floor_plan del negocio). */
  floorPlanId?: string | null;
};

/**
 * Common booking flow used by both the customer-facing /reservar and the
 * admin "+ Nueva reserva" button. Handles:
 *   - Availability re-check (defends against race after the slot listing).
 *   - Smallest-fit table assignment with retry on 23P01 (exclusion violation).
 *   - Validation against settings (party size, lead time, advance horizon).
 */
async function createReservationCommon(
  ctx: CreateContext,
): Promise<ActionResult<{ id: string }>> {
  const settings = await getReservationSettings(ctx.businessId, { useService: true });

  if (ctx.partySize < 1 || ctx.partySize > settings.max_party_size) {
    return actionError(`El máximo es ${settings.max_party_size} comensales.`);
  }

  const start = fromZonedTime(`${ctx.date}T${ctx.slot}:00`, ctx.timezone);
  if (Number.isNaN(start.getTime())) return actionError("Fecha u hora inválida.");
  const end = new Date(start.getTime() + settings.slot_duration_min * 60_000);

  // Validación de cliente final (lead time / horizonte / horario): aplica a
  // la web directa y al chatbot. Los walk-ins de admin la saltean (el local
  // puede cargar reservas fuera de esas reglas).
  if (ctx.source !== "admin") {
    const leadCutoff = new Date(Date.now() + settings.lead_time_min * 60_000);
    if (start < leadCutoff) {
      return actionError("Necesitamos un poco más de antelación para ese horario.");
    }
    const horizonMs = settings.advance_days_max * 24 * 60 * 60 * 1000;
    if (start.getTime() - Date.now() > horizonMs) {
      return actionError(`Solo aceptamos reservas con hasta ${settings.advance_days_max} días de antelación.`);
    }
    const dow = String(new Date(Date.UTC(
      Number(ctx.date.slice(0, 4)),
      Number(ctx.date.slice(5, 7)) - 1,
      Number(ctx.date.slice(8, 10)),
    )).getUTCDay()) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
    const day = settings.schedule[dow];
    if (!day || !day.open || !day.slots.includes(ctx.slot)) {
      return actionError("Ese horario ya no está disponible.");
    }
  }

  const tables = await getBusinessTables(ctx.businessId, {
    useService: true,
    floorPlanId: ctx.floorPlanId ?? null,
    excludeBar: true,
  });
  const bufferMs = settings.buffer_min * 60_000;

  // Window we'll lookup overlapping reservations across — slightly wider than
  // the new slot so the buffer comparison sees adjacent reservations.
  const windowStart = new Date(start.getTime() - bufferMs);
  const windowEnd = new Date(end.getTime() + bufferMs);
  const reservations = await getReservationsInRange(
    ctx.businessId,
    windowStart.toISOString(),
    windowEnd.toISOString(),
    { useService: true },
  );

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const tried = new Set<string>();

  // Admin can pin a specific table. We don't loop in that case — if the
  // exclusion fires we surface the error directly so the operator picks a
  // different table.
  if (ctx.forcedTableId) {
    const target = tables.find((t) => t.id === ctx.forcedTableId);
    if (!target) return actionError("La mesa seleccionada no existe.");
    if (target.status !== "active") return actionError("La mesa está deshabilitada.");
    if (target.seats < ctx.partySize) {
      return actionError(`La mesa "${target.label}" no tiene capacidad para ${ctx.partySize} personas.`);
    }
    const { data, error } = await service
      .from("reservations")
      .insert({
        business_id: ctx.businessId,
        table_id: target.id,
        user_id: ctx.userId,
        customer_name: ctx.customerName,
        customer_phone: ctx.customerPhone,
        customer_email: ctx.customerEmail,
        party_size: ctx.partySize,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "confirmed",
        notes: ctx.notes,
        source: ctx.source,
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
        return actionError("La mesa ya está reservada en ese horario.");
      }
      console.error("createReservation/forced", error);
      return actionError("No pudimos crear la reserva.");
    }
    return actionOk({ id: (data as { id: string }).id });
  }

  for (let attempt = 0; attempt < MAX_ASSIGN_RETRIES; attempt += 1) {
    const candidate = pickTableExcluding(
      {
        tables,
        reservations,
        partySize: ctx.partySize,
        windowStart: start,
        windowEnd: end,
        bufferMs,
      },
      tried,
    );
    if (!candidate) {
      return actionError("Ya no quedan mesas disponibles para ese horario.");
    }

    const { data, error } = await service
      .from("reservations")
      .insert({
        business_id: ctx.businessId,
        table_id: candidate.id,
        user_id: ctx.userId,
        customer_name: ctx.customerName,
        customer_phone: ctx.customerPhone,
        customer_email: ctx.customerEmail,
        party_size: ctx.partySize,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: "confirmed",
        notes: ctx.notes,
        source: ctx.source,
      })
      .select("id")
      .single();

    if (!error && data) {
      return actionOk({ id: (data as { id: string }).id });
    }

    if ((error as { code?: string } | null)?.code === EXCLUSION_VIOLATION) {
      tried.add(candidate.id);
      // Re-fetch the conflicting reservation list so the next pickTable sees
      // the reservation that beat us. Cheap because the window is small.
      const refreshed = await getReservationsInRange(
        ctx.businessId,
        windowStart.toISOString(),
        windowEnd.toISOString(),
        { useService: true },
      );
      reservations.length = 0;
      reservations.push(...refreshed);
      continue;
    }
    console.error("createReservation/insert", error);
    return actionError("No pudimos crear la reserva.");
  }

  return actionError("No pudimos asignarte una mesa, probá otro horario.");
}

export async function createReservationFromCustomer(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("Necesitás iniciar sesión para reservar.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  const result = await createReservationCommon({
    source: parsed.data.source,
    businessId: business.id,
    timezone: business.timezone,
    userId: user.id,
    customerEmail: user.email ?? null,
    date: parsed.data.date,
    slot: parsed.data.slot,
    partySize: parsed.data.party_size,
    customerName: parsed.data.customer_name,
    customerPhone: parsed.data.customer_phone,
    notes: parsed.data.notes,
    floorPlanId: parsed.data.floor_plan_id ?? null,
  });
  if (result.ok) {
    revalidatePath(`/${parsed.data.business_slug}/reservar`);
    revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
    // spec 27 — avisar al encargado que entró una reserva nueva.
    await createNotification({
      businessId: business.id,
      targetRole: "encargado",
      type: "reserva.nueva",
      payload: {
        fecha: parsed.data.date,
        hora: parsed.data.slot,
        personas: parsed.data.party_size,
        nombre: parsed.data.customer_name,
      },
    });
    // spec 45 — acuse de reserva al cliente por el canal del negocio (best-effort).
    await notifyReservationConfirmed({ reservationId: result.data.id });
  }
  return result;
}

export async function createReservationFromAdmin(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = AdminCreateReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const result = await createReservationCommon({
    source: "admin",
    businessId: business.id,
    timezone: business.timezone,
    userId: null,
    customerEmail: null,
    date: parsed.data.date,
    slot: parsed.data.slot,
    partySize: parsed.data.party_size,
    customerName: parsed.data.customer_name,
    customerPhone: parsed.data.customer_phone,
    notes: parsed.data.notes,
    forcedTableId: parsed.data.table_id ?? null,
  });
  if (result.ok) {
    revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
    // spec 27 — avisar al encargado que se cargó una reserva nueva.
    await createNotification({
      businessId: business.id,
      targetRole: "encargado",
      type: "reserva.nueva",
      payload: {
        fecha: parsed.data.date,
        hora: parsed.data.slot,
        personas: parsed.data.party_size,
        nombre: parsed.data.customer_name,
      },
    });
  }
  return result;
}

/**
 * Spec 059 — crear una reserva en MODO FLEXIBLE (libro de reservas).
 * La mesa es opcional (genérica → se sienta al llegar), la hora es opcional
 * (sin hora → apertura del servicio). Regla dura: una reserva por (mesa,
 * servicio, fecha) — la garantiza el GIST con `ends_at = cierre del servicio`.
 * NO usa `pickTable`. Los 3 canales (web/chatbot/admin) entran acá cuando el
 * negocio está en modo flexible.
 */
export async function createFlexibleReservation(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateFlexibleReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const business = await getBusinessBySlug(data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  // Auth por canal: admin exige permiso de gestión; cliente exige login.
  if (data.source === "admin") {
    if (!user) return actionError("No autenticado.");
    if (!(await canManage(business.id, user.id))) return actionError("Permiso denegado.");
  } else if (!user) {
    return actionError("Necesitás iniciar sesión para reservar.");
  }

  const settings = await getReservationSettings(business.id, { useService: true });
  if (settings.mode !== "flexible") {
    return actionError("Este negocio no usa el modo de reservas flexible.");
  }
  if (data.party_size < 1 || data.party_size > settings.max_party_size) {
    return actionError(`El máximo es ${settings.max_party_size} comensales.`);
  }

  // Servicio + ventana [apertura, cierre].
  const dow = new Date(
    Date.UTC(
      Number(data.date.slice(0, 4)),
      Number(data.date.slice(5, 7)) - 1,
      Number(data.date.slice(8, 10)),
    ),
  ).getUTCDay();
  const svc = await getReservationServiceByName(business.id, data.service, dow, {
    useService: true,
  });
  if (!svc) return actionError("Ese servicio no está disponible ese día.");
  const window = flexibleServiceWindow(data.date, svc, business.timezone);
  if (!window) return actionError("El horario del servicio es inválido.");

  // starts = llegada (si viene) o apertura del servicio; ends = cierre del servicio.
  const starts = data.arrival_time
    ? fromZonedTime(`${data.date}T${data.arrival_time}:00`, business.timezone)
    : window.starts;
  if (Number.isNaN(starts.getTime())) return actionError("Hora inválida.");
  const ends = window.ends;

  // No se puede reservar para un horario que ya pasó (gracia de 5 min por skew).
  if (starts.getTime() < Date.now() - 5 * 60_000) {
    return actionError("Ese horario ya pasó, elegí uno más tarde.");
  }

  // Mesa opcional. Con mesa: valida y deriva la zona. Genérica: usa la zona pedida.
  let tableId: string | null = null;
  let floorPlanId: string | null = data.floor_plan_id ?? null;
  if (data.table_id) {
    const tables = await getAllReservableTables(business.id, { useService: true });
    const target = tables.find((t) => t.id === data.table_id);
    if (!target) return actionError("La mesa seleccionada no existe.");
    if (target.status !== "active") return actionError("La mesa está deshabilitada.");
    if (target.seats < data.party_size) {
      return actionError(
        `La mesa "${target.label}" no tiene capacidad para ${data.party_size} personas.`,
      );
    }
    tableId = target.id;
    floorPlanId = target.floor_plan_id;
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: inserted, error } = await service
    .from("reservations")
    .insert({
      business_id: business.id,
      table_id: tableId,
      floor_plan_id: floorPlanId,
      service: svc.name,
      user_id: data.source === "admin" ? null : user?.id ?? null,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      customer_email: data.source === "admin" ? null : user?.email ?? null,
      party_size: data.party_size,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      status: "confirmed",
      notes: data.notes,
      source: data.source,
    })
    .select("id")
    .single();

  if (error) {
    // GIST con ends_at=cierre → dos en la misma mesa/servicio se pisan (23P01).
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return actionError("La mesa ya está reservada en ese servicio.");
    }
    console.error("createFlexibleReservation", error);
    return actionError("No pudimos crear la reserva.");
  }
  const id = (inserted as { id: string }).id;

  revalidatePath(`/${data.business_slug}/reservar`);
  revalidatePath(`/${data.business_slug}/admin/reservas`);
  await createNotification({
    businessId: business.id,
    targetRole: "encargado",
    type: "reserva.nueva",
    payload: {
      fecha: data.date,
      hora: data.arrival_time ?? svc.name,
      personas: data.party_size,
      nombre: data.customer_name,
    },
  });
  if (data.source !== "admin") {
    await notifyReservationConfirmed({ reservationId: id });
  }
  return actionOk({ id });
}

export async function updateReservationStatus(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = UpdateReservationStatusInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("reservations")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("business_id", business.id);
  if (error) {
    console.error("updateReservationStatus", error);
    return actionError("No pudimos actualizar el estado.");
  }
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  return actionOk(null);
}

/**
 * Sentar una reserva confirmada: marca la mesa como ocupada, crea la order
 * dine_in y actualiza la reserva a "seated". Conecta los dos sistemas
 * (reservas ↔ operación de mesas) usando openTable() compartido.
 */
export async function sentarReserva(
  input: unknown,
): Promise<ActionResult<{ orderId: string | null }>> {
  const parsed = SentarReservaInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Fetch reserva + validar.
  const { data: reservationRow } = await service
    .from("reservations")
    .select("id, table_id, customer_name, customer_phone, party_size, status, notes")
    .eq("id", parsed.data.reservation_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!reservationRow) return actionError("Reserva no encontrada.");
  const reservation = reservationRow as {
    id: string; table_id: string | null; customer_name: string;
    customer_phone: string; party_size: number; status: string; notes: string | null;
  };
  if (reservation.status !== "confirmed") {
    return actionError("Solo se pueden sentar reservas confirmadas.");
  }
  // Spec 059 — reserva GENÉRICA (sin mesa fija, modo flexible): el encargado
  // elige la mesa al sentar (`parsed.data.table_id`). Con mesa fija usa la suya.
  const seatTableId = reservation.table_id ?? parsed.data.table_id ?? null;
  if (!seatTableId) {
    return actionError("Elegí una mesa para sentar la reserva.");
  }

  // Fetch table con cross-tenant validation.
  const { data: tableRow } = await service
    .from("tables")
    .select("id, operational_status, opened_at, mozo_id, floor_plans!inner(business_id)")
    .eq("id", seatTableId)
    .maybeSingle();
  if (!tableRow) return actionError("Mesa no encontrada.");
  const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== business.id) {
    return actionError("Mesa no encontrada.");
  }
  const table = tableRow as {
    id: string; operational_status: string; opened_at: string | null; mozo_id: string | null;
  };

  // Customer upsert por phone.
  let customerId: string | null = null;
  if (reservation.customer_phone) {
    const { data: existing } = await service
      .from("customers")
      .select("id, name")
      .eq("business_id", business.id)
      .eq("phone", reservation.customer_phone)
      .maybeSingle();
    const existingRow = existing as { id: string; name: string | null } | null;
    if (existingRow) {
      customerId = existingRow.id;
      if (reservation.customer_name && reservation.customer_name !== existingRow.name) {
        await service.from("customers").update({ name: reservation.customer_name }).eq("id", existingRow.id);
      }
    } else {
      const { data: created } = await service
        .from("customers")
        .insert({ business_id: business.id, phone: reservation.customer_phone, name: reservation.customer_name })
        .select("id")
        .single();
      if (created) customerId = (created as { id: string }).id;
    }
  }

  // Abrir la mesa (shared con walk-in).
  const openResult = await openTable({
    service,
    businessId: business.id,
    table,
    actorUserId: user.id,
    customerName: reservation.customer_name,
    customerPhone: reservation.customer_phone,
    customerId,
    notes: reservation.notes,
  });
  if (!openResult.ok) return openResult;

  // Marcar reserva como seated. En genéricas, registra la mesa donde se sentó.
  const { error: resErr } = await service
    .from("reservations")
    .update({ status: "seated", table_id: seatTableId })
    .eq("id", reservation.id)
    .eq("business_id", business.id);
  if (resErr) console.error("sentarReserva status update", resErr);

  const slug = parsed.data.business_slug;
  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/admin/reservas`);
  revalidatePath(`/${slug}/mozo`);
  return actionOk({ orderId: openResult.data.orderId });
}

/**
 * Actualizar mesa y/o comensales de una reserva confirmada — atómico.
 * Solo admin/encargado/plataforma. Valida todo cruzado: capacidad de la mesa
 * para el nuevo party_size, solape con otras reservas, cross-tenant, etc.
 * Fuente de verdad de solape: constraint de exclusión en la DB (23P01).
 */
export async function updateReservationDetails(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = UpdateReservationDetailsInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const settings = await getReservationSettings(business.id, { useService: true });
  if (parsed.data.party_size > settings.max_party_size) {
    return actionError(`El máximo es ${settings.max_party_size} comensales.`);
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Fetch reservation + validate state.
  const { data: reservationRow } = await service
    .from("reservations")
    .select("id, table_id, party_size, starts_at, ends_at, status")
    .eq("id", parsed.data.reservation_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!reservationRow) return actionError("Reserva no encontrada.");
  const reservation = reservationRow as {
    id: string; table_id: string | null; party_size: number;
    starts_at: string; ends_at: string; status: string;
  };
  if (reservation.status !== "confirmed") {
    return actionError("Solo se pueden editar reservas confirmadas.");
  }

  const newPartySize = parsed.data.party_size;
  const newTableId = parsed.data.table_id;

  // Fetch target table + cross-tenant validation via floor_plans.
  const { data: tableRow } = await service
    .from("tables")
    .select("id, label, seats, status, floor_plans!inner(business_id)")
    .eq("id", newTableId)
    .maybeSingle();
  if (!tableRow) return actionError("Mesa no encontrada.");
  const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== business.id) {
    return actionError("Mesa no encontrada.");
  }
  const table = tableRow as { id: string; label: string; seats: number; status: string };
  if (table.status !== "active") {
    return actionError("La mesa está deshabilitada.");
  }
  // Cross-validate: new party_size against new table capacity.
  if (table.seats < newPartySize) {
    return actionError(
      `La mesa "${table.label}" tiene ${table.seats} lugares para ${newPartySize} comensales.`,
    );
  }

  // Pre-check overlap (only when table changes).
  const tableChanged = newTableId !== reservation.table_id;
  if (tableChanged) {
    const bufferMs = settings.buffer_min * 60_000;
    const windowStart = new Date(reservation.starts_at);
    const windowEnd = new Date(reservation.ends_at);
    const lookupStart = new Date(windowStart.getTime() - bufferMs);
    const lookupEnd = new Date(windowEnd.getTime() + bufferMs);
    const reservations = await getReservationsInRange(
      business.id,
      lookupStart.toISOString(),
      lookupEnd.toISOString(),
      { useService: true },
    );

    const available = isTableAvailableForReservation({
      tableId: table.id,
      reservations,
      windowStart,
      windowEnd,
      bufferMs,
      excludeReservationId: reservation.id,
    });
    if (!available) {
      return actionError("La mesa ya está reservada en ese horario.");
    }
  }

  // Atomic update.
  const { error } = await service
    .from("reservations")
    .update({ table_id: newTableId, party_size: newPartySize })
    .eq("id", reservation.id)
    .eq("business_id", business.id);
  if (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return actionError("La mesa ya está reservada en ese horario.");
    }
    console.error("updateReservationDetails", error);
    return actionError("No pudimos actualizar la reserva.");
  }

  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  return actionOk(null);
}

export async function cancelOwnReservation(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = CancelOwnReservationInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: reservation } = await service
    .from("reservations")
    .select("id, business_id, user_id, starts_at, status, customer_name")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const r = reservation as Pick<Reservation, "id" | "business_id" | "user_id" | "starts_at" | "status" | "customer_name"> | null;
  if (!r) return actionError("Reserva no encontrada.");
  if (r.user_id !== user.id) return actionError("Permiso denegado.");
  if (r.status === "cancelled" || r.status === "completed" || r.status === "no_show") {
    return actionError("La reserva ya no está activa.");
  }

  const settings = await getReservationSettings(r.business_id, { useService: true });
  const cutoff = new Date(new Date(r.starts_at).getTime() - settings.lead_time_min * 60_000);
  if (Date.now() > cutoff.getTime()) {
    return actionError("Ya pasó la ventana para cancelar online. Avisá al local.");
  }

  const { error } = await service
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", r.id)
    .eq("user_id", user.id);
  if (error) return actionError("No pudimos cancelar la reserva.");

  // spec 27 — avisar al encargado que el cliente canceló su reserva.
  await createNotification({
    businessId: r.business_id,
    targetRole: "encargado",
    type: "reserva.cancelada_cliente",
    payload: { nombre: r.customer_name },
  });

  return actionOk(null);
}
