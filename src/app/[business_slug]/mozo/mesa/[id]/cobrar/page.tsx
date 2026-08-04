import Link from "next/link";
import { notFound } from "next/navigation";

import { getInvoiceForOrder } from "@/lib/afip/queries";
import { iniciarCobro } from "@/lib/billing/cobro-actions";
import { getCuentaForTable } from "@/lib/billing/cuenta-query";
import { ensureMozoAccess } from "@/lib/mozo/auth";
import { getBusiness } from "@/lib/tenant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { CobrarClient } from "./cobrar-client";

export const dynamic = "force-dynamic";

export default async function CobrarPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id: tableId } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureMozoAccess(business.id, business_slug);

  const cuenta = await getCuentaForTable(tableId, business.id);
  if (!cuenta) {
    return (
      <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center text-center gap-4">
        <p className="text-lg font-semibold">No hay cuenta para cobrar</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Esta mesa no tiene un pedido activo. Cargá items primero desde la
          pantalla de pedido.
        </p>
        <div className="flex gap-2">
          <Link href={`/${business_slug}/mozo`} className="rounded-md border px-4 py-2 text-sm">
            Volver al salón
          </Link>
          <Link
            href={`/${business_slug}/mozo/mesa/${tableId}/pedir`}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm"
          >
            Cargar pedido
          </Link>
        </div>
      </div>
    );
  }

  const init = await iniciarCobro(cuenta.order.id, business_slug);
  if (!init.ok) {
    // Caso típico: no hay caja abierta. El mozo no abre la caja (lo hace
    // el encargado/admin), así que solo le ofrecemos volver al salón.
    return (
      <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center text-center gap-4">
        <p className="text-lg font-semibold">No se puede cobrar</p>
        <p className="text-sm text-muted-foreground max-w-sm">{init.error}</p>
        <a
          href={`/${business_slug}/mozo`}
          className="text-primary underline text-sm"
        >
          ← Volver al salón
        </a>
      </div>
    );
  }

  // Resolver label de la mesa + invoice existente (si ya facturaron).
  const service = createSupabaseServiceClient();
  const [{ data: tableRow }, existingInvoice] = await Promise.all([
    service.from("tables").select("label").eq("id", tableId).single(),
    getInvoiceForOrder(business.id, cuenta.order.id),
  ]);

  // Si el negocio factura, la pantalla NO se auto-cierra al cobrar: el mozo
  // necesita tiempo para emitir el comprobante (#136).
  const biz = business as Record<string, unknown>;
  const afipConfigured = !!(biz.afip_cuit && biz.afip_punto_venta);

  return (
    <CobrarClient
      slug={business_slug}
      tableId={tableId}
      tableLabel={tableRow?.label ?? "?"}
      role={ctx.role}
      cuenta={cuenta}
      init={init.data}
      existingInvoice={existingInvoice}
      afipConfigured={afipConfigured}
    />
  );
}
