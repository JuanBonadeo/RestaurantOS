import { notFound, redirect } from "next/navigation";

import { ensureMozoAccess } from "@/lib/mozo/auth";
import {
  getActiveOrderByTable,
  getComandasByOrder,
} from "@/lib/comandas/queries";
import { getBusiness } from "@/lib/tenant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { MozoPedirScreen } from "./pedir-screen";

export const dynamic = "force-dynamic";

export default async function MozoPedirPage({
  params,
}: {
  params: Promise<{ business_slug: string; id: string }>;
}) {
  const { business_slug, id: tableId } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureMozoAccess(business.id, business_slug);

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
    redirect(`/${business_slug}/mozo`);
  }
  const table = tableRow as unknown as {
    id: string;
    label: string;
    operational_status: string;
    opened_at: string | null;
    mozo_id: string | null;
  };

  const activeOrder = await getActiveOrderByTable(tableId, business.id);

  // Spec 105: el bundle business-level (catálogo, sectores, menús del día,
  // top) ya NO viaja acá — eran ~195 kB en cada apertura de mesa. El cliente lo
  // toma de su cache y lo revalida en background. Del server sólo baja lo de
  // esta mesa.
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
      role={ctx.role}
    />
  );
}
