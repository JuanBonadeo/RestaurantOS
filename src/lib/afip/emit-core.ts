import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { notifyInvoiceFailed } from "@/lib/notifications/events";
import { notifyInvoiceIssued } from "@/lib/notifications/invoice-notify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calculateAmounts } from "./calculate-amounts";
import { esCondicionValidaPara } from "./condicion-iva";
import { normalizarCuit } from "./cuit";
import {
  buscarEntidadPorCuit,
  getFiscalEntity,
  resolverEntidadParaFactura,
} from "./fiscal-entities";
import { formatInvoiceNumber, tipoLabel } from "./format";
import { buildProvider, loadAFIPConfig, terminalPatch } from "./reconcile";
import { selectProvider } from "./provider-config";
import type {
  CondicionIvaReceptor,
  Invoice,
  ProviderResult,
  TipoComprobante,
} from "./types";

type GenericClient = SupabaseClient;

/** Lo mínimo de un comprobante para nombrarlo en un mensaje de error. */
type InvoiceRef = {
  tipo_comprobante: TipoComprobante;
  punto_venta: number;
  numero: number | null;
};

const UNIQUE_VIOLATION = "23505";

export type EmitInput = {
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
  /**
   * Entidad fiscal elegida en el buscador del cobro (spec 150). Es una PISTA
   * del cliente, no la verdad: se acepta sólo si la entidad es de este negocio
   * y su CUIT coincide con el que se está emitiendo. Si no, se resuelve por la
   * clave natural `(business_id, cuit)`, que es la que manda.
   */
  fiscalEntityId?: string;
  slug: string;
  /** Clave de idempotencia explícita (opcional); por defecto `${orderId}:${tipo}`. */
  idempotencyKey?: string;
};

/** Valores válidos de condición IVA del receptor (RG 5616). Defensa runtime: el
 *  input viene del cliente, no confiamos solo en el tipo de TS. */
const CONDICION_IVA_VALIDA: readonly CondicionIvaReceptor[] = [1, 4, 5, 6];

export type EmitResult = {
  invoice: Invoice;
};

/**
 * El motor de emisión, sin auth y sin formulario (spec 147 · D2).
 *
 * Vive acá y NO en `emit-invoice.ts` por una razón concreta: ese archivo es
 * `"use server"`, donde **todo export es un endpoint público**. Exportar el
 * motor desde ahí para que lo llame el cobro sería publicar un action que emite
 * comprobantes fiscales sin pasar por `requireMozoActionContext`. Este módulo es
 * `server-only`: se importa, no se expone.
 *
 * Los dos callers aportan lo que el motor no decide:
 *   - `emitInvoice` (action)  → resuelve el negocio y autentica al operador.
 *   - `autoEmitInvoiceForOrder` → ya está adentro del cobro, con `auto: true`.
 *
 * `auto` cambia exactamente dos cosas: marca la fila (`auto_emitted`, para que
 * el cron sepa a quién avisarle) y, si el gateway rechaza en el acto, dispara
 * el aviso interno — nadie estaba mirando esa pantalla (D6).
 */
export async function emitInvoiceCore(
  businessId: string,
  input: EmitInput,
  opts: { auto?: boolean } = {},
): Promise<ActionResult<EmitResult>> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Config AFIP del negocio (CUIT, PV, modo, credencial del gateway).
  const afipConfig = await loadAFIPConfig(service, businessId);
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
    (orderRow as { business_id: string }).business_id !== businessId
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

  // Guard (spec 09): la orden ya tiene una factura autorizada VIGENTE. Sólo
  // bloquea `status = 'authorized'`: si la factura previa quedó `cancelled`
  // (anulada con su nota de crédito), la orden se puede re-facturar.
  //
  // spec 100 — el filtro era `.eq("tipo_comprobante", tipo)`, y el índice único
  // parcial también lleva el tipo: **una Factura A entraba limpia sobre una B
  // viva**. El caso llega solo — el cliente pide la A después de que le
  // hicimos la B— y terminaba con las dos autorizadas por el mismo consumo. Lo
  // único que lo tapaba era que la UI le pasa `existingInvoice` al cliente
  // (cobrar-desktop-client), o sea un blindaje de pantalla, no de servidor.
  // Para cambiar de tipo hay que anular la anterior (NC) y recién ahí emitir.
  //
  // Las NC quedan fuera del filtro a propósito: son comprobantes de la misma
  // orden y `authorized`, pero no son "la factura vigente" de nadie.
  const { data: existingAuth } = await service
    .from("invoices")
    .select("tipo_comprobante, punto_venta, numero")
    .eq("order_id", input.orderId)
    .in("tipo_comprobante", ["factura_a", "factura_b"])
    .eq("status", "authorized")
    .limit(1);
  const vigente = ((existingAuth ?? []) as InvoiceRef[])[0];
  if (vigente) {
    const mismoTipo = vigente.tipo_comprobante === tipo;
    return actionError(
      mismoTipo
        ? "Esta orden ya tiene una factura autorizada."
        : `Esta orden ya tiene la ${tipoLabel(vigente.tipo_comprobante)} ${formatInvoiceNumber(
            vigente.punto_venta,
            vigente.numero,
          )} autorizada. Anulala (se emite la nota de crédito) antes de emitir otro tipo de comprobante.`,
    );
  }

  // Selección de provider según modo fiscal. En producción sin credencial,
  // NO se llama al gateway.
  const selection = selectProvider(afipConfig);
  if (selection.kind === "error") return actionError(selection.message);
  const providerName = selection.kind === "sandbox" ? "sandbox" : "gateway";

  const amounts = calculateAmounts(facturableCents);
  const idempotencyKey = input.idempotencyKey ?? `${input.orderId}:${tipo}`;

  // spec 150 · D5 — a quién se le factura, para poder responder después «qué le
  // facturamos a este cliente» (la liquidación mensual del sanatorio).
  //
  // Acá sólo se BUSCA la entidad que ya existe; la que no está se crea recién
  // cuando el comprobante no fue rechazado (más abajo). Un CUIT que ARCA rebota
  // no debería dejar una entidad basura en la lista para siempre.
  const entidadExistente = input.cuitReceptor
    ? await resolverEntidadElegida(service, businessId, input)
    : null;

  // ── RESERVA ──────────────────────────────────────────────────────
  // Insertamos un comprobante `pending` ANTES de llamar al provider. El índice
  // único parcial (business, order, tipo) where status in (pending, authorized)
  // garantiza que un doble click / reintento concurrente no genere una segunda
  // emisión: el segundo insert choca y reusamos el comprobante existente.
  const { data: reserved, error: resErr } = await service
    .from("invoices")
    .insert({
      business_id: businessId,
      order_id: input.orderId,
      payment_id: input.paymentId ?? null,
      tipo_comprobante: tipo,
      punto_venta: afipConfig.puntoVenta,
      numero: null,
      cuit_receptor: input.cuitReceptor ?? null,
      razon_social_receptor: input.razonSocialReceptor ?? null,
      condicion_iva_receptor: input.condicionIvaReceptor ?? null,
      fiscal_entity_id: entidadExistente?.id ?? null,
      total_cents: amounts.totalCents,
      neto_cents: amounts.netoCents,
      iva_cents: amounts.ivaCents,
      iva_rate: amounts.ivaRate,
      status: "pending",
      provider: providerName,
      idempotency_key: idempotencyKey,
      // spec 147 — de dónde nació. La emisión manual falla en la cara del
      // operador; ésta falla sin nadie mirando, y el cron lo lee para saberlo.
      auto_emitted: opts.auto === true,
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
  const provider = buildProvider(selection, businessId);
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
          business_id: businessId,
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
    // spec 147 · D6 — el rechazo en el acto. El caller manual devuelve este
    // error a una pantalla que alguien está mirando; el automático no tiene
    // pantalla, así que el aviso interno es su única salida. Best-effort: un
    // fallo del aviso no puede cambiar el desenlace fiscal.
    if (opts.auto) {
      await notifyInvoiceFailed({
        businessId,
        invoiceId: invoice.id,
      }).catch((err) => console.error("auto-emisión: aviso de fallo", err));
    }
    return actionError(
      `AFIP rechazó el comprobante: ${result.error ?? "error desconocido"}`,
    );
  }

  // spec 150 · D4 — el CUIT que no estaba cargado queda cargado, y la próxima
  // factura a ese receptor ya lo encuentra en el buscador. Se hace acá y no en
  // la reserva porque hasta este punto el gateway podía rechazar el
  // comprobante: recién ahora sabemos que el CUIT sirve para algo.
  //
  // Best-effort: la entidad es un índice para buscar, no el comprobante. El
  // CUIT y la razón social ya están guardados en la propia factura, que es el
  // dato fiscal que vale — si esto falla, no se toca lo que ARCA autorizó.
  if (!entidadExistente && input.cuitReceptor) {
    const creada = await resolverEntidadParaFactura({
      service,
      businessId,
      cuit: input.cuitReceptor,
      razonSocial: input.razonSocialReceptor,
      condicionIva: input.condicionIvaReceptor,
    }).catch((err) => {
      console.error("emitInvoiceCore: alta de entidad fiscal", err);
      return null;
    });
    if (creada) {
      const { error: linkErr } = await service
        .from("invoices")
        .update({ fiscal_entity_id: creada.id })
        .eq("id", invoice.id);
      if (linkErr) console.error("emitInvoiceCore: vínculo con la entidad", linkErr);
      else invoice.fiscal_entity_id = creada.id;
    }
  }

  // spec 45 — comprobante al cliente por email (best-effort, idempotente).
  if (invoice.status === "authorized") {
    await notifyInvoiceIssued({ invoiceId: invoice.id });
  }

  return actionOk({ invoice });
}

/**
 * La entidad fiscal que ya está cargada para este comprobante.
 *
 * El `fiscalEntityId` que manda el buscador del cobro es una pista, no la
 * verdad: llega del cliente, así que sólo se acepta si la entidad es de este
 * negocio **y** su CUIT es el que se está emitiendo. Sin esas dos condiciones,
 * cualquiera podría colgarle una factura a la entidad que quisiera. Si la pista
 * no cierra, manda la clave natural `(business_id, cuit)`.
 */
async function resolverEntidadElegida(
  service: GenericClient,
  businessId: string,
  input: EmitInput,
): Promise<{ id: string } | null> {
  const cuit = normalizarCuit(input.cuitReceptor ?? "");
  if (cuit.length !== 11) return null;

  if (input.fiscalEntityId) {
    const elegida = await getFiscalEntity(service, businessId, input.fiscalEntityId);
    if (elegida && elegida.cuit === cuit) return elegida;
  }
  return buscarEntidadPorCuit(service, businessId, cuit);
}