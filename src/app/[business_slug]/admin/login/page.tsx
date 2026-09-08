import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { LoginForm } from "@/components/admin/login-form";
import { MOTIVO_LINK_VENCIDO } from "@/lib/auth/link-caido";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export default async function AdminLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { business_slug } = await params;
  const { reason } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const isDisabledNotice = reason === "disabled";
  // Spec 171 · D4 — el motivo llega como código y el texto lo elige esta
  // pantalla. Un `?error=<texto libre>` dejaría que cualquiera le firme un
  // cartel al sistema («Llamá al 11-5555») mandando un link armado.
  const isLinkVencido = reason === MOTIVO_LINK_VENCIDO;

  // If already signed in AND member (active) of this business, skip login.
  // Si la membership está deshabilitada o el usuario llega con
  // ?reason=disabled, mostramos la pantalla y dejamos que vuelva a loguear con
  // otra cuenta — nunca auto-redirect a /admin (loop infinito con el gate).
  if (!isDisabledNotice) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const service = createSupabaseServiceClient();
      const { data: membership } = await service
        .from("business_users")
        .select("role, disabled_at")
        .eq("business_id", business.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membership && !membership.disabled_at) {
        // Mozos van a /mozo (su pantalla operativa). El resto al panel.
        const target =
          membership.role === "mozo"
            ? `/${business_slug}/mozo`
            : `/${business_slug}/admin`;
        redirect(target);
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-extrabold">{business.name}</h1>
        <p className="text-muted-foreground text-sm">Panel de pedidos</p>
      </div>
      {isDisabledNotice && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Tu cuenta fue deshabilitada</p>
            <p className="mt-1 text-amber-800">
              Un administrador del negocio dio de baja tu acceso. Si fue un
              error, contactalo para reactivarte.
            </p>
          </div>
        </div>
      )}
      {isLinkVencido && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Ese link ya venció</p>
            <p className="mt-1 text-amber-800">
              Los links de acceso duran una hora. Pedile otro a tu encargado, o
              entrá acá con tu PIN (o tu email) y tu contraseña.
            </p>
          </div>
        </div>
      )}
      <LoginForm slug={business_slug} />
    </main>
  );
}
