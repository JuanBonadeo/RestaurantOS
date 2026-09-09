"use server";

import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { isValidPrinterHost } from "@/lib/catalog/schemas";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Prueba de comandera (spec 176).
 *
 * Encola un papel de prueba contra una IP **tipeada en el formulario**, esté
 * guardada o no: probar antes de guardar es justo lo que hace falta cuando se
 * está cazando la IP correcta en la instalación del local.
 *
 * La IP pasa por `isValidPrinterHost`, el mismo guard que ya cierra el SSRF
 * cloud→LAN del print-agent (sólo rangos privados RFC1918 o un hostname que el
 * agente resuelve en su red). Sin eso, este endpoint sería un "conectate a esta
 * dirección y escribí estos bytes" a pedido del admin de cualquier negocio.
 */
const PruebaInput = z.object({
  printer_ip: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v !== "", { message: "Cargá la IP de la comandera." })
    .refine(isValidPrinterHost, {
      message: "IP o host inválido (ej: 192.168.10.50).",
    }),
  printer_port: z
    .number({ message: "Puerto inválido." })
    .int("El puerto debe ser un número entero.")
    .min(1, "El puerto debe estar entre 1 y 65535.")
    .max(65535, "El puerto debe estar entre 1 y 65535.")
    .default(9100),
  /** Nombre de la comandera, para que el papel diga cuál es. */
  label: z
    .string()
    .transform((v) => v.trim().slice(0, 40))
    .default("Comandera"),
});

export type PruebaDeComandera = {
  print_job_id: string;
  printer_ip: string;
  printer_port: number;
};

export async function imprimirPruebaDeComandera(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<PruebaDeComandera>> {
  const parsed = PruebaInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(first?.message ?? "Datos inválidos.");
  }

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para probar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("print_jobs")
    .insert({
      business_id: business.id,
      kind: "prueba",
      test_printer_ip: parsed.data.printer_ip,
      test_printer_port: parsed.data.printer_port,
      test_label: parsed.data.label,
      requested_by: ctx.userId ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("imprimirPruebaDeComandera", error);
    return actionError("No pudimos encolar la prueba.");
  }

  return actionOk({
    print_job_id: (data as { id: string }).id,
    printer_ip: parsed.data.printer_ip,
    printer_port: parsed.data.printer_port,
  });
}

export type EstadoPrueba = {
  /** `pendiente` = el agente todavía no la levantó; `impreso` = salió el papel. */
  status: "pendiente" | "impreso";
  /** El agente la intentó y no pudo (comandera apagada, IP equivocada). */
  failed: boolean;
  /** Lo último que reportó el agente, si falló. */
  error: string | null;
};

/**
 * Estado de una prueba, para que el formulario pueda decir «salió» / «no pudo»
 * en vez de dejar al encargado mirando la impresora. Se pollea desde el cliente
 * hasta que deja de estar `pendiente` o se agota la ventana (ver
 * `VENTANA_PRUEBA_MS` en el endpoint del agente).
 */
export async function estadoDePruebaDeComandera(
  businessSlug: string,
  printJobId: string,
): Promise<ActionResult<EstadoPrueba>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para probar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("print_jobs")
    .select("status, print_failed_at, business_id, kind, last_error")
    .eq("id", printJobId)
    .maybeSingle();

  const job = data as {
    status: string;
    print_failed_at: string | null;
    business_id: string;
    kind: string;
    last_error: string | null;
  } | null;

  // Cross-tenant: el id viaja por el cliente, así que la fila tiene que ser de
  // este negocio y de esta familia de papel.
  if (!job || job.business_id !== business.id || job.kind !== "prueba") {
    return actionError("Prueba no encontrada.");
  }

  return actionOk({
    status: job.status === "impreso" ? "impreso" : "pendiente",
    failed: Boolean(job.print_failed_at),
    error: job.last_error ?? null,
  });
}
