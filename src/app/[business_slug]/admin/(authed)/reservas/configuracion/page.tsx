import { notFound } from "next/navigation";

import { ReservationSettingsForm } from "@/components/admin/floor-plan/settings-form";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import {
  getBusinessSalones,
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ReservationSettingsPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();
  await ensureAdminAccess(business.id, business_slug);

  const [settings, services, salones] = await Promise.all([
    getReservationSettings(business.id, { useService: true }),
    getReservationServices(business.id, { useService: true }),
    getBusinessSalones(business.id, { useService: true }),
  ]);

  return (
    <PageShell width="default" className="space-y-6">
      <PageHeader
        eyebrow="Reservas"
        title="Configuración"
        description="Definí el modo de reservas, horarios y políticas de antelación."
        back={{ href: `/${business_slug}/admin/reservas`, label: "Volver a reservas" }}
      />
      <ReservationSettingsForm
        slug={business_slug}
        initial={settings}
        services={services}
        salones={salones}
      />
    </PageShell>
  );
}
