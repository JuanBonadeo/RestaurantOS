import "server-only";

import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canManageProveedores } from "@/lib/permissions/can";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * El gate del módulo de proveedores, fuera de `actions.ts` — spec 172.
 *
 * `actions.ts` es `"use server"`: todo lo que exporta tiene que ser una async
 * function invocable desde el cliente, así que no puede compartir helpers con un
 * Route Handler. El lector de facturas necesita exactamente el mismo gate, y
 * copiarlo sería la quinta copia del patrón — con el riesgo de que una se quede
 * atrás justo en la parte que decide quién toca la plata de un negocio.
 *
 * TODO(172): `actions.ts` todavía define su propia copia. Unificar cuando el
 * árbol esté libre — hoy ese archivo lo está tocando otra sesión.
 */
export async function getBusinessIdBySlug(slug: string): Promise<string | null> {
  const { data } = await createSupabaseServiceClient()
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

export async function requireProveedorContext(
  businessId: string,
): Promise<ActionResult<{ userId: string; role: string; isPlatformAdmin: boolean }>> {
  const ctxResult = await requireMozoActionContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const ctx = ctxResult.data;
  if (!canManageProveedores(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo admin o encargado pueden gestionar proveedores.");
  }
  return actionOk({
    userId: ctx.userId,
    role: ctx.role,
    isPlatformAdmin: ctx.isPlatformAdmin,
  });
}
