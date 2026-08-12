"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { upsertCustomerByPhone } from "@/lib/mozo/customer-upsert";
import { openTable } from "@/lib/mozo/open-table";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

type GenericClient = SupabaseClient;

const SentarWalkInInput = z.object({
  tableId: z.string().uuid(),
  partySize: z.number().int().positive(),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional(),
  slug: z.string().min(1),
});

export type SentarWalkInInput = z.input<typeof SentarWalkInInput>;

export type SentarWalkInResult = {
  customerId: string | null;
  autoAssignedMozo: boolean;
};

/**
 * Sentar un walk-in (CU-08/a):
 *   1. Cross-tenant + canTransition libre→ocupada.
 *   2. Si phone: upsert customer (idempotente por (business_id, phone)).
 *   3. Delega a openTable(): marca ocupada, crea order, audit log.
 *   4. revalidatePath.
 *
 * Si el cliente se sienta y se va sin pedir, el encargado anula la mesa
 * → la order open se marca cancelled (`anularMesa`).
 */
export async function sentarWalkIn(
  raw: SentarWalkInInput,
): Promise<ActionResult<SentarWalkInResult>> {
  const parsed = SentarWalkInInput.safeParse(raw);
  if (!parsed.success) {
    return actionError("Datos inválidos.");
  }
  const input = parsed.data;

  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Cross-tenant: tables → floor_plans → business_id.
  const { data: tableRow } = await service
    .from("tables")
    .select(
      "id, operational_status, opened_at, mozo_id, floor_plans!inner(business_id)",
    )
    .eq("id", input.tableId)
    .maybeSingle();
  if (!tableRow) return actionError("Mesa no encontrada.");
  const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== business.id) {
    return actionError("Mesa no encontrada.");
  }
  const table = tableRow as {
    id: string;
    operational_status: "libre" | "ocupada" | "pidio_cuenta";
    opened_at: string | null;
    mozo_id: string | null;
  };

  // Customer upsert por (business_id, phone). Idempotente. La lógica es la
  // misma que usa «Datos de la mesa» (spec 111), así que vive en un módulo
  // compartido en vez de estar escrita dos veces.
  const upsert = await upsertCustomerByPhone(
    service,
    business.id,
    input.phone,
    input.name,
  );
  if (!upsert.ok) return actionError("No pudimos guardar el cliente.");
  const customerId = upsert.customerId;

  // Delegar a openTable() la lógica de abrir mesa + crear order.
  const openResult = await openTable({
    service,
    businessId: business.id,
    table,
    actorUserId: ctx.userId,
    customerName: input.name?.trim() || "Walk-in",
    customerPhone: input.phone?.trim() || "-",
    customerId,
    notes: input.notes?.trim() || null,
    // Spec 111: hasta acá llegaba y se perdía — la acción lo validaba y no lo
    // guardaba en ningún lado.
    partySize: input.partySize,
  });
  if (!openResult.ok) return openResult;

  revalidatePath(`/${input.slug}/mozo`);
  revalidatePath(`/${input.slug}/admin/operacion`);
  return actionOk({
    customerId,
    autoAssignedMozo: openResult.data.autoAssignedMozo,
  });
}
