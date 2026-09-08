"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canAnularFactura } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { calculateAmounts } from "./calculate-amounts";
import { formatCuit } from "./cuit";
import {
  bloqueoPorComprobanteVigente,
  emitInvoiceCore,
  ordenEstaAnulada,
  ORDEN_ANULADA_MSG,
  type EmitInput,
  type EmitResult,
} from "./emit-core";
import type { AFIPProviderClient } from "./provider";
import { selectProvider } from "./provider-config";
import {
  applyGatewayStatus,
  buildProvider,
  loadAFIPConfig,
  terminalPatch,
} from "./reconcile";
import type {
  CondicionIvaReceptor,
  Invoice,
  ProviderResult,
  TipoComprobante,
} from "./types";

type GenericClient = SupabaseClient;

const UNIQUE_VIOLATION = "23505";

/** Ventana máxima de polling inline (anular): el worker suele resolver en segundos. */
const INLINE_POLL_TIMEOUT_MS = 90_000;
const INLINE_POLL_INTERVAL_MS = 3_000;

/**
 * Emite un comprobante para una orden, a pedido de una pantalla.
 *
 * Es la puerta autenticada del motor: resuelve el negocio por slug, exige
 * contexto de operador y delega en `emitInvoiceCore`. El motor vive en un
 * módulo `server-only` (spec 147 · D2) porque este archivo es `"use server"` y
 * cada export suyo es un endpoint público — el cobro automático necesita el
 * motor sin auth de pantalla, y publicarlo acá sería regalar la emisión fiscal.
 */
export async function emitInvoice(
  input: EmitInput,
): Promise<ActionResult<EmitResult>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  return emitInvoiceCore(business.id, input);
}

/**
 * Pollea el estado de una factura `pending` contra el gateway y persiste el
 * desenlace (authorized/failed). Idempotente: si otra llamada ya la resolvió,
 * devuelve la fila fresca. La UI la llama en loop hasta estado terminal.
 */
export async function pollInvoiceStatus(
  invoiceId: string,
  slug: string,
): Promise<ActionResult<EmitResult>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: invRow } = await service
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (
    !invRow ||
    (invRow as { business_id: string }).business_id !== business.id
  ) {
    return actionError("Factura no encontrada.");
  }
  const inv = invRow as Invoice;

  // Ya terminal, o sin job que pollear (sandbox): devolver tal cual.
  if (inv.status !== "pending" || !inv.provider_job_id) {
    return actionOk({ invoice: inv });
  }

  const afipConfig = await loadAFIPConfig(service, business.id);
  if (!afipConfig) return actionError("AFIP no configurado.");
  const selection = selectProvider(afipConfig);
  if (selection.kind === "error") return actionError(selection.message);
  const provider = buildProvider(selection, business.id);

  // La consulta y la persistencia son las MISMAS que usa el cron de
  // reconciliación (spec 088): acá sólo agregamos el gate de usuario. Si cada
  // camino tuviera su copia, la factura se cerraría distinto según quién llegue
  // primero.
  const { invoice } = await applyGatewayStatus(service, inv, provider);
  return actionOk({ invoice });
}

/** Pollea inline (server-side) un job del provider hasta estado terminal. */
async function waitForTerminal(
  provider: AFIPProviderClient,
  initial: ProviderResult,
): Promise<ProviderResult> {
  if (initial.state !== "pending" || !initial.jobId) return initial;
  const deadline = Date.now() + INLINE_POLL_TIMEOUT_MS;
  let last = initial;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, INLINE_POLL_INTERVAL_MS));
    try {
      last = await provider.getStatus(initial.jobId);
    } catch {
      continue;
    }
    if (last.state !== "pending") return last;
  }
  return {
    ...last,
    success: false,
    state: "pending",
    error: last.error ?? "Timeout esperando la respuesta de ARCA.",
  };
}

export async function retryInvoice(
  invoiceId: string,
  slug: string,
): Promise<ActionResult<EmitResult>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo admin o encargado pueden reintentar facturas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: invoiceRow } = await service
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (
    !invoiceRow ||
    (invoiceRow as { business_id: string }).business_id !== business.id
  ) {
    return actionError("Factura no encontrada.");
  }
  const inv = invoiceRow as Invoice;
  if (inv.status !== "failed") {
    return actionError("Solo se pueden reintentar facturas fallidas.");
  }

  // #274 · 2 — «Reintentar» pasa por las MISMAS guardas que emitir.
  //
  // Esta action no llama a `emitInvoiceCore`: encola contra el provider
  // directo. Así que las dos guardas del motor —orden anulada (spec 092) y
  // comprobante vigente cruzando tipos (spec 100/147)— no existían de este
  // lado, y el único chequeo era `status !== "failed"`. En todo el archivo
  // `order_id` sólo se usaba para armar la idempotency-key.
  //
  // No es un camino de laboratorio: es el botón que la pantalla ofrece junto al
  // cartel rojo, y en golf-jcr hubo 14 rechazos en un mes. Los dos desenlaces
  // que habilitaba eran fiscales y sólo se sacan con nota de crédito:
  //
  //   (a) La factura queda `failed`, y una `failed` no bloquea ni `anularCobro`
  //       ni la anulación de la mesa. Con la mesa ya anulada, Reintentar sacaba
  //       un CAE nuevo por una venta que no ocurrió.
  //   (b) Se pidió una A, ARCA la rechazó, se emitió una B para salir del paso.
  //       Reintentar la A dejaba las dos autorizadas por el mismo consumo: el
  //       índice único parcial es (business, order, tipo) y A ≠ B, así que la
  //       base tampoco lo frena.
  if (inv.order_id) {
    const { data: orderRow } = await service
      .from("orders")
      .select("business_id, status, lifecycle_status")
      .eq("id", inv.order_id)
      .maybeSingle();
    const order = orderRow as {
      business_id: string;
      status: string;
      lifecycle_status: string;
    } | null;
    if (!order || order.business_id !== business.id) {
      return actionError("Orden no encontrada.");
    }
    if (ordenEstaAnulada(order)) {
      return actionError(ORDEN_ANULADA_MSG);
    }

    // Sólo para facturas: una nota de crédito NO es "la factura vigente" de la
    // orden y compararla contra la factura que anula daría un mensaje absurdo.
    // El reintento de la MISMA letra lo sigue frenando el índice único (el
    // 23505 de más abajo); esto cubre el cruce, que es el que nadie miraba.
    if (
      inv.tipo_comprobante === "factura_a" ||
      inv.tipo_comprobante === "factura_b"
    ) {
      const bloqueo = await bloqueoPorComprobanteVigente(
        service,
        inv.order_id,
        inv.tipo_comprobante,
      );
      if (bloqueo) return actionError(bloqueo);
    }
  }

  const afipConfig = await loadAFIPConfig(service, business.id);
  if (!afipConfig) return actionError("AFIP no configurado.");

  const selection = selectProvider(afipConfig);
  if (selection.kind === "error") return actionError(selection.message);

  const provider = buildProvider(selection, business.id);

  // Reintento SIEMPRE con nueva idempotency-key: un rechazo previo del gateway
  // (dato inválido) exige reemitir con clave distinta (guía §2). Es seguro: una
  // factura `failed` nunca produjo CAE, así que no hay riesgo de duplicar.
  const newKey = `${inv.order_id ?? inv.id}:${inv.tipo_comprobante}:retry:${Date.now().toString(36)}`;

  let result: ProviderResult;
  try {
    result = await provider.enqueue(
      {
        tipo: inv.tipo_comprobante,
        puntoVenta: inv.punto_venta,
        cuitEmisor: afipConfig.cuit,
        cuitReceptor: inv.cuit_receptor ?? undefined,
        razonSocialReceptor: inv.razon_social_receptor ?? undefined,
        // Condición IVA persistida (spec 053): re-derivarla del tipo re-introduciría
        // el bug R-C6 justo en el reintento de un comprobante fiscal real.
        condicionIvaReceptor: inv.condicion_iva_receptor ?? undefined,
        totalCents: inv.total_cents,
        concepto: "productos",
      },
      newKey,
    );
  } catch (err) {
    result = {
      success: false,
      state: "failed",
      error: `Error de red con el gateway: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const patch =
    result.state === "pending"
      ? {
          status: "pending",
          idempotency_key: newKey,
          provider_job_id: result.jobId ?? null,
          error_message: null,
          provider_response: result.rawResponse ?? null,
        }
      : { ...terminalPatch(result), idempotency_key: newKey };

  const { error: updErr } = await service
    .from("invoices")
    .update(patch)
    .eq("id", invoiceId);

  if (updErr) {
    // Otro comprobante vigente ganó la carrera (índice único parcial).
    if ((updErr as PostgrestError).code === UNIQUE_VIOLATION) {
      return actionError("Esta orden ya tiene una factura autorizada.");
    }
    return actionError(`Error guardando reintento: ${updErr.message}`);
  }

  if (result.state === "failed") {
    return actionError(
      `Reintento fallido: ${result.error ?? "error desconocido"}`,
    );
  }

  const { data: updated } = await service
    .from("invoices")
    .select()
    .eq("id", invoiceId)
    .single();

  return actionOk({ invoice: updated as Invoice });
}

/** Factura → nota de crédito del mismo tipo fiscal (A↔A, B↔B). */
const NC_TIPO: Partial<Record<TipoComprobante, TipoComprobante>> = {
  factura_a: "nota_credito_a",
  factura_b: "nota_credito_b",
};

type AnularInput = {
  invoiceId: string;
  motivo: string;
  slug: string;
};

type AnularResult = {
  /** Factura original, ya con `status = 'cancelled'` y motivo persistido. */
  original: Invoice;
  /** Nota de crédito emitida que respalda la anulación. */
  notaCredito: Invoice;
};

/**
 * Anula un comprobante `authorized` (spec 09). En AR no se "borra" una factura:
 * se emite la **nota de crédito** asociada y la original queda `cancelled` con
 * el motivo persistido. Permiso: encargado/admin (el mozo no anula). Habilita
 * re-facturar la orden, porque el guard de `emitInvoice` deja de ver una
 * factura `authorized` vigente.
 *
 * El gateway exige `comprobantes_asociados` para la NC. Como la NC es asíncrona
 * y sólo debemos marcar la original `cancelled` cuando la NC quedó realmente
 * autorizada, acá polleamos inline hasta estado terminal (el worker resuelve en
 * segundos).
 */
export async function anularFactura(
  input: AnularInput,
): Promise<ActionResult<AnularResult>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canAnularFactura(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden anular facturas.");
  }

  const motivo = input.motivo.trim();
  if (!motivo) {
    return actionError("El motivo de anulación es obligatorio.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: invoiceRow } = await service
    .from("invoices")
    .select("*")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (
    !invoiceRow ||
    (invoiceRow as { business_id: string }).business_id !== business.id
  ) {
    return actionError("Factura no encontrada.");
  }
  const original = invoiceRow as Invoice;

  if (original.status !== "authorized") {
    return actionError(
      "Solo se pueden anular comprobantes autorizados. Las facturas fallidas se descartan o reintentan.",
    );
  }

  const ncTipo = NC_TIPO[original.tipo_comprobante];
  if (!ncTipo) {
    return actionError("Este comprobante no se puede anular con nota de crédito.");
  }
  if (original.numero == null) {
    return actionError(
      "La factura original no tiene número asignado; no se puede emitir la nota de crédito.",
    );
  }

  const afipConfig = await loadAFIPConfig(service, business.id);
  if (!afipConfig) return actionError("AFIP no configurado.");

  const selection = selectProvider(afipConfig);
  if (selection.kind === "error") return actionError(selection.message);
  const providerName = selection.kind === "sandbox" ? "sandbox" : "gateway";

  // Encolar la NC por el mismo total, referenciando la factura original.
  const provider = buildProvider(selection, business.id);
  const ncKey = `anular:${original.id}`;
  let result: ProviderResult;
  try {
    result = await provider.enqueue(
      {
        tipo: ncTipo,
        puntoVenta: afipConfig.puntoVenta,
        cuitEmisor: afipConfig.cuit,
        cuitReceptor: original.cuit_receptor ?? undefined,
        razonSocialReceptor: original.razon_social_receptor ?? undefined,
        // La NC hereda la condición IVA declarada de la factura original (spec 053).
        condicionIvaReceptor: original.condicion_iva_receptor ?? undefined,
        totalCents: original.total_cents,
        concepto: "productos",
        comprobantesAsociados: [
          {
            tipo: original.tipo_comprobante,
            puntoVenta: original.punto_venta,
            numero: original.numero,
          },
        ],
      },
      ncKey,
    );
  } catch (err) {
    result = {
      success: false,
      state: "failed",
      error: `Error de red con el gateway: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Esperar el desenlace de la NC (polleo inline si quedó pending).
  result = await waitForTerminal(provider, result);

  if (result.state !== "authorized") {
    // La factura original NO cambia de estado si la NC no se autorizó.
    const detail =
      result.state === "pending"
        ? "La nota de crédito quedó en proceso en ARCA. Reintentá la anulación en unos segundos."
        : (result.error ?? "error desconocido");
    return actionError(`No se pudo emitir la nota de crédito: ${detail}`);
  }

  const amounts = calculateAmounts(original.total_cents);

  // Persistir la nota de crédito como fila propia, linkeada a la factura que
  // anula (cancels_invoice_id). Distinto tipo_comprobante ⇒ no choca con el
  // índice único parcial de comprobantes vigentes por orden.
  const { data: ncRow, error: ncErr } = await service
    .from("invoices")
    .insert({
      business_id: business.id,
      order_id: original.order_id,
      payment_id: original.payment_id,
      tipo_comprobante: ncTipo,
      punto_venta: afipConfig.puntoVenta,
      numero: result.numero ?? null,
      cae: result.cae ?? null,
      cae_vencimiento: result.caeVencimiento ?? null,
      qr_url: result.qrUrl ?? null,
      cuit_receptor: original.cuit_receptor,
      razon_social_receptor: original.razon_social_receptor,
      condicion_iva_receptor: original.condicion_iva_receptor,
      total_cents: amounts.totalCents,
      neto_cents: amounts.netoCents,
      iva_cents: amounts.ivaCents,
      iva_rate: amounts.ivaRate,
      status: "authorized",
      provider: providerName,
      provider_job_id: result.jobId ?? null,
      provider_response: result.rawResponse ?? null,
      idempotency_key: ncKey,
      cancels_invoice_id: original.id,
    })
    .select()
    .single();

  if (ncErr || !ncRow) {
    return actionError(`Error guardando la nota de crédito: ${ncErr?.message}`);
  }
  const notaCredito = ncRow as Invoice;

  // Marcar la factura original como anulada + persistir el motivo.
  const { data: cancelledRow, error: cancelErr } = await service
    .from("invoices")
    .update({
      status: "cancelled",
      cancelled_reason: motivo,
      cancelled_by: ctxResult.data.userId, // spec 34 — responsable de la anulación
    })
    .eq("id", original.id)
    .select()
    .single();

  if (cancelErr || !cancelledRow) {
    return actionError(
      `Nota de crédito emitida pero no se pudo marcar la factura: ${cancelErr?.message}`,
    );
  }

  return actionOk({
    original: cancelledRow as Invoice,
    notaCredito,
  });
}


type CambiarTipoInput = {
  /** La factura vigente que se reemplaza (hoy, siempre una B). */
  invoiceId: string;
  slug: string;
  cuitReceptor: string;
  razonSocialReceptor?: string;
  condicionIvaReceptor: CondicionIvaReceptor;
  /** Entidad fiscal elegida en el buscador (spec 150). */
  fiscalEntityId?: string;
};

type CambiarTipoResult = {
  notaCredito: Invoice;
  facturaA: Invoice;
};

/**
 * Reemplaza una Factura B ya autorizada por una Factura A (spec 156 · D5).
 *
 * Es el caso que queda cuando **el cliente pide la A después**, mirando el
 * ticket que ya se le dio. Con la elección antes de cobrar (D1) el otro caso
 * —«la eligió y salió otra cosa»— desaparece; éste no, porque nadie puede
 * adivinar que el comensal iba a pedir factura al irse.
 *
 * Hasta hoy el camino existía pero era inviable: el mensaje del guard decía
 * «anulala antes de emitir otro tipo», y hacerlo significaba salir del cobro,
 * buscar el comprobante en Facturación, anularlo… y después no había dónde
 * emitir la A, porque la orden ya está cerrada y el sheet de cobro no vuelve.
 *
 * El orden importa y no es simétrico:
 *
 *  1. Se emite la **nota de crédito** de la B y se la marca anulada. Si esto
 *     falla, la B sigue viva y no se emitió nada: se puede reintentar.
 *  2. Recién ahí se emite la **A**. Si ESTO falla, la NC ya tiene CAE y no se
 *     deshace — así que el error lo dice con todas las letras en vez de fingir
 *     que no pasó nada.
 *
 * El motivo de la anulación no se le pregunta a nadie: lo sabemos. Un campo
 * libre acá se llena con «cambio» y no explica nada dentro de seis meses.
 */
export async function cambiarTipoDeComprobante(
  input: CambiarTipoInput,
): Promise<ActionResult<CambiarTipoResult>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canAnularFactura(ctxResult.data.role)) {
    return actionError(
      "Solo encargado o admin pueden cambiar el tipo de comprobante.",
    );
  }

  const cuit = input.cuitReceptor.replace(/\D/g, "");
  if (cuit.length !== 11) {
    return actionError("El CUIT del receptor debe tener 11 dígitos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: originalRow } = await service
    .from("invoices")
    .select("*")
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (
    !originalRow ||
    (originalRow as { business_id: string }).business_id !== business.id
  ) {
    return actionError("Factura no encontrada.");
  }
  const original = originalRow as Invoice;

  if (original.tipo_comprobante !== "factura_b") {
    return actionError("Solo se puede cambiar una Factura B por una Factura A.");
  }
  if (!original.order_id) {
    return actionError(
      "Este comprobante no está asociado a un pedido; no se puede reemplazar.",
    );
  }

  // ── 1. Anular la B ───────────────────────────────────────────────
  // Reusa el camino de la spec 09, que ya emite la NC, espera su CAE y sólo
  // entonces marca la original `cancelled`. Si la NC no se autoriza, la B queda
  // intacta (escenario 10).
  const anulada = await anularFactura({
    invoiceId: original.id,
    motivo: `Se reemplaza por Factura A a ${formatCuit(cuit)}`,
    slug: input.slug,
  });
  if (!anulada.ok) return anulada;

  // ── 2. Emitir la A ───────────────────────────────────────────────
  // Clave de idempotencia propia: la derivada del pedido ya la gastó la B.
  const emitida = await emitInvoiceCore(business.id, {
    orderId: original.order_id,
    paymentId: original.payment_id ?? undefined,
    tipoComprobante: "factura_a",
    cuitReceptor: cuit,
    razonSocialReceptor: input.razonSocialReceptor,
    condicionIvaReceptor: input.condicionIvaReceptor,
    fiscalEntityId: input.fiscalEntityId,
    slug: input.slug,
    idempotencyKey: `cambio:${original.id}:factura_a`,
  });

  if (!emitida.ok) {
    // La NC ya tiene CAE: no se puede volver atrás. Decirlo es lo único
    // honesto — la orden quedó sin comprobante vigente y alguien tiene que
    // emitir la A desde Facturación.
    return actionError(
      `La Factura B quedó anulada con su nota de crédito, pero la Factura A no se emitió: ${emitida.error} — reintentala desde Facturación.`,
    );
  }

  return actionOk({
    notaCredito: anulada.data.notaCredito,
    facturaA: emitida.data.invoice,
  });
}
