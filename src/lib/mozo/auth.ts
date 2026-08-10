import "server-only";

import { cache } from "react";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import type { BusinessRole } from "@/lib/admin/context";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type MozoContext = {
  user: User;
  userName?: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  role: BusinessRole;
};

/**
 * Espejo de ensureAdminAccess pero para la vista operativa de salón.
 * Roles permitidos: admin, encargado, mozo. El platform admin entra siempre.
 *
 * No es un superset del admin: existe por separado para que el día que admin
 * agregue restricciones de billing o setup, no rompa la operación de salón.
 *
 * Envuelta en `cache()` de React (spec 104), igual que `ensureAdminAccess`: si
 * en el mismo render la llaman la page y algún componente anidado, el hop de
 * red a Supabase Auth y las dos queries de membresía se pagan una sola vez.
 */
export const ensureMozoAccess = cache(async function ensureMozoAccess(
  businessId: string,
  businessSlug: string,
): Promise<MozoContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${businessSlug}/admin/login`);

  const service = createSupabaseServiceClient();
  const [{ data: membership }, { data: profile }] = await Promise.all([
    service
      .from("business_users")
      .select("role, disabled_at")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle(),
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const membershipRow = membership as
    | { role: string; disabled_at: string | null }
    | null;

  if (!membershipRow && !isPlatformAdmin) {
    redirect(`/${businessSlug}/admin/login`);
  }

  if (membershipRow?.disabled_at && !isPlatformAdmin) {
    redirect(`/${businessSlug}/admin/login?reason=disabled`);
  }

  const rawRole = membershipRow?.role ?? null;
  const isAllowedRole =
    rawRole === "admin" || rawRole === "encargado" || rawRole === "mozo";
  if (!isAllowedRole && !isPlatformAdmin) {
    redirect(`/${businessSlug}/admin/login`);
  }

  // El platform admin sin membership hereda 'admin' funcional para la vista.
  const role: BusinessRole = isAllowedRole
    ? (rawRole as BusinessRole)
    : "admin";

  const userName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined);

  return {
    user,
    userName,
    userEmail: user.email ?? "",
    isPlatformAdmin,
    role,
  };
});

export type MozoActionContext = {
  userId: string;
  role: BusinessRole;
  isPlatformAdmin: boolean;
};

/**
 * Variante para server actions. No redirige (el redirect en una action no
 * sirve porque ya se ejecutó la mutación intent); devuelve un ActionResult
 * que el caller propaga al cliente como toast.error.
 *
 * Uso: como primer paso de cualquier action operativa de salón.
 */
export async function requireMozoActionContext(
  businessId: string,
): Promise<ActionResult<MozoActionContext>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("Sesión expirada. Iniciá sesión nuevamente.");

  const service = createSupabaseServiceClient();
  const [{ data: membership }, { data: profile }] = await Promise.all([
    service
      .from("business_users")
      .select("role, disabled_at")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle(),
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const membershipRow = membership as
    | { role: string; disabled_at: string | null }
    | null;

  if (!membershipRow && !isPlatformAdmin) {
    return actionError("No tenés acceso a este negocio.");
  }
  if (membershipRow?.disabled_at && !isPlatformAdmin) {
    return actionError("Tu cuenta está deshabilitada.");
  }

  const rawRole = membershipRow?.role ?? null;
  const isAllowedRole =
    rawRole === "admin" || rawRole === "encargado" || rawRole === "mozo";
  if (!isAllowedRole && !isPlatformAdmin) {
    return actionError("No tenés permisos para esta operación.");
  }

  const role: BusinessRole = isAllowedRole
    ? (rawRole as BusinessRole)
    : "admin";

  return actionOk({ userId: user.id, role, isPlatformAdmin });
}
