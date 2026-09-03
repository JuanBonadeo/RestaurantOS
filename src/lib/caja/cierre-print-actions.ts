"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canHacerCorte } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Reimprimir el papel de un cierre ya hecho (spec 139 · D8).
 *
 * **No inserta una fila nueva**, a diferencia de la factura (084): el papel del
 * cierre tiene un único `(corte_id) where kind='cierre'` (migración `0063`), así
 * que la reimpresión vuelve a poner en `pendiente` la fila que ya está y le
 * sella `reprint_requested_at`. El agente la levanta en el próximo poll y sale
 * marcada `*** REIMPRESION ***`.
 *
 * Que sea un update y no un insert es lo que hace que **apretar dos veces no
 * imprima dos veces**: el segundo click re-sella una fila que ya está pendiente.
 */
export async function reimprimirCierre(
  corteId: string,
  businessSlug: string,
): Promise<ActionResult<{ print_job_id: string }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  // El mismo círculo que puede cerrar la caja. El `terminal` —la compu del
  // salón— no entra: el papel del cierre es plata de supervisión (spec 140 D2).
  if (!canHacerCorte(ctx.role)) {
    return actionError("Solo encargado o admin pueden reimprimir un cierre.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  const { data: corteRow } = await service
    .from("caja_cortes")
    .select("id, business_id, resumen")
    .eq("id", corteId)
    .maybeSingle();
  const corte = corteRow as {
    business_id: string;
    resumen: unknown | null;
  } | null;
  // Cross-tenant: el caller pasa el negocio, pero la verdad es la fila.
  if (!corte || corte.business_id !== business.id) {
    return actionError("Cierre no encontrado.");
  }
  // Sin snapshot no hay papel posible: el armador del GET saltea esas filas
  // (mejor no imprimir que imprimir una reconstrucción que nadie firmó), así
  // que sin esta guarda el botón quedaría "mandando a imprimir" para siempre.
  if (!corte.resumen) {
    return actionError(
      "Este cierre es anterior al ticket en papel, así que no tiene un resumen congelado para imprimir.",
    );
  }

  const { data: jobRow } = await service
    .from("print_jobs")
    .select("id")
    .eq("corte_id", corteId)
    .eq("kind", "cierre")
    .maybeSingle();
  const job = jobRow as { id: string } | null;
  if (!job) {
    return actionError("Este cierre no tiene un papel asociado.");
  }

  const { error } = await service
    .from("print_jobs")
    .update({
      status: "pendiente",
      reprint_requested_at: new Date().toISOString(),
      requested_by: ctx.userId,
      // Se limpian los sellos del intento anterior: si no, una reimpresión de
      // un papel que había fallado seguiría contando como fallida (spec 033).
      printed_at: null,
      print_failed_at: null,
    })
    .eq("id", job.id);

  if (error) {
    console.error("reimprimirCierre", error);
    return actionError("No pudimos mandar el cierre a la impresora.");
  }

  revalidatePath(`/${businessSlug}/admin/caja/cierres/${corteId}`);
  return actionOk({ print_job_id: job.id });
}
