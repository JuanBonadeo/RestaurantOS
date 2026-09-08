import "server-only";

import type { AdminContext } from "@/lib/admin/context";
import type { BusinessRole } from "@/lib/admin/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Lecturas de la guía — spec 169 (#255).

/**
 * Con qué rol se mira la guía.
 *
 * El platform admin entra sin membresía (`role: null`) y tiene que ver la guía
 * completa: es quien la manda a leer. Mismo criterio que usa el layout para las
 * notificaciones.
 */
export function rolDeLaGuia(ctx: AdminContext): BusinessRole | null {
  return ctx.role ?? (ctx.isPlatformAdmin ? "admin" : null);
}

/**
 * Los temas que esta persona ya leyó en ESTE negocio.
 *
 * Va con el cliente de la sesión y no con el de servicio: la RLS de
 * `ayuda_lecturas` (0075) es la que garantiza que nadie lea el progreso de otro,
 * y usarla de verdad es lo único que la mantiene honesta. El `user_id` se filtra
 * igual, explícito — la policy ya lo hace, pero deja la query correcta si algún
 * día alguien la mueve a un cliente de servicio.
 *
 * Nunca tira: que la guía no sepa cuánto leíste es un problema menor, y no es
 * motivo para romper el layout del panel entero.
 */
export async function getTemasLeidos(
  businessId: string,
  userId: string,
): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ayuda_lecturas")
    .select("tema")
    .eq("business_id", businessId)
    .eq("user_id", userId);

  if (error || !data) return new Set();
  return new Set(data.map((fila) => fila.tema));
}
