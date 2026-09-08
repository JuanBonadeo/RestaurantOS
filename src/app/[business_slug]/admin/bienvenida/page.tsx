import { notFound, redirect } from "next/navigation";

import { WelcomeForm } from "@/components/admin/welcome/welcome-form";
import { BrandStyle } from "@/components/admin/shell/brand-style";
import { recorrido } from "@/lib/ayuda/recorrido";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness, getBusinessSettings } from "@/lib/tenant";
import type { BusinessRole } from "@/lib/admin/context";

export default async function BienvenidaPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${business_slug}/admin/login`);

  // Si ya pasó por la bienvenida antes, lo mandamos directo al panel.
  if (user.user_metadata?.welcomed_at) {
    redirect(`/${business_slug}/admin`);
  }

  // Spec 169 · D1 — a dónde lo dejamos al terminar. El primer tema del
  // recorrido de SU rol, que es lo único que conocemos de él en este punto.
  // Sin recorrido (hoy: el salón, que todavía no tiene guía propia) queda como
  // estaba, en el índice, que ya le muestra lo que corresponde a su puesto.
  const service = createSupabaseServiceClient();
  const { data: membership } = await service
    .from("business_users")
    .select("role")
    .eq("business_id", business.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const reservas = await getReservationSettings(business.id);
  const modo: ReservationMode = reservas.mode ?? "estricto";
  const primero = recorrido(
    (membership?.role as BusinessRole | undefined) ?? null,
    modo,
  )[0];
  const destino = primero
    ? `/${business_slug}/admin/ayuda/${primero.slug}`
    : `/${business_slug}/admin/ayuda`;

  const settings = getBusinessSettings(business);
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0];

  return (
    <div
      data-admin-brand
      className="min-h-screen bg-zinc-100/60 px-4 py-12 sm:px-6"
    >
      <BrandStyle
        primary={settings.primary_color}
        primaryForeground={settings.primary_foreground}
      />
      <WelcomeForm
        businessName={business.name}
        businessSlug={business_slug}
        businessLogoUrl={business.logo_url}
        email={user.email ?? ""}
        displayName={displayName ?? ""}
        destino={destino}
      />
    </div>
  );
}

export const dynamic = "force-dynamic";
