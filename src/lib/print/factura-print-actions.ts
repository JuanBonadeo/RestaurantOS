"use server";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { resolveFiscalPrinter, type CajaFiscalPrinter } from "./fiscal-printer";

/**
 * Encola la impresión de una factura ya autorizada (spec 084).
 *
 * Sólo `authorized`: un comprobante `pending` todavía no tiene CAE ni QR, y uno
 * `failed` no existe para ARCA. Imprimir cualquiera de los dos sería entregarle
 * al cliente un papel que parece una factura y no lo es.
 *
 * Es **reimprimible** — el cliente vuelve al rato y la pide de nuevo. No emite
 * nada nuevo: mismo número, mismo CAE, y de la segunda copia en adelante el
 * ticket lo dice.
 */
export async function imprimirFactura(
  invoiceId: string,
  businessSlug: string,
): Promise<ActionResult<{ print_job_id: string; reprint: boolean }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("Solo encargado o admin pueden imprimir facturas.");
  }

  const service = createSupabaseServiceClient();

  const { data: invoiceRow } = await service
    .from("invoices")
    .select("id, business_id, status, payment_id")
    .eq("id", invoiceId)
    .maybeSingle();

  const invoice = invoiceRow as {
    business_id: string;
    status: string;
    payment_id: string | null;
  } | null;
  if (!invoice || invoice.business_id !== business.id) {
    return actionError("Factura no encontrada.");
  }
  if (invoice.status !== "authorized") {
    return actionError(
      invoice.status === "pending"
        ? "La factura todavía no fue autorizada por ARCA."
        : "Solo se pueden imprimir facturas autorizadas.",
    );
  }

  const caja = await resolveCajaForInvoice(
    service,
    business.id,
    invoice.payment_id,
  );
  const printer = resolveFiscalPrinter(caja);
  if (!printer) {
    return actionError(
      caja
        ? `La caja ${caja.name} no tiene comandera fiscal configurada. Configurala en Ajustes → Operación del local.`
        : "No hay ninguna caja con comandera fiscal configurada.",
    );
  }

  const { count: previas } = await service
    .from("print_jobs")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId)
    .eq("kind", "factura");
  const reprint = (previas ?? 0) > 0;

  const { data: inserted, error } = await service
    .from("print_jobs")
    .insert({
      invoice_id: invoiceId,
      business_id: business.id,
      kind: "factura",
      requested_by: ctx.user?.id ?? null,
      reprint_requested_at: reprint ? new Date().toISOString() : null,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    console.error("imprimirFactura", error);
    return actionError("No pudimos mandar la factura a la impresora.");
  }

  return actionOk({
    print_job_id: (inserted as { id: string }).id,
    reprint,
  });
}

/**
 * La caja de una factura: la de su pago. `invoices.payment_id` es nullable
 * (nota de crédito, comprobante suelto), así que sin pago cae a la caja por
 * defecto del negocio (`cajas.is_default`, migración 0025).
 */
async function resolveCajaForInvoice(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
  paymentId: string | null,
): Promise<CajaFiscalPrinter | null> {
  const cols =
    "id, name, fiscal_printer_ip, fiscal_printer_port, fiscal_printer_enabled";

  if (paymentId) {
    const { data: payment } = await service
      .from("payments")
      .select(`caja_id, cajas!inner(${cols})`)
      .eq("id", paymentId)
      .eq("business_id", businessId)
      .maybeSingle();
    const raw = (payment as unknown as { cajas: unknown } | null)?.cajas;
    const caja = (Array.isArray(raw) ? raw[0] : raw) as
      | CajaFiscalPrinter
      | undefined;
    if (caja) return caja;
  }

  const { data: fallback } = await service
    .from("cajas")
    .select(cols)
    .eq("business_id", businessId)
    .eq("is_default", true)
    .maybeSingle();
  return (fallback as CajaFiscalPrinter | null) ?? null;
}
