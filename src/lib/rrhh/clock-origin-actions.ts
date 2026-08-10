"use server";

import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { isValidCidr } from "./ip-allowlist";

export type ClockOrigin = {
  id: string;
  cidr: string;
  label: string | null;
  created_at: string;
};

function revalidate(slug: string) {
  revalidatePath(`/${slug}/admin/configuracion`);
}

/**
 * Agrega un origen (IP/CIDR de la LAN del local) a la allowlist de fichaje del
 * negocio. Sólo `admin` (o platform admin). Valida el formato CIDR con Zod-ish
 * `isValidCidr` antes de persistir. Scope `business_id`.
 */
export async function addClockOrigin(input: {
  slug: string;
  cidr: string;
  label?: string;
}): Promise<ActionResult<{ ok: true }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, input.slug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar el fichaje.");
  }

  const cidr = input.cidr.trim();
  if (!isValidCidr(cidr)) {
    return actionError(
      "Formato inválido. Usá una IP (192.168.10.42) o un rango CIDR (192.168.10.0/24).",
    );
  }

  const label = input.label?.trim() || null;

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { error } = await service.from("clock_allowed_origins").insert({
    business_id: business.id,
    cidr,
    label,
    created_by: ctx.userId,
  });

  if (error) {
    if (error.code === "23505") {
      return actionError("Ese origen ya está en la lista.");
    }
    return actionError(`Error guardando el origen: ${error.message}`);
  }

  revalidate(input.slug);
  return actionOk({ ok: true as const });
}

/**
 * Elimina un origen de la allowlist de fichaje. Sólo `admin`. Scope
 * `business_id` (no se puede borrar un origen de otro negocio).
 */
export async function removeClockOrigin(input: {
  slug: string;
  id: string;
}): Promise<ActionResult<{ ok: true }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, input.slug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar el fichaje.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { error } = await service
    .from("clock_allowed_origins")
    .delete()
    .eq("id", input.id)
    .eq("business_id", business.id);

  if (error) return actionError(`Error eliminando el origen: ${error.message}`);

  revalidate(input.slug);
  return actionOk({ ok: true as const });
}

/** Lista los orígenes autorizados de un negocio (para el panel admin). */
export async function listClockOrigins(
  businessId: string,
): Promise<ClockOrigin[]> {
  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await service
    .from("clock_allowed_origins")
    .select("id, cidr, label, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  return (data as ClockOrigin[] | null) ?? [];
}
