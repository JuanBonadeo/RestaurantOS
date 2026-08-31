import { notFound } from "next/navigation";

import { Clock } from "lucide-react";

import { BusinessHoursForm } from "@/components/admin/settings/business-hours-form";
import { BusinessProfileForm } from "@/components/admin/settings/business-profile-form";
import {
  DEFAULT_MARCH_LEAD_DELIVERY_MIN,
  DEFAULT_MARCH_LEAD_PICKUP_MIN,
} from "@/lib/orders/scheduled";
import { SettingsSection } from "@/components/admin/settings/settings-section";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

// Ajustes › Negocio: contacto, URL pública, envío y horarios de atención.
// El gate vive en el layout (canManageBusiness); acá sólo se cargan datos.
export default async function ConfiguracionNegocioPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const service = createSupabaseServiceClient();
  const { data: businessHours } = await service
    .from("business_hours")
    .select("day_of_week, opens_at, closes_at")
    .eq("business_id", business.id)
    .order("day_of_week")
    .order("opens_at");

  const initial = {
    slug: business.slug,
    name: business.name,
    phone: business.phone ?? "",
    email: business.email ?? "",
    address: business.address ?? "",
    timezone: business.timezone,
    delivery_fee_cents: Number(business.delivery_fee_cents ?? 0) / 100,
    min_order_cents: Number(business.min_order_cents ?? 0) / 100,
    estimated_delivery_minutes: business.estimated_delivery_minutes,
    estimated_pickup_minutes:
      (business as { estimated_pickup_minutes?: number | null })
        .estimated_pickup_minutes ?? null,
    scheduled_march_lead_pickup_min:
      business.scheduled_march_lead_pickup_min ?? DEFAULT_MARCH_LEAD_PICKUP_MIN,
    scheduled_march_lead_delivery_min:
      business.scheduled_march_lead_delivery_min ??
      DEFAULT_MARCH_LEAD_DELIVERY_MIN,
  };

  return (
    <>
      <BusinessProfileForm slug={business_slug} initial={initial} />

      <SettingsSection
        icon={<Clock className="size-5" />}
        title="Horarios de atención"
        description="Configurá en qué horarios el local acepta pedidos. Los días sin franjas aparecen como cerrados."
      >
        <BusinessHoursForm slug={business_slug} initial={businessHours ?? []} />
      </SettingsSection>
    </>
  );
}

export const dynamic = "force-dynamic";
