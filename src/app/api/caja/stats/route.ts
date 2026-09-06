import { NextResponse } from "next/server";

import { ensureMozoAccess } from "@/lib/mozo/auth";
import { canManageProveedores } from "@/lib/permissions/can";
import {
  getCajaLiveStats,
  getMovimientosPeriodoActual,
  getPaymentsPeriodoActual,
} from "@/lib/caja/queries";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cajaId = url.searchParams.get("caja");
  if (!cajaId) {
    return NextResponse.json({ error: "missing caja" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data: cajaRow } = await service
    .from("cajas")
    .select("id, business_id, is_administrative")
    .eq("id", cajaId)
    .maybeSingle();
  if (!cajaRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // `is_administrative` (0067) todavía no está en `database.types.ts` — el
  // `pnpm db:types` del repo necesita el CLI linkeado.
  const { business_id: businessId, is_administrative: esAdministrativa } =
    cajaRow as unknown as { business_id: string; is_administrative: boolean };

  const { data: bizRow } = await service
    .from("businesses")
    .select("slug")
    .eq("id", businessId)
    .single();
  if (!bizRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let ctx;
  try {
    ctx = await ensureMozoAccess(businessId, bizRow.slug as string);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // spec 160 · la caja administrativa tiene la plata de la oficina, y este
  // endpoint toma el id del querystring: sin esto cualquier mozo la lee.
  // (El leak general —cualquier mozo lee cualquier caja del negocio— es
  // preexistente y tiene issue propia.)
  if (esAdministrativa && !canManageProveedores(ctx.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [stats, movimientos, payments] = await Promise.all([
    getCajaLiveStats(cajaId, businessId),
    getMovimientosPeriodoActual(cajaId, businessId),
    getPaymentsPeriodoActual(cajaId, businessId),
  ]);
  return NextResponse.json({ stats, movimientos, payments });
}
