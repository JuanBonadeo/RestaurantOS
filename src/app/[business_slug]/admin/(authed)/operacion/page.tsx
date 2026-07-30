import { notFound, redirect } from "next/navigation";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LocalShell } from "@/components/admin/local/local-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getSalonOptions } from "@/lib/admin/floor-plan/queries";
import { startOfTodayUtc } from "@/lib/admin/orders-query";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  loadCaja,
  loadComandas,
  loadFichaje,
  loadPedidos,
  loadRendicion,
  loadReservas,
  loadSalon,
} from "./data";

export default async function LocalEnVivoPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  const { business_slug } = await params;
  const { date: dateQuery } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // FR-008: auth + gating de rol se resuelven ANTES de crear cualquier promesa
  // de datos, de modo que la redirección por falta de permiso ocurra sin abrir
  // ningún boundary de streaming (un redirect() post-stream fallaría y
  // expondría contenido protegido).
  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Solo encargado / admin / platform admin. Mozo opera desde /mozo.
  if (!ctx.isPlatformAdmin && ctx.role !== "admin" && ctx.role !== "encargado") {
    redirect(`/${business_slug}/mozo`);
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  // Spec 065: el selector de salón vive en la barra de tabs, que no puede
  // suspender — así que sus opciones se resuelven acá (query chica: id + nombre
  // de `floor_plans`). El streaming por tab de abajo no se toca.
  const salones = await getSalonOptions(business.id);

  // Ventana "hoy" en la TZ del negocio (no la del server) para que las
  // reservas no se corran en el borde de medianoche (mismo criterio que el
  // board de pedidos vía startOfTodayUtc).
  const todayStart = startOfTodayUtc(business.timezone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // Tab Reservas: el día se elige por `?date=` (el navegador de fechas de
  // `AdminDayList` lo escribe sin perder `tab`). Default = hoy en la TZ del
  // negocio, mismo criterio que la página `/admin/reservas`.
  const reservasDate =
    dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)
      ? dateQuery
      : formatInTimeZone(new Date(), business.timezone, "yyyy-MM-dd");
  const reservasDayStart = fromZonedTime(
    `${reservasDate}T00:00:00`,
    business.timezone,
  );
  const reservasDayEnd = new Date(
    reservasDayStart.getTime() + 24 * 60 * 60 * 1000,
  );

  // Una promesa por grupo de tab. NO se hace `await`: se pasan a LocalShell,
  // que las lee con `use()` dentro de un `<Suspense>` por tab. Salón (default)
  // pinta apenas resuelve `salon`, sin esperar a las demás.
  const salon = loadSalon(business.id, service, { todayStart, tomorrowStart });
  const comandas = loadComandas(business.id, business.timezone);
  const pedidos = loadPedidos(business.id, business.timezone);
  const caja = loadCaja(business.id);
  const rendicion = loadRendicion(business.id, service);
  const fichaje = loadFichaje(business.id, business_slug);
  const reservas = loadReservas(business.id, service, {
    date: reservasDate,
    dayStart: reservasDayStart,
    dayEnd: reservasDayEnd,
  });

  // /admin/operacion toma full viewport (overlay sobre el sidebar) — sin
  // PageShell/PageHeader: el header con tabs ya vive dentro de LocalShell.
  return (
    <LocalShell
      slug={business_slug}
      businessId={business.id}
      timezone={business.timezone}
      currentUserId={ctx.user.id}
      role={ctx.isPlatformAdmin ? "admin" : (ctx.role ?? "admin")}
      salones={salones}
      salon={salon}
      comandas={comandas}
      pedidos={pedidos}
      caja={caja}
      rendicion={rendicion}
      fichaje={fichaje}
      reservas={reservas}
    />
  );
}

export const dynamic = "force-dynamic";
