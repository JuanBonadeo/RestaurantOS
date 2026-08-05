"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { notifyInvoiceIssued } from "@/lib/notifications/invoice-notify";
import { canAnularFactura } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { calculateAmounts } from "./calculate-amounts";
import { esCondicionValidaPara } from "./condicion-iva";
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

type EmitInput = {
  orderId: string;
  paymentId?: string;
  tipoComprobante?: TipoComprobante;
  cuitReceptor?: string;
  razonSocialReceptor?: string;
  /**
   * Condición IVA del receptor (RG 5616): 1=RI, 4=Exento, 5=Consumidor Final,
   * 6=Monotributo. Obligatoria en Factura/NC B con CUIT (spec 053). Ausente →
   * default histórico por tipo.
   */
  condicionIvaReceptor?: CondicionIvaReceptor;
  slug: string;
  /** Clave de idempotencia explícita (opcional); por defecto `${orderId}:${tipo}`. */
  idempotencyKey?: string;
};

/** Valores válidos de condición IVA del receptor (RG 5616). Defensa runtime: el
 *  input viene del cliente, no confiamos solo en el tipo de TS. */
const CONDICION_IVA_VALIDA: readonly CondicionIvaReceptor[] = [1, 4, 5, 6];

type EmitResult = {
  invoice: Invoice;
};

export async function emitInvoice(
  input: EmitInput,
): Promise<ActionResult<EmitResult>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Config AFIP del negocio (CUIT, PV, modo, credencial del gateway).
  const afipConfig = await loadAFIPConfig(service, business.id);
  if (!afipConfig) {
    return actionError(
      "AFIP no está configurado. Pedile al admin que cargue CUIT y punto de venta.",
    );
  }

  // Validar order.
  const { data: orderRow } = await service
    .from("orders")
    .select(
      "id, business_id, total_cents, tip_cents, total_paid_cents, lifecycle_status, status",
    )
    .eq("id", input.orderId)
    .maybeSingle();
  if (
    !orderRow ||
    (orderRow as { business_id: string }).business_id !== business.id
  ) {
    return actionError("Orden no encontrada.");
  }
  const order = orderRow as {
    id: string;
    total_cents: number;
    tip_cents: number;
    lifecycle_status: string;
    status: string;
  };

  // spec 092 — no se factura una venta que no ocurrió.
  //
  // `lifecycle_status` se venía trayendo en el select desde siempre y **el cast
  // de acá lo tiraba**: la columna aparecía una sola vez en todo el archivo. El
  // camino real era el botón «Re-facturar» del detalle de un comprobante
  // fallido, que dispara con el `orderId` que viene del cliente: el encargado
  // anulaba la mesa 12 y minutos después salía una factura B **con CAE** por
  // los $80.000 completos de una mesa que nunca se cobró. Eso sólo se saca con
  // una nota de crédito.
  //
  // Se chequean los dos ejes (spec 091): hasta el backfill había 23 órdenes
  // anuladas que sólo lo decían por `lifecycle_status`.
  if (order.lifecycle_status === "cancelled" || order.status === "cancelled") {
    return actionError(
      "Esta orden está anulada — no se puede emitir un comprobante.",
    );
  }
  // Base facturable ARCA = subtotal − descuento (SIN propina). `total_cents` ya
  // suma la propina (billing/totals.ts:18) y la propina no integra la base
  // imponible en AR. `total_cents` queda intacto para el cobro/posnet; solo el
  // comprobante fiscal la excluye. (spec 36 · R-C1; corrige lo que spec 06 dio
  // por hecho.)
  const facturableCents = order.total_cents - (order.tip_cents ?? 0);

  const tipo = input.tipoComprobante ?? afipConfig.defaultTipo;

  // Factura A requiere CUIT receptor.
  if ((tipo === "factura_a" || tipo === "nota_credito_a") && !input.cuitReceptor) {
    return actionError("Para factura/NC tipo A se requiere CUIT del receptor.");
  }

  // R-C6 (spec 053): defensa runtime de la condición IVA — el input viene del
  // cliente, no confiamos solo en el tipo de TS.
  if (
    input.condicionIvaReceptor != null &&
    !CONDICION_IVA_VALIDA.includes(input.condicionIvaReceptor)
  ) {
    return actionError("Condición de IVA del receptor inválida.");
  }

  // R-C6 (spec 053): un comprobante B/NC-B con CUIT identifica al receptor
  // (doc_tipo 80), así que EXIGE declarar su condición de IVA real
  // (Monotributo/Exento/CF). Sin ella, `condicionIvaFor` caería a Consumidor
  // Final (5) → mala declaración ante ARCA. Antes esto se rechazaba de plano
  // (blindaje interino del 36C); ahora se soporta pidiendo la condición.
  if (
    (tipo === "factura_b" || tipo === "nota_credito_b") &&
    input.cuitReceptor &&
    input.condicionIvaReceptor == null
  ) {
    return actionError(
      "Para una Factura B con CUIT elegí la condición de IVA del receptor (Monotributo, Exento o Consumidor Final).",
    );
  }

  // R-C6 (spec 053): coherencia (tipo, CUIT, condición) — RG 5616. Sin esto, la
  // UI/otros callers podrían declarar combos inválidos (Factura A a Consumidor
  // Final, condición ≠ CF sin CUIT, etc.) que antes el hardcode hacía imposibles.
  if (input.condicionIvaReceptor != null) {
    if (!input.cuitReceptor) {
      // doc_tipo 99 = consumidor final sin identificar: la única condición coherente es CF.
      if (input.condicionIvaReceptor !== 5) {
        return actionError(
          "Sin CUIT el receptor es consumidor final; no corresponde otra condición de IVA.",
        );
      }
    } else if (!esCondicionValidaPara(tipo, input.condicionIvaReceptor)) {
      return actionError(
        tipo === "factura_a" || tipo === "nota_credito_a"
          ? "Una Factura A se emite a Responsable Inscripto o Monotributo."
          : "Una Factura B se emite a Monotributo, Exento o Consumidor Final (un Responsable Inscripto recibe Factura A).",
      );
    }
  }

  // Guard (spec 09): la orden ya tiene una factura autorizada VIGENTE de este
  // tipo. Sólo bloquea `status = 'authorized'`: si la factura previa quedó
  // `cancelled` (anulada con su nota de crédito), la orden se puede re-facturar.
  const { data: existingAuth } = await service
    .from("invoices")
    .select("*")
    .eq("order_id", input.orderId)
    .eq("tipo_comprobante", tipo)
    .eq("status", "authorized")
    .maybeSingle();
  if (existingAuth) {
    return actionError("Esta orden ya tiene una factura autorizada.");
  }

  // Selección de provider según modo fiscal. En producción sin credencial,
  // NO se llama al gateway.
  const selection = selectProvider(afipConfig);
  if (selection.kind === "error") return actionError(selection.message);
  const providerName = selection.kind === "sandbox" ? "sandbox" : "gateway";

  const amounts = calculateAmounts(facturableCents);
  const idempotencyKey = input.idempotencyKey ?? `${input.orderId}:${tipo}`;

  // ── RESERVA ──────────────────────────────────────────────────────
  // Insertamos un comprobante `pending` ANTES de llamar al provider. El índice
  // único parcial (business, order, tipo) where status in (pending, authorized)
  // garantiza que un doble click / reintento concurrente no genere una segunda
  // emisión: el segundo insert choca y reusamos el comprobante existente.
  const { data: reserved, error: resErr } = await service
    .from("invoices")
    .insert({
      business_id: business.id,
      order_id: input.orderId,
      payment_id: input.paymentId ?? null,
      tipo_comprobante: tipo,
      punto_venta: afipConfig.puntoVenta,
      numero: null,
      cuit_receptor: input.cuitReceptor ?? null,
      razon_social_receptor: input.razonSocialReceptor ?? null,
      condicion_iva_receptor: input.condicionIvaReceptor ?? null,
      total_cents: amounts.totalCents,
      neto_cents: amounts.netoCents,
      iva_cents: amounts.ivaCents,
      iva_rate: amounts.ivaRate,
      status: "pending",
      provider: providerName,
      idempotency_key: idempotencyKey,
    })
    .select()
    .single();

  if (resErr || !reserved) {
    if ((resErr as PostgrestError | null)?.code === UNIQUE_VIOLATION) {
      // Ya hay un comprobante vigente para esta orden+tipo.
      const { data: current } = await service
        .from("invoices")
        .select("*")
        .eq("order_id", input.orderId)
        .eq("tipo_comprobante", tipo)
        .in("status", ["pending", "authorized"])
        .maybeSingle();
      if (current) {
        const cur = current as Invoice;
        if (cur.status === "authorized") {
          return actionError("Esta orden ya tiene una factura autorizada.");
        }
        // Emisión en curso: devolvemos el comprobante existente (idempotente).
        return actionOk({ invoice: cur });
      }
    }
    return actionError(`Error reservando factura: ${resErr?.message}`);
  }
  const reservedInvoice = reserved as Invoice;

  // ── ENCOLAR ──────────────────────────────────────────────────────
  const provider = buildProvider(selection, business.id);
  let result: ProviderResult;
  try {
    result = await provider.enqueue(
      {
        tipo,
        puntoVenta: afipConfig.puntoVenta,
        cuitEmisor: afipConfig.cuit,
        cuitReceptor: input.cuitReceptor,
        razonSocialReceptor: input.razonSocialReceptor,
        condicionIvaReceptor: input.condicionIvaReceptor,
        totalCents: facturableCents,
        concepto: "productos",
        // El gateway la devuelve en el webhook (spec 088, fase 2): correlacionar
        // por acá es más robusto que depender sólo del `job_id`.
        metadata: {
          invoice_id: reserved.id,
          business_id: business.id,
          slug: input.slug,
        },
      },
      idempotencyKey,
    );
  } catch (err) {
    result = {
      success: false,
      state: "failed",
      error: `Error de red con el gateway: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── PERSISTIR ────────────────────────────────────────────────────
  // - `pending` (gateway): guardamos el job_id; la UI pollea `pollInvoiceStatus`.
  // - `authorized` (sandbox) / `failed`: estado terminal directo.
  const patch =
    result.state === "pending"
      ? {
          status: "pending",
          provider_job_id: result.jobId ?? null,
          provider_response: result.rawResponse ?? null,
        }
      : terminalPatch(result);

  const { data: updated, error: updErr } = await service
    .from("invoices")
    .update(patch)
    .eq("id", reservedInvoice.id)
    .select()
    .single();

  if (updErr || !updated) {
    return actionError(`Error guardando factura: ${updErr?.message}`);
  }
  const invoice = updated as Invoice;

  // Sólo es error "duro" si el provider rechazó (failed). `pending` es OK: la UI
  // pollea hasta el CAE.
  if (result.state === "failed") {
    return actionError(
      `AFIP rechazó el comprobante: ${result.error ?? "error desconocido"}`,
    );
  }

  // spec 45 — comprobante al cliente por email (best-effort, idempotente).
  if (invoice.status === "authorized") {
    await notifyInvoiceIssued({ invoiceId: invoice.id });
  }

  return actionOk({ invoice });
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
