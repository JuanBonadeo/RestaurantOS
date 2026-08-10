"use server";

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireMozoActionContext } from "@/lib/mozo/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { startOfTodayUtc } from "@/lib/admin/orders-query";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  loadCaja,
  loadFichaje,
  loadRendicion,
  loadReservas,
  loadSalon,
  type CajaData,
  type FichajeData,
  type RendicionData,
  type ReservasData,
  type SalonData,
} from "./data";

/**
 * Refetch por tab de `/admin/operacion` (specs 102 y 103).
 *
 * Antes, cada acción del operativo y cada evento de realtime resolvían con
 * `router.refresh()`, que re-ejecuta `operacion/page.tsx` **entera**:
 * `getBusiness` + `ensureAdminAccess` (hop de red a Auth) + `getSalonOptions` +
 * las **7 promesas de tab** (~30 queries) y el árbol RSC completo por el cable
 * a Virginia — para actualizar una sola tab. Acá cada tab corre lo suyo con el
 * mismo loader que usa la page, y el cliente mergea en su estado local. Mismo
 * patrón que `getComandasTabData` (spec 052).
 */

type OperacionCtx = { businessId: string; timezone: string };

/**
 * Gate común de todas las actions de esta ruta. Dos capas, las dos necesarias:
 *
 * 1. **Membresía** — los loaders corren con el cliente service-role (RLS
 *    bypass), así que sin esto un autenticado ajeno al negocio leería el plano,
 *    las reservas con teléfono, la caja y la nómina pasando un slug foráneo. Es
 *    la lección de la 2da ronda de review de la spec 052.
 * 2. **Rol** — el mismo que aplica `operacion/page.tsx`: sólo encargado, admin o
 *    platform admin. El mozo opera desde `/mozo` y no tiene por qué leer la
 *    caja del turno ni lo que rindieron sus compañeros. Sin esta capa la action
 *    sería una puerta de atrás a una pantalla que la UI le niega.
 */
async function requireOperacionContext(
  slug: string,
): Promise<ActionResult<OperacionCtx>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await requireMozoActionContext(business.id);
  if (!ctx.ok) return ctx;

  const { role, isPlatformAdmin } = ctx.data;
  if (!isPlatformAdmin && role !== "admin" && role !== "encargado") {
    return actionError("No tenés permisos para esta operación.");
  }

  return actionOk({ businessId: business.id, timezone: business.timezone });
}

const service = () =>
  createSupabaseServiceClient() as unknown as SupabaseClient;

/**
 * Tab **Mesas** (plano del salón). La ventana de reservas se calcula igual que
 * en la page: "hoy" en la TZ del **negocio**, no la del server, para que no se
 * corra en el borde de la medianoche.
 */
export async function getSalonTabData(
  slug: string,
): Promise<ActionResult<SalonData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;

  const todayStart = startOfTodayUtc(ctx.data.timezone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  return actionOk(
    await loadSalon(ctx.data.businessId, service(), {
      todayStart,
      tomorrowStart,
    }),
  );
}

/** Tab **Caja**: las cajas del negocio con su estado (último corte, período). */
export async function getCajaTabData(
  slug: string,
): Promise<ActionResult<CajaData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;
  return actionOk(await loadCaja(ctx.data.businessId));
}

/** Tab **Rendición**: pendientes por mozo, historial, asignaciones y nómina. */
export async function getRendicionTabData(
  slug: string,
): Promise<ActionResult<RendicionData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;
  return actionOk(await loadRendicion(ctx.data.businessId, service()));
}

/**
 * Tab **Reservas** (libro del día). Recibe el día porque el navegador de fechas
 * ahora lo cambia sin navegar: antes cada flecha era un `router.push` que
 * re-corría las 7 tabs para pintar otra lista.
 *
 * Un `date` inválido cae en "hoy" en la TZ del negocio — mismo criterio que la
 * page, así no hay forma de pedir una ventana sin sentido desde el cliente.
 */
export async function getReservasTabData(
  slug: string,
  date: string,
): Promise<ActionResult<ReservasData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;

  const { businessId, timezone } = ctx.data;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${dia}T00:00:00`, timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  return actionOk(
    await loadReservas(businessId, service(), { date: dia, dayStart, dayEnd }),
  );
}

/** Tab **Fichaje**: quién está presente ahora + el resumen del día. */
export async function getFichajeTabData(
  slug: string,
): Promise<ActionResult<FichajeData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;
  return actionOk(await loadFichaje(ctx.data.businessId, slug));
}
