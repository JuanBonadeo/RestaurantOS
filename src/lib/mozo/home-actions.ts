"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { loadMozoHome, type MozoHomeData } from "./home-data";

/**
 * Refetch acotado del home del mozo (spec 107).
 *
 * Reemplaza a los `router.refresh()` que el cliente disparaba después de cada
 * acción de mesa —anular, walk-in, transferir, trasladar, tomar una mesa— y en
 * cada evento de realtime. Cada uno de esos re-ejecutaba `mozo/page.tsx`
 * entera: `ensureMozoAccess` + las **8** queries del `Promise.all`, incluidas
 * las notificaciones, las propinas del día y el fichaje, que ninguna de esas
 * acciones toca. Acá corren sólo las 4 que sí cambian, y el cliente las mergea.
 *
 * Gate de membresía: `loadMozoHome` corre con el cliente service-role (RLS
 * bypass) y devuelve el plano, las reservas con teléfono y la nómina de mozos.
 */
export async function getMozoHomeData(
  slug: string,
): Promise<ActionResult<MozoHomeData>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await requireMozoActionContext(business.id);
  if (!ctx.ok) return ctx;

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  return actionOk(await loadMozoHome(business.id, service));
}
