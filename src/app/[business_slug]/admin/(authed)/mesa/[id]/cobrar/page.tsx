import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { getInvoiceForOrder } from "@/lib/afip/queries";
import { ensureAdminAccess } from "@/lib/admin/context";
import { iniciarCobro } from "@/lib/billing/cobro-actions";
import { getCuentaForTable } from "@/lib/billing/cuenta-query";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { CobrarDesktopClient } from "./cobrar-desktop-client";

export const dynamic = "force-dynamic";

export default async function AdminCobrarPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id: tableId } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Solo encargado / admin / platform admin. Si es mozo, lo mandamos al
  // cobrar de la misma mesa en su propia UI (no a /mozo a secas).
  if (
    !ctx.isPlatformAdmin &&
    ctx.role !== "admin" &&
    ctx.role !== "encargado"
  ) {
    redirect(`/${business_slug}/mozo/mesa/${tableId}/cobrar`);
  }

  const cuenta = await getCuentaForTable(tableId, business.id);
  if (!cuenta) {
    return (
      <PageShell width="narrow">
        <PageHeader
          eyebrow="Cobro"
          title="No hay cuenta para cobrar"
          description="Esta mesa no tiene un pedido activo. Cargá items primero desde la pantalla de pedido."
          back={{ href: `/${business_slug}/admin/operacion`, label: "Volver al salón" }}
        />
        <Link
          href={`/${business_slug}/admin/operacion`}
          className="inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Volver al salón
        </Link>
      </PageShell>
    );
  }

  const init = await iniciarCobro(cuenta.order.id, business_slug);
  if (!init.ok) {
    return (
      <PageShell width="narrow">
        <PageHeader
          eyebrow="Cobro"
          title="No se puede cobrar"
          description={init.error}
          back={{ href: `/${business_slug}/admin/operacion`, label: "Volver al salón" }}
        />
        <Link
          href={`/${business_slug}/admin/operacion?tab=caja`}
          className="text-sm font-semibold text-zinc-900 underline"
        >
          Ir a caja →
        </Link>
      </PageShell>
    );
  }

  const service = createSupabaseServiceClient();
  const [{ data: tableRow }, existingInvoice] = await Promise.all([
    service.from("tables").select("label").eq("id", tableId).single(),
    getInvoiceForOrder(business.id, cuenta.order.id),
  ]);

  // Con AFIP configurado el cobro ofrece emitir el comprobante y no se cierra
  // solo al terminar (#137). Mismo criterio que el cobro del mozo.
  const biz = business as Record<string, unknown>;
  const afipConfigured = !!(biz.afip_cuit && biz.afip_punto_venta);

  return (
    <CobrarDesktopClient
      slug={business_slug}
      tableId={tableId}
      tableLabel={tableRow?.label ?? "?"}
      role={ctx.isPlatformAdmin ? "admin" : (ctx.role ?? "admin")}
      cuenta={cuenta}
      init={init.data}
      existingInvoice={existingInvoice}
      afipConfigured={afipConfigured}
    />
  );
}
