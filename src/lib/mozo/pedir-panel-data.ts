"use server";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { currentDayOfWeek } from "@/lib/day-of-week";
import { ensureAdminAccess } from "@/lib/admin/context";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import {
  getActiveOrderByTable,
  getComandasByOrder,
  getStationsByBusiness,
  type ComandaConItems,
} from "@/lib/comandas/queries";
import { getCatalogForMozo, type CatalogForMozo } from "@/lib/mozo/catalog-query";
import {
  getDailyMenusForToday,
  type DailyMenuForMozo,
} from "@/lib/mozo/daily-menus-query";
import type { LoPedido } from "@/lib/mozo/lo-pedido";
import { getLoPedido } from "@/lib/mozo/lo-pedido-query";
import { getTopProductIds } from "@/lib/mozo/top-products";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Datos para "Cargar pedido" embebido en el panel del salón, partidos en dos
 * para que la apertura se sienta instantánea:
 *
 *  - `loadPedirCatalog`  → bundle business-level (catálogo, stations, menús del
 *    día, top). Es lo PESADO. El cliente lo prefetchea al montar y lo cachea,
 *    así no se vuelve a pedir en cada apertura.
 *  - `loadTableComandas` → comandas de la mesa puntual. Es CHICO y rápido; es
 *    lo único que se busca al abrir el panel.
 *
 * `table` y `role` los aporta el cliente (ya los tiene en el plano/props), así
 * que no se vuelven a consultar.
 */

export type PedirCatalogBundle = {
  businessName: string;
  catalog: CatalogForMozo;
  stationNameById: Record<string, string>;
  topProductIds: string[];
  dailyMenus: DailyMenuForMozo[];
};

async function gateAdmin(slug: string) {
  const business = await getBusiness(slug);
  if (!business) return { ok: false as const, error: "Negocio no encontrado." };
  const ctx = await ensureAdminAccess(business.id, slug);
  if (
    !ctx.isPlatformAdmin &&
    ctx.role !== "admin" &&
    ctx.role !== "encargado"
  ) {
    return { ok: false as const, error: "No tenés permisos." };
  }
  return { ok: true as const, business };
}

/**
 * Gate del catálogo: **membresía**, no admin (spec 105).
 *
 * El bundle es el menú del negocio —lo mismo que ve cualquiera en la carta
 * pública— más los sectores y el top de productos, que el mozo necesita para
 * cargar un pedido. Con el gate de admin, el mozo no podía pedirlo y el
 * catálogo tenía que viajar en el payload RSC de cada apertura de mesa.
 */
async function gateMiembro(slug: string) {
  const business = await getBusiness(slug);
  if (!business) return { ok: false as const, error: "Negocio no encontrado." };
  const ctx = await requireMozoActionContext(business.id);
  if (!ctx.ok) return { ok: false as const, error: ctx.error };
  return { ok: true as const, business };
}

export async function loadPedirCatalog(
  slug: string,
): Promise<ActionResult<PedirCatalogBundle>> {
  const gate = await gateMiembro(slug);
  if (!gate.ok) return actionError(gate.error);
  const { business } = gate;

  // El día, en la TZ del **negocio** (spec 109). Con `new Date().getDay()` lo
  // decidía la zona del server: un sábado a las 21:00 en Argentina ya es
  // domingo en UTC, así que el mozo veía el menú del domingo. Y desde que
  // `enviarComanda` valida el día contra la misma TZ, esa divergencia dejaría
  // al mozo mirando un combo que el server le va a rechazar.
  const todayDow = currentDayOfWeek(business.timezone);
  const [catalog, stations, topProductIds, dailyMenus] = await Promise.all([
    getCatalogForMozo(business.id),
    getStationsByBusiness(business.id),
    getTopProductIds(business.id, { limit: 12 }),
    getDailyMenusForToday(business.id, todayDow),
  ]);

  const stationNameById: Record<string, string> = {};
  for (const s of stations) stationNameById[s.id] = s.name;

  return actionOk({
    businessName: business.name,
    catalog,
    stationNameById,
    topProductIds,
    dailyMenus,
  });
}

/** Lo que el panel necesita de **esta** mesa: las comandas (para entregar y
 *  para el overlay optimista) y «Lo pedido» (la columna izquierda, spec 111).
 *  Van juntos en un viaje: los dos salen de la misma orden abierta. */
export type TableOrderState = {
  comandas: ComandaConItems[];
  /** `null` si la mesa todavía no tiene orden abierta (nunca se envió nada). */
  loPedido: LoPedido | null;
};

export async function loadTableComandas(
  slug: string,
  tableId: string,
): Promise<ActionResult<TableOrderState>> {
  const gate = await gateAdmin(slug);
  if (!gate.ok) return actionError(gate.error);
  const { business } = gate;

  // Cross-tenant: la mesa debe pertenecer a un floor_plan de este business.
  const service = createSupabaseServiceClient();
  const { data: tableRow } = await service
    .from("tables")
    .select("id, floor_plans!inner(business_id)")
    .eq("id", tableId)
    .maybeSingle();
  const tableBusinessId = (
    tableRow as { floor_plans?: { business_id: string } } | null
  )?.floor_plans?.business_id;
  if (!tableRow || tableBusinessId !== business.id) {
    return actionError("Mesa no encontrada.");
  }

  const activeOrder = await getActiveOrderByTable(tableId, business.id);
  if (!activeOrder) return actionOk({ comandas: [], loPedido: null });

  const [comandas, loPedido] = await Promise.all([
    getComandasByOrder(activeOrder.id, business.id),
    getLoPedido(activeOrder.id, business.id),
  ]);
  return actionOk({ comandas, loPedido });
}
