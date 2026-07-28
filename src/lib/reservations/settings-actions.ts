"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canConfigureReservations } from "@/lib/permissions/can";
import { getReservationActor } from "@/lib/reservations/queries";
import {
  DeleteReservationServiceGroupInputSchema,
  DeleteReservationServiceInputSchema,
  ReservationServiceGroupInputSchema,
  ReservationServiceInputSchema,
  ReservationSettingsInputSchema,
  SetReservationModeInputSchema,
} from "@/lib/reservations/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

/**
 * Autoriza configurar el motor de reservas (horarios/buffer/etc.):
 * admin/encargado o platform admin (spec 22). El mozo gestiona reservas pero
 * no cambia las reglas.
 */
async function assertCanConfigure(businessSlug: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "No autenticado." };

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .maybeSingle();
  if (!business) return { ok: false as const, error: "Negocio no encontrado." };

  const businessId = (business as { id: string }).id;
  const { role, isPlatformAdmin } = await getReservationActor(businessId, user.id);
  if (!isPlatformAdmin && !canConfigureReservations(role)) {
    return { ok: false as const, error: "Permiso denegado." };
  }
  return { ok: true as const, businessId };
}

export async function saveReservationSettings(input: unknown): Promise<ActionResult<null>> {
  const parsed = ReservationSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const guard = await assertCanConfigure(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service.from("reservation_settings").upsert(
    {
      business_id: guard.businessId,
      slot_duration_min: parsed.data.slot_duration_min,
      buffer_min: parsed.data.buffer_min,
      lead_time_min: parsed.data.lead_time_min,
      advance_days_max: parsed.data.advance_days_max,
      max_party_size: parsed.data.max_party_size,
      no_show_grace_min: parsed.data.no_show_grace_min,
      schedule: parsed.data.schedule,
      ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
    },
    { onConflict: "business_id" },
  );
  if (error) {
    console.error("saveReservationSettings", error);
    return actionError("No pudimos guardar la configuración.");
  }

  revalidatePath(`/${parsed.data.business_slug}/admin/reservas/configuracion`);
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  revalidatePath(`/${parsed.data.business_slug}/reservar`);
  return actionOk(null);
}

// ── Spec 059 · modo flexible: toggle de modo + CRUD de servicios ─────────────

/** Cambiar el modo de reservas del negocio (estricto ↔ flexible). */
export async function setReservationMode(input: unknown): Promise<ActionResult<null>> {
  const parsed = SetReservationModeInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const guard = await assertCanConfigure(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("reservation_settings")
    .upsert({ business_id: guard.businessId, mode: parsed.data.mode }, { onConflict: "business_id" });
  if (error) {
    console.error("setReservationMode", error);
    return actionError("No pudimos cambiar el modo de reservas.");
  }
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas/configuracion`);
  revalidatePath(`/${parsed.data.business_slug}/reservar`);
  return actionOk(null);
}

/** Crear o editar un servicio (Mediodía/Cena…) del modo flexible. */
export async function saveReservationService(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = ReservationServiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const guard = await assertCanConfigure(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const row = {
    business_id: guard.businessId,
    name: parsed.data.name,
    day_of_week: parsed.data.day_of_week ?? null,
    opens_at: parsed.data.opens_at,
    closes_at: parsed.data.closes_at,
    soft_capacity: parsed.data.soft_capacity ?? null,
    floor_plan_id: parsed.data.floor_plan_id ?? null,
  };

  let id = parsed.data.id ?? null;
  if (id) {
    const { error } = await service
      .from("reservation_services")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("business_id", guard.businessId);
    if (error) {
      console.error("saveReservationService/update", error);
      return actionError("No pudimos guardar el servicio.");
    }
  } else {
    const { data, error } = await service
      .from("reservation_services")
      .insert(row)
      .select("id")
      .single();
    if (error || !data) {
      console.error("saveReservationService/insert", error);
      return actionError("No pudimos crear el servicio.");
    }
    id = (data as { id: string }).id;
  }

  revalidatePath(`/${parsed.data.business_slug}/admin/reservas/configuracion`);
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  revalidatePath(`/${parsed.data.business_slug}/reservar`);
  return actionOk({ id });
}

/**
 * Alta/edición de un servicio para VARIOS días de una sola vez (spec 059).
 * El grupo se identifica por (nombre, zona) y se **reescribe entero**: se borran
 * sus filas y se insertan las de los días elegidos. Efectos deseados:
 *  - un solo formulario para "Cena, martes a domingo, 20:00–22:30";
 *  - editar días/horarios sin tocar fila por fila;
 *  - los duplicados del mismo (nombre, zona) quedan limpios solos.
 * No rompe reservas existentes: `reservations.service` guarda el NOMBRE, no el id.
 */
export async function saveReservationServiceGroup(
  input: unknown,
): Promise<ActionResult<{ rows: number }>> {
  const parsed = ReservationServiceGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const guard = await assertCanConfigure(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const d = parsed.data;
  const zoneId = d.floor_plan_id ?? null;
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Borrar el grupo anterior (por nombre previo si se renombró) en esa zona.
  let del = service
    .from("reservation_services")
    .delete()
    .eq("business_id", guard.businessId)
    .eq("name", d.previous_name?.trim() || d.name);
  del = zoneId ? del.eq("floor_plan_id", zoneId) : del.is("floor_plan_id", null);
  const { error: delError } = await del;
  if (delError) {
    console.error("saveReservationServiceGroup/delete", delError);
    return actionError("No pudimos guardar el servicio.");
  }

  const base = {
    business_id: guard.businessId,
    name: d.name,
    opens_at: d.opens_at,
    closes_at: d.closes_at,
    soft_capacity: d.soft_capacity ?? null,
    floor_plan_id: zoneId,
  };
  // `every_day` = una fila con day_of_week NULL (aplica a todos los días).
  const rows = d.every_day
    ? [{ ...base, day_of_week: null }]
    : Array.from(new Set(d.days)).map((day) => ({ ...base, day_of_week: day }));

  const { error } = await service.from("reservation_services").insert(rows);
  if (error) {
    console.error("saveReservationServiceGroup/insert", error);
    return actionError("No pudimos guardar el servicio.");
  }

  revalidatePath(`/${d.business_slug}/admin/reservas/configuracion`);
  revalidatePath(`/${d.business_slug}/admin/reservas`);
  revalidatePath(`/${d.business_slug}/reservar`);
  return actionOk({ rows: rows.length });
}

/** Eliminar un servicio completo (todas sus filas de esa zona). */
export async function deleteReservationServiceGroup(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = DeleteReservationServiceGroupInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const guard = await assertCanConfigure(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const zoneId = parsed.data.floor_plan_id ?? null;
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  let del = service
    .from("reservation_services")
    .delete()
    .eq("business_id", guard.businessId)
    .eq("name", parsed.data.name);
  del = zoneId ? del.eq("floor_plan_id", zoneId) : del.is("floor_plan_id", null);
  const { error } = await del;
  if (error) {
    console.error("deleteReservationServiceGroup", error);
    return actionError("No pudimos eliminar el servicio.");
  }
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas/configuracion`);
  revalidatePath(`/${parsed.data.business_slug}/reservar`);
  return actionOk(null);
}

/** Eliminar un servicio del modo flexible. */
export async function deleteReservationService(input: unknown): Promise<ActionResult<null>> {
  const parsed = DeleteReservationServiceInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const guard = await assertCanConfigure(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("reservation_services")
    .delete()
    .eq("id", parsed.data.id)
    .eq("business_id", guard.businessId);
  if (error) {
    console.error("deleteReservationService", error);
    return actionError("No pudimos eliminar el servicio.");
  }
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas/configuracion`);
  return actionOk(null);
}
