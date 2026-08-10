import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureMozoAccess } from "@/lib/mozo/auth";
import { loadMozoHome } from "@/lib/mozo/home-data";
import { getTodayTips, getMozoAttendance } from "@/lib/mozo/queries";
import { listForUser, countUnread } from "@/lib/notifications/queries";
import { getBusiness } from "@/lib/tenant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { MozoClient } from "./mozo-client";

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

  // Las 4 piezas operativas salen del MISMO loader que usa el refetch del
  // cliente (spec 107), así la page y la re-sincronización no pueden divergir.
  const [home, notifications, unreadCount, todayTipsCents, attendance] =
    await Promise.all([
      loadMozoHome(business.id, service),
      listForUser({
        userId: ctx.userId,
        businessId: business.id,
        role: ctx.role,
        limit: 10,
      }),
      countUnread({ userId: ctx.userId, businessId: business.id, role: ctx.role }),
      getTodayTips(business.id, ctx.userId),
      getMozoAttendance(business.id, ctx.userId),
    ]);
  const { floorPlans, reservations, activeOrders, mozos } = home;

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
        reservations={reservations}
        activeOrders={activeOrders}
        mozos={mozos}
        currentUserId={ctx.userId}
        role={ctx.role}
        initialNotifications={notifications}
        initialUnreadCount={unreadCount}
        todayTipsCents={todayTipsCents}
        attendance={attendance}
      />
    </Suspense>
  );
}
