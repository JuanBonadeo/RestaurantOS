"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { upsertCustomerByPhone } from "@/lib/mozo/customer-upsert";
import { MAX_PARTY_SIZE, MIN_PARTY_SIZE } from "@/lib/mozo/party-size-keys";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

type GenericClient = SupabaseClient;

const GuardarDatosMesaInput = z.object({
  tableId: z.string().uuid(),
  slug: z.string().min(1),
  partySize: z.number().int().min(MIN_PARTY_SIZE).max(MAX_PARTY_SIZE).nullish(),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

export type GuardarDatosMesaInput = z.input<typeof GuardarDatosMesaInput>;

/**
 * Cargar (o corregir) los datos de la mesa ya abierta: personas y cliente.
 *
 * Es el otro lado de la spec 111: el camino para sentar dejó de pedir nombre y
 * teléfono —sentar a alguien no puede costar un formulario— así que el cliente
 * se carga después, cuando hace falta, desde el ⋯ del panel. Y como ahora una
 * mesa se abre **enviando la primera comanda**, los datos que antes se
 * cargaban al sentar necesitan una puerta que no sea el walk-in.
 *
 * Los tres campos son opcionales e independientes: se manda lo que se cargó.
 */
export async function guardarDatosMesa(
  raw: GuardarDatosMesaInput,
): Promise<ActionResult<{ customerId: string | null }>> {
  const parsed = GuardarDatosMesaInput.safeParse(raw);
  if (!parsed.success) return actionError("Datos inválidos.");
  const input = parsed.data;

  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Cross-tenant: la mesa tiene que ser de un floor_plan de este negocio.
  const { data: tableRow } = await service
    .from("tables")
    .select("id, floor_plans!inner(business_id)")
    .eq("id", input.tableId)
    .maybeSingle();
  const fpRaw = (tableRow as unknown as { floor_plans: unknown } | null)
    ?.floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null | undefined);
  if (!tableRow || fp?.business_id !== business.id) {
    return actionError("Mesa no encontrada.");
  }

  const { data: order } = await service
    .from("orders")
    .select("id")
    .eq("table_id", input.tableId)
    .eq("business_id", business.id)
    .eq("lifecycle_status", "open")
    .maybeSingle();
  if (!order) {
    // Pasa si se abre el modal en una mesa a la que todavía no se le envió
    // nada: no hay orden donde escribir. El panel guarda las personas en su
    // estado y viajan con el primer envío (`enviarComanda.partySize`).
    return actionError("La mesa todavía no tiene un pedido abierto.");
  }
  const orderId = (order as { id: string }).id;

  const upsert = await upsertCustomerByPhone(
    service,
    business.id,
    input.phone,
    input.name,
  );
  if (!upsert.ok) return actionError("No pudimos guardar el cliente.");

  const patch: Record<string, unknown> = {};
  if (input.partySize != null) patch.party_size = input.partySize;
  // El nombre se guarda aunque no haya teléfono: sirve para llamar a la mesa
  // («Pérez») aunque no entre al CRM.
  if (input.name) patch.customer_name = input.name;
  if (input.phone) patch.customer_phone = input.phone;
  if (upsert.customerId) patch.customer_id = upsert.customerId;

  if (Object.keys(patch).length > 0) {
    const { error } = await service
      .from("orders")
      .update(patch)
      .eq("id", orderId);
    if (error) {
      console.error("guardarDatosMesa update", error);
      return actionError("No pudimos guardar los datos.");
    }
  }

  revalidatePath(`/${input.slug}/mozo`);
  revalidatePath(`/${input.slug}/admin/operacion`);
  return actionOk({ customerId: upsert.customerId });
}
