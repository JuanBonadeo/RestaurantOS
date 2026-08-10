import { notFound, redirect } from "next/navigation";

import { MozoPedirScreen } from "@/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-screen";
import { ensureAdminAccess } from "@/lib/admin/context";
import {
  getActiveOrderByTable,
  getComandasByOrder,
} from "@/lib/comandas/queries";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Cargar pedido desde el panel admin (encargado / dueño). Reusa la misma
 * vista del mozo (`MozoPedirClient`) pero gateada con `ensureAdminAccess` y con
 * `homeHref` a `/admin/operacion`, para que el encargado cargue el pedido sin
 * salir del panel hacia la app del mozo. Mismo patrón que el cobro admin.
 */
export default async function AdminPedirPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id: tableId } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  // Solo encargado / admin / platform admin. Si es mozo, lo mandamos al
  // pedir de la misma mesa en su propia UI (no al panel admin).
  if (
    !ctx.isPlatformAdmin &&
    ctx.role !== "admin" &&
    ctx.role !== "encargado"
  ) {
    redirect(`/${business_slug}/mozo/mesa/${tableId}/pedir`);
  }

  const service = createSupabaseServiceClient();

  // Cross-tenant: la mesa debe pertenecer a un floor_plan de este business.
  const { data: tableRow } = await service
    .from("tables")
    .select(
      "id, label, operational_status, opened_at, mozo_id, floor_plans!inner(business_id)",
    )
    .eq("id", tableId)
    .maybeSingle();
  const tableBusinessId = (
    tableRow as { floor_plans?: { business_id: string } } | null
  )?.floor_plans?.business_id;
  if (!tableRow || tableBusinessId !== business.id) {
    redirect(`/${business_slug}/admin/operacion`);
  }
  const table = tableRow as unknown as {
    id: string;
    label: string;
    operational_status: string;
    opened_at: string | null;
    mozo_id: string | null;
  };

  const activeOrder = await getActiveOrderByTable(tableId, business.id);

  // Spec 105: el bundle business-level lo resuelve el cliente desde su cache
  // (ver `pedir-screen`). Del server sólo baja lo de esta mesa.
  const existingComandas = activeOrder
    ? await getComandasByOrder(activeOrder.id, business.id)
    : [];

  return (
    <MozoPedirScreen
      slug={business_slug}
      table={{
        id: table.id,
        label: table.label,
        operational_status: table.operational_status,
        opened_at: table.opened_at,
      }}
      existingComandas={existingComandas}
      role={ctx.isPlatformAdmin ? "admin" : (ctx.role ?? "admin")}
      homeHref={`/${business_slug}/admin/operacion`}
    />
  );
}
