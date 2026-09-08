import { createClient } from "@supabase/supabase-js";

import { assertStackLocal } from "./guard-local";

/**
 * Cliente de servicio contra el stack LOCAL, sólo para **derivar lo esperado y
 * verificar el efecto** — nunca para actuar en lugar del usuario.
 *
 * Los E2E no hardcodean números: el seed usa `Math.random()` para armar la
 * operación del día, así que un `expect(total).toBe(127500)` pasaría hoy y
 * fallaría mañana por una razón que no es un bug. Se lee de la base qué tiene
 * que decir la pantalla, y se compara. Un test que no es determinista miente
 * las dos veces: cuando pasa y cuando falla.
 *
 * Ojo con usarlo para permisos o RLS: ahí el service_role no prueba nada —
 * eso se prueba con la sesión del rol real.
 */
const { url, serviceKey } = assertStackLocal();

export const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function businessId(slug: string): Promise<string> {
  const { data } = await db
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .single();
  return (data as { id: string }).id;
}

/** Formato AR, el mismo que muestra la app: $ 127.500 */
export function pesos(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
