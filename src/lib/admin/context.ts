import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type BusinessRole = "admin" | "encargado" | "mozo" | "personal";

export type AdminContext = {
  user: User;
  userName?: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  role: BusinessRole | null;
};

/**
 * Ensures the request has a session AND that the user can manage the given
 * business (either via business_users membership or platform admin flag).
 * Redirects to login otherwise. Returns the context for the caller.
 *
 * Envuelta en `cache()` de React (spec 104): el layout admin y la page la
 * llaman por separado en el mismo render, y sin esto cada navegación pagaba
 * **dos** veces el hop de red a Supabase Auth más las dos queries de membresía.
 * Con el dedupe por request no cambia ni un caller y se ahorra la mitad. Mismo
 * truco que ya usa `getBusiness` (`src/lib/tenant.ts`).
 */
export const ensureAdminAccess = cache(async function ensureAdminAccess(
  businessId: string,
  businessSlug: string,
): Promise<AdminContext> {
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
  if (!membership && !isPlatformAdmin) {
    redirect(`/${businessSlug}/admin/login`);
  }

  // Soft-delete: cuenta deshabilitada por un admin no entra al panel.
  // El platform admin nunca queda bloqueado por esto. Ver CU-12.
  const disabledAt =
    (membership as { disabled_at: string | null } | null)?.disabled_at ?? null;
  if (disabledAt && !isPlatformAdmin) {
    redirect(`/${businessSlug}/admin/login?reason=disabled`);
  }

  const userName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined);

  return {
    user,
    userName,
    userEmail: user.email ?? "",
    isPlatformAdmin,
    role: (membership?.role as BusinessRole | undefined) ?? null,
  };
});

/**
 * True when the user can administer the business: edit settings, manage team,
 * change catalog structure, etc. Platform admin always; business admin yes;
 * encargado y mozo no.
 */
export function canManageBusiness(ctx: AdminContext): boolean {
  if (ctx.isPlatformAdmin) return true;
  return ctx.role === "admin";
}

