import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";

import { CuentaClient } from "@/app/[business_slug]/mozo/mesa/[id]/cuenta/cuenta-client";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getCuentaForTable } from "@/lib/billing/cuenta-query";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { canSee } from "@/lib/permissions/sections";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Pedir/armar la cuenta desde el panel admin. Reusa la vista del mozo
 * (`CuentaClient`) gateada con `ensureAdminAccess` y con destinos a `/admin`
 * para no saltar a la app del mozo. Mismo patrón que el cobro/pedir admin.
 */
export default async function AdminCuentaPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id: tableId } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Spec 140: el gate sale de la matriz. La `terminal` opera desde el panel y
  // rebotarla a la UI móvil del mozo la sacaría del flujo a mitad de la carga.
  if (!canSee("operacion", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/mozo/mesa/${tableId}/cuenta`);
  }

  // Cross-tenant: la mesa tiene que ser del business.
  const service = createSupabaseServiceClient();
  const { data: tableRow } = await service
    .from("tables")
    .select("id, label, operational_status, floor_plans!inner(business_id)")
    .eq("id", tableId)
    .maybeSingle();
  const fpRaw = (tableRow as unknown as { floor_plans: unknown } | null)
    ?.floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!tableRow || !fp || fp.business_id !== business.id) {
    notFound();
  }
  const tableLabel = (tableRow as { label: string }).label;
  const operationalStatus = (
    tableRow as { operational_status: string | null }
  ).operational_status;

  const cuenta = await getCuentaForTable(tableId, business.id);

  if (!cuenta) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 backdrop-blur p-4">
          <Link href={`/${business_slug}/admin/operacion`}>
            <button className="rounded-md p-2 hover:bg-muted">
              <ArrowLeft className="h-5 w-5" />
            </button>
          </Link>
          <h1 className="font-semibold">{tableLabel}</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
          <ClipboardList className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">No hay cuenta para esta mesa</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            {operationalStatus === "libre"
              ? "La mesa está libre. Cargá un pedido primero para poder cobrar."
              : "Esta mesa todavía no tiene items cargados. Cargá el pedido antes de cobrar."}
          </p>
          <div className="flex gap-2">
            <Link href={`/${business_slug}/admin/operacion`}>
              <button className="rounded-md border px-4 py-2 text-sm">
                Volver al salón
              </button>
            </Link>
            <Link href={`/${business_slug}/admin/mesa/${tableId}/pedir`}>
              <button className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm">
                Cargar pedido
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CuentaClient
      slug={business_slug}
      tableId={tableId}
      tableLabel={tableLabel}
      role={ctx.isPlatformAdmin ? "admin" : (ctx.role ?? "admin")}
      cuenta={cuenta}
      homeHref={`/${business_slug}/admin/operacion`}
      cobrarHref={`/${business_slug}/admin/mesa/${tableId}/cobrar`}
    />
  );
}
