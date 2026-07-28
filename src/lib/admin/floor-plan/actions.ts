"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { SaveFloorPlanInputSchema } from "@/lib/reservations/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

async function assertCanManage(businessSlug: string) {
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

  const [{ data: profile }, { data: membership }] = await Promise.all([
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle(),
    service
      .from("business_users")
      .select("role")
      .eq("business_id", business.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isPlatformAdmin = (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin ?? false;
  const role = (membership as { role?: string } | null)?.role ?? null;
  // Espejo de `sectionAccess("salones", role)`: admin y encargado gestionan el
  // plano del salón (decisión 2026-07-28). Mozo/personal no.
  const canManage = role === "admin" || role === "encargado";
  if (!isPlatformAdmin && !canManage) {
    return { ok: false as const, error: "Permiso denegado." };
  }
  return { ok: true as const, businessId: business.id as string };
}

/**
 * Replaces the floor plan tables in one transaction-ish flow:
 *   1) upsert plan dimensions and name
 *   2) delete tables not present in the input
 *   3) update existing tables (matched by id)
 *   4) insert new tables (no id)
 *
 * Not strictly atomic without an RPC, but the failure modes are bounded:
 * if step 2 succeeds and step 3/4 fails the user retries the save with the
 * same payload. Reservations on deleted tables get table_id=NULL via the FK
 * on delete set null, so historic data stays.
 */
export async function saveFloorPlan(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = SaveFloorPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const guard = await assertCanManage(parsed.data.business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // 1) upsert plan. Si vino `floor_plan_id` explícito, lo usa (multi-salón).
  // Sino, fallback al legacy: primer plano del business o crear uno.
  let planId: string;
  if (parsed.data.floor_plan_id) {
    // Validación cross-tenant: debe pertenecer a este business.
    const { data: target } = await service
      .from("floor_plans")
      .select("id, business_id")
      .eq("id", parsed.data.floor_plan_id)
      .maybeSingle();
    if (
      !target ||
      (target as { business_id: string }).business_id !== guard.businessId
    ) {
      return actionError("Salón no encontrado.");
    }
    planId = (target as { id: string }).id;
    const { error } = await service
      .from("floor_plans")
      .update({
        name: parsed.data.name,
        width: parsed.data.width,
        height: parsed.data.height,
        background_image_url: parsed.data.background_image_url,
        background_opacity: parsed.data.background_opacity,
      })
      .eq("id", planId);
    if (error) {
      console.error("saveFloorPlan/update plan", error);
      return actionError("No pudimos guardar el plano.");
    }
  } else {
    const { data: existingPlan } = await service
      .from("floor_plans")
      .select("id")
      .eq("business_id", guard.businessId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingPlan) {
      planId = (existingPlan as { id: string }).id;
      const { error } = await service
        .from("floor_plans")
        .update({
          name: parsed.data.name,
          width: parsed.data.width,
          height: parsed.data.height,
          background_image_url: parsed.data.background_image_url,
          background_opacity: parsed.data.background_opacity,
        })
        .eq("id", planId);
      if (error) {
        console.error("saveFloorPlan/update plan", error);
        return actionError("No pudimos guardar el plano.");
      }
    } else {
      const { data, error } = await service
        .from("floor_plans")
        .insert({
          business_id: guard.businessId,
          name: parsed.data.name,
          width: parsed.data.width,
          height: parsed.data.height,
          background_image_url: parsed.data.background_image_url,
          background_opacity: parsed.data.background_opacity,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("saveFloorPlan/insert plan", error);
        return actionError("No pudimos crear el plano.");
      }
      planId = (data as { id: string }).id;
    }
  }

  // 2) delete tables not in input
  const inputIds = parsed.data.tables.filter((t) => t.id).map((t) => t.id as string);
  let deleteQuery = service.from("tables").delete().eq("floor_plan_id", planId);
  if (inputIds.length > 0) {
    deleteQuery = deleteQuery.not("id", "in", `(${inputIds.join(",")})`);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    console.error("saveFloorPlan/delete", deleteError);
    return actionError("No pudimos limpiar las mesas eliminadas.");
  }

  // 3) update existing
  for (const t of parsed.data.tables) {
    if (!t.id) continue;
    const { error } = await service
      .from("tables")
      .update({
        label: t.label,
        seats: t.seats,
        shape: t.shape,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        status: t.status,
        is_bar: t.is_bar,
      })
      .eq("id", t.id)
      .eq("floor_plan_id", planId);
    if (error) {
      console.error("saveFloorPlan/update table", error);
      return actionError(`No pudimos actualizar la mesa "${t.label}".`);
    }
  }

  // 4) insert new
  const newRows = parsed.data.tables
    .filter((t) => !t.id)
    .map((t) => ({
      floor_plan_id: planId,
      label: t.label,
      seats: t.seats,
      shape: t.shape,
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      status: t.status,
      is_bar: t.is_bar,
    }));
  if (newRows.length > 0) {
    const { error } = await service.from("tables").insert(newRows);
    if (error) {
      console.error("saveFloorPlan/insert tables", error);
      return actionError("No pudimos crear las mesas nuevas.");
    }
  }

  revalidatePath(`/${parsed.data.business_slug}/admin/reservas/plano`);
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  revalidatePath(`/${parsed.data.business_slug}/admin/salones`);
  return actionOk({ id: planId });
}

/**
 * Crea un nuevo floor_plan vacío para el business. Devuelve el id para que
 * el caller redirija al editor.
 */
export async function createFloorPlan(
  businessSlug: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (!trimmed) return actionError("El nombre es obligatorio.");

  const guard = await assertCanManage(businessSlug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("floor_plans")
    .insert({
      business_id: guard.businessId,
      name: trimmed,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createFloorPlan", error);
    return actionError("No pudimos crear el salón.");
  }
  revalidatePath(`/${businessSlug}/admin/salones`);
  return actionOk({ id: (data as { id: string }).id });
}

/**
 * Borra un floor_plan. Cascade hace el resto: las `tables` se borran (FK
 * cascade), las `reservations` que apuntaban a esas tables quedan con
 * `table_id=null` (FK set null) preservando el histórico.
 *
 * Validación: no permitimos borrar el último floor_plan del business — un
 * negocio sin salones rompe la UI mozo. El caller puede crear uno nuevo
 * antes de borrar este.
 */
export async function deleteFloorPlan(
  planId: string,
  businessSlug: string,
): Promise<ActionResult<null>> {
  const guard = await assertCanManage(businessSlug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Validar pertenencia + count.
  const { data: target } = await service
    .from("floor_plans")
    .select("id, business_id")
    .eq("id", planId)
    .maybeSingle();
  if (
    !target ||
    (target as { business_id: string }).business_id !== guard.businessId
  ) {
    return actionError("Salón no encontrado.");
  }
  const { count } = await service
    .from("floor_plans")
    .select("id", { count: "exact", head: true })
    .eq("business_id", guard.businessId);
  if ((count ?? 0) <= 1) {
    return actionError(
      "No podés borrar el único salón. Creá otro antes si querés reemplazarlo.",
    );
  }

  const { error } = await service.from("floor_plans").delete().eq("id", planId);
  if (error) {
    console.error("deleteFloorPlan", error);
    return actionError("No pudimos borrar el salón.");
  }
  revalidatePath(`/${businessSlug}/admin/salones`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(null);
}
