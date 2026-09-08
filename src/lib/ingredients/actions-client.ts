"use server";

import { ensureAdminAccess } from "@/lib/admin/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { getPriceLog } from "./queries";

/**
 * El historial de precio de un insumo, para el cliente — spec 172, fase 5.
 *
 * `getPriceLog` es `server-only` y la ficha del insumo es un componente cliente,
 * así que este wrapper es la única puerta. Y lleva gate por la misma razón que lo
 * lleva `proveedores/actions-client.ts`: la query usa el service client y filtra
 * sólo por `ingredientId`, así que sin esto cualquiera leería el histórico de
 * costos de compra de otro negocio pasando un id.
 *
 * El negocio sale del SLUG y el insumo se chequea contra ése: aceptar un
 * `businessId` del cliente sería el mismo agujero con otra forma.
 */
export async function getPriceLogDeInsumo(slug: string, ingredientId: string) {
  const service = createSupabaseServiceClient();

  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!business) throw new Error("Negocio no encontrado.");

  await ensureAdminAccess(business.id, slug);

  const { data: insumo } = await service
    .from("ingredients")
    .select("business_id")
    .eq("id", ingredientId)
    .maybeSingle();
  if (!insumo || insumo.business_id !== business.id) throw new Error("No autorizado.");

  return getPriceLog(ingredientId);
}
