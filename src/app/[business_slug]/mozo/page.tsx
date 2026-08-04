import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getFloorPlansForBusiness } from "@/lib/admin/floor-plan/queries";
import { ensureMozoAccess } from "@/lib/mozo/auth";
import {
  getMozosByBusiness,
  getTodayTips,
  getMozoAttendance,
} from "@/lib/mozo/queries";
import { listForUser, countUnread } from "@/lib/notifications/queries";
import { getBusiness } from "@/lib/tenant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { MozoClient } from "./mozo-client";
import type { ReservationForMozo, OrderForMozo } from "./mozo-client";

export const dynamic = "force-dynamic";

export default async function MozoPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureMozoAccess(business.id, business_slug);

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const [
    floorPlans,
    { data: reservations },
    { data: activeOrders },
    mozos,
    notifications,
    unreadCount,
    todayTipsCents,
    attendance,
  ] = await Promise.all([
    getFloorPlansForBusiness(business.id),

    // Reservas confirmadas de hoy
    service
      .from("reservations")
      .select("id, table_id, customer_name, customer_phone, party_size, starts_at, status, notes")
      .eq("business_id", business.id)
      .in("status", ["confirmed", "seated"])
      .gte("starts_at", todayStart.toISOString())
      .lt("starts_at", tomorrowStart.toISOString())
      .order("starts_at", { ascending: true }),

    // Órdenes dine_in **abiertas** (la "open" actual de cada mesa). Una por
    // mesa garantizada por el partial unique `orders_one_open_per_table`.
    // Traemos customer_name + items + comandas con su estado para alimentar
    // card y drawer (resumen del pedido + tracking de cocina).
    service
      .from("orders")
      .select(
        "id, order_number, table_id, delivery_type, total_cents, created_at, status, customer_name, order_items(product_name, quantity, cancelled_at), comandas(id, batch, status, station_id, emitted_at, delivered_at, cancelled_at, stations(name), comanda_items(order_items(product_name, quantity, cancelled_at, products(prep_time_minutes))))",
      )
      .eq("business_id", business.id)
      .eq("delivery_type", "dine_in")
      .eq("lifecycle_status", "open"),

    getMozosByBusiness(business.id),

    listForUser({ userId: ctx.user.id, businessId: business.id, role: ctx.role, limit: 10 }),

    countUnread({ userId: ctx.user.id, businessId: business.id, role: ctx.role }),

    getTodayTips(business.id, ctx.user.id),

    getMozoAttendance(business.id, ctx.user.id),
  ]);

  return (
    // Suspense boundary requerido por Next 15 para useSearchParams() en
    // el cliente. El children del Suspense ya tiene los datos pre-fetched,
    // así que el fallback sólo aparece en navegaciones rápidas — corto.
    <Suspense fallback={null}>
      <MozoClient
        businessSlug={business_slug}
        businessName={business.name}
        businessId={business.id}
        floorPlans={floorPlans}
        reservations={(reservations ?? []) as ReservationForMozo[]}
        activeOrders={(activeOrders ?? []).map((o) => {
          type RawProduct = { prep_time_minutes: number | null };
          type RawOrderItem = {
            product_name: string;
            quantity: number;
            cancelled_at: string | null;
            products: RawProduct | RawProduct[] | null;
          };
          type RawComandaItem = {
            order_items: RawOrderItem | RawOrderItem[] | null;
          };
          type RawComanda = {
            id: string;
            batch: number;
            status: "pendiente" | "en_preparacion" | "entregado";
            station_id: string | null;
            emitted_at: string;
            delivered_at: string | null;
            cancelled_at: string | null;
            stations: { name: string } | { name: string }[] | null;
            comanda_items: RawComandaItem[];
          };
          const rawComandas =
            (o as { comandas?: RawComanda[] }).comandas ?? [];
          return {
            id: o.id as string,
            order_number: o.order_number as number,
            table_id: o.table_id as string | null,
            delivery_type: o.delivery_type as string,
            total_cents: Number(o.total_cents),
            created_at: o.created_at as string,
            status: o.status as string,
            customer_name: (o as { customer_name: string | null })
              .customer_name,
            items:
              (
                o as {
                  order_items?: Array<{
                    product_name: string;
                    quantity: number;
                    cancelled_at: string | null;
                  }>;
                }
              ).order_items ?? [],
            comandas: rawComandas.map((c) => {
              const station = Array.isArray(c.stations)
                ? c.stations[0]
                : c.stations;
              const items = (c.comanda_items ?? [])
                .map((ci) =>
                  Array.isArray(ci.order_items)
                    ? ci.order_items[0]
                    : ci.order_items,
                )
                .filter(
                  (oi): oi is RawOrderItem =>
                    oi != null && oi.cancelled_at === null,
                )
                .map((oi) => {
                  const product = Array.isArray(oi.products)
                    ? oi.products[0]
                    : oi.products;
                  return {
                    product_name: oi.product_name,
                    quantity: oi.quantity,
                    prep_time_minutes: product?.prep_time_minutes ?? null,
                  };
                });
              return {
                id: c.id,
                batch: c.batch,
                status: c.status,
                station_name: station?.name ?? "—",
                emitted_at: c.emitted_at,
                delivered_at: c.delivered_at,
                cancelled_at: c.cancelled_at,
                items,
              };
            }),
          };
        })}
        mozos={mozos}
        currentUserId={ctx.user.id}
        role={ctx.role}
        initialNotifications={notifications}
        initialUnreadCount={unreadCount}
        todayTipsCents={todayTipsCents}
        attendance={attendance}
      />
    </Suspense>
  );
}
