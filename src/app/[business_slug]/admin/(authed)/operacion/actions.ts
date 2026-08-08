"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireMozoActionContext } from "@/lib/mozo/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { startOfTodayUtc } from "@/lib/admin/orders-query";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { loadSalon, type SalonData } from "./data";

/**
 * Refetch acotado de la tab **Mesas** (plano del salón).
 *
 * Reemplaza a los 10 `router.refresh()` de `salon-desktop` y al de los dos
 * hooks de realtime. Cada uno de esos re-ejecutaba `operacion/page.tsx`
 * entera —`getBusiness` + `ensureAdminAccess` (hop de red a Auth) +
 * `getSalonOptions` + las **7** promesas de tab, ~30 queries— y remandaba el
 * payload RSC de todo el árbol para actualizar el plano. Acá corren sólo las
 * **5 queries de esta tab** (las mismas de `loadSalon`) y el cliente mergea en
 * su estado local: mismo patrón que `getComandasTabData` (spec 052).
 *
 * La ventana de reservas se calcula igual que en la page: "hoy" en la TZ del
 * **negocio**, no la del server, para que no se corra en el borde de la
 * medianoche.
 *
 * Multi-tenant: el gate de **membresía** va antes de tocar cualquier query y no
 * es opcional. `loadSalon` corre con el cliente service-role (RLS bypass) y
 * `getMozosByBusiness` filtra sólo por `business_id`, así que sin el gate un
 * autenticado ajeno al negocio podría leer la nómina del staff y el plano
 * entero pasando un slug foráneo. Es la lección de la 2da ronda de review de la
 * spec 052 — toda action que llame una query service-role necesita el gate.
 */
export async function getSalonTabData(
  slug: string,
): Promise<ActionResult<SalonData>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await requireMozoActionContext(business.id);
  if (!ctx.ok) return ctx;

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const todayStart = startOfTodayUtc(business.timezone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  return actionOk(
    await loadSalon(business.id, service, { todayStart, tomorrowStart }),
  );
}
