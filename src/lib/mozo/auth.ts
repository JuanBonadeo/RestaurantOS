import "server-only";

import { cache } from "react";

import { redirect } from "next/navigation";

import type { BusinessRole } from "@/lib/admin/context";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type MozoContext = {
  /** Id del usuario autenticado (spec 106). Antes era el `User` entero. */
  userId: string;
  userName?: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  role: BusinessRole;
};

/**
 * Espejo de ensureAdminAccess pero para la vista operativa de salón.
 * Roles permitidos: admin, encargado, mozo y `terminal` (spec 140 — el puesto
 * compartido del salón, que opera las mismas mesas desde el panel). El
 * platform admin entra siempre.
 *
 * No es un superset del admin: existe por separado para que el día que admin
 * agregue restricciones de billing o setup, no rompa la operación de salón.
 *
 * Envuelta en `cache()` de React (spec 104), igual que `ensureAdminAccess`: si
 * en el mismo render la llaman la page y algún componente anidado, la
 * verificación de sesión y las dos queries de membresía se pagan una sola vez.
 *
 * La identidad sale de `getClaims()` (spec 106): firma verificada local, sin
 * red. El gate —membresía, `disabled_at`, rol— sigue yendo a la DB en cada
 * request, que es lo que puede cambiar con la sesión viva.
 */
export const ensureMozoAccess = cache(async function ensureMozoAccess(
  businessId: string,
  businessSlug: string,
): Promise<MozoContext> {
  const supabase = await createSupabaseServerClient();
  const { data: verified } = await supabase.auth.getClaims();
  if (!verified) redirect(`/${businessSlug}/admin/login`);
  const claims = verified.claims;
  const userId = claims.sub;

  const service = createSupabaseServiceClient();
  const [{ data: membership }, { data: profile }] = await Promise.all([
    service
      .from("business_users")
      .select("role, disabled_at")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", userId)
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
    rawRole === "admin" ||
    rawRole === "encargado" ||
    rawRole === "mozo" ||
    rawRole === "terminal";
  if (!isAllowedRole && !isPlatformAdmin) {
    redirect(`/${businessSlug}/admin/login`);
  }

  // El platform admin sin membership hereda 'admin' funcional para la vista.
  const role: BusinessRole = isAllowedRole
    ? (rawRole as BusinessRole)
    : "admin";

  const userName =
    (claims.user_metadata?.full_name as string | undefined) ??
    (claims.user_metadata?.name as string | undefined);

  return {
    userId,
    userName,
    userEmail: claims.email ?? "",
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
 *
 * Identidad por `getClaims()` (spec 106): esto corre en CADA action del salón
 * —abrir mesa, enviar comanda, cobrar—, así que el hop de red a GoTrue se
 * pagaba en medio de cada gesto del turno. El gate de membresía sigue yendo a
 * la DB, que es lo que puede haber cambiado desde que se emitió el token.
 */
export async function requireMozoActionContext(
  businessId: string,
): Promise<ActionResult<MozoActionContext>> {
  const supabase = await createSupabaseServerClient();
  const { data: verified } = await supabase.auth.getClaims();
  if (!verified) return actionError("Sesión expirada. Iniciá sesión nuevamente.");
  const userId = verified.claims.sub;

  const service = createSupabaseServiceClient();
  const [{ data: membership }, { data: profile }] = await Promise.all([
    service
      .from("business_users")
      .select("role, disabled_at")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", userId)
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
    rawRole === "admin" ||
    rawRole === "encargado" ||
    rawRole === "mozo" ||
    rawRole === "terminal";
  if (!isAllowedRole && !isPlatformAdmin) {
    return actionError("No tenés permisos para esta operación.");
  }

  const role: BusinessRole = isAllowedRole
    ? (rawRole as BusinessRole)
    : "admin";

  return actionOk({ userId, role, isPlatformAdmin });
}
