import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import {
  PageHeader,
  PageShell,
} from "@/components/admin/shell/page-shell";
import { RrhhShell, type RrhhTab } from "@/components/admin/rrhh/rrhh-shell";
import { AsistenciaTab } from "@/components/admin/rrhh/asistencia-tab";
import { EquipoTab } from "@/components/admin/rrhh/equipo-tab";
import { ensureAdminAccess } from "@/lib/admin/context";
import { canSee } from "@/lib/permissions/sections";
import { listBusinessMembers } from "@/lib/admin/members-query";
import {
  getClockHistory,
  getMonthlyOverview,
} from "@/lib/rrhh/clock-queries";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function RrhhPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{
    tab?: string;
    disabled?: string;
    month?: string;
    day?: string;
  }>;
}) {
  const { business_slug } = await params;
  const { tab, disabled, month, day } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  if (!canSee("rrhh", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin`);
  }

  const activeTab: RrhhTab = tab === "equipo" ? "equipo" : "asistencia";

  const monthStart = parseMonth(month);
  const currentMonth = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

  const [monthly, members, dayEntries] = await Promise.all([
    getMonthlyOverview(business.id, monthStart),
    activeTab === "equipo"
      ? listBusinessMembers(business.id, { includeDisabled: disabled === "1" })
      : Promise.resolve([]),
    day
      ? getClockHistory(business.id, {
          from: `${day}T00:00:00`,
          to: `${day}T23:59:59`,
        })
      : Promise.resolve(undefined),
  ]);

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Gestión"
        title="RRHH"
        description="Asistencia, horas trabajadas y equipo."
      />

      <Suspense>
        <RrhhShell activeTab={activeTab}>
          {activeTab === "asistencia" && (
            <AsistenciaTab
              overview={monthly}
              currentMonth={currentMonth}
              dayEntries={dayEntries}
            />
          )}
          {activeTab === "equipo" && (
            <EquipoTab
              slug={business_slug}
              businessName={business.name}
              members={members}
              currentUserId={ctx.userId}
              includeDisabled={disabled === "1"}
              employeeClockData={monthly.perEmployee}
            />
          )}
        </RrhhShell>
      </Suspense>
    </PageShell>
  );
}

function parseMonth(month?: string): Date {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1, 0, 0, 0, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}
