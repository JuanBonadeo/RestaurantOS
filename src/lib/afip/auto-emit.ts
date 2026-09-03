import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { emitInvoiceCore } from "./emit-core";

type GenericClient = SupabaseClient;

/**
 * Encola el comprobante de una orden recién saldada (spec 147).
 *
 * MaxiRest emitía por operación —el comprobante vivía en la propia apertura de
 * mesa—, así que cerrar la mesa **era** facturar y nadie tenía que acordarse.
 * Acá el mecanismo no se puede copiar (WSFE es async: no existe «emitir al
 * cerrar», existe encolar al cerrar), pero sí el comportamiento: toda mesa
 * cobrada termina en comprobante sin que nadie apriete nada.
 *
 * Cuatro gates, en orden de barato a caro:
 *
 *   1. `afip_auto_emit` prendido en el negocio (D3). Apagado por defecto: un
 *      negocio que factura a mano no se despierta emitiendo por un deploy.
 *   2. CUIT + punto de venta cargados. Sin eso el negocio no factura y esta
 *      función no existe para él.
 *   3. Base facturable > 0. Una cuenta que es toda propina no tiene qué
 *      declarar: la propina no integra la base imponible en AR (spec 36 · R-C1).
 *   4. Ninguna `invoice` viva para la orden (D5). Emitir dos veces es un
 *      comprobante fiscal duplicado, y eso se arregla con nota de crédito y una
 *      llamada al contador.
 *
 * Sobre (4): el índice único parcial `(business, order, tipo)` ya impide la
 * segunda **del mismo tipo**, pero no cruza tipos — una Factura A `pending`
 * cargada a mano mientras se cobra dejaría entrar la B automática. La guarda
 * mira los dos. Y la clave de idempotencia sigue siendo la derivada del
 * `order_id` (`${orderId}:${tipo}`, el default del motor), no una random: la
 * reconciliación anti-duplicado del gateway es **por job**, así que un job
 * nuevo no la hereda (spec 088).
 *
 * Devuelve qué pasó, para el log del caller. Nunca tira: la plata no depende
 * de ARCA — si esto falla, el cobro se cierra igual.
 */
export type AutoEmitOutcome =
  | "off"
  | "sin-afip"
  | "sin-base"
  | "ya-tiene"
  | "encolada"
  | "rechazada";

export async function autoEmitInvoiceForOrder(params: {
  service: GenericClient;
  businessId: string;
  slug: string;
  order: { id: string; total_cents: number; tip_cents: number };
}): Promise<AutoEmitOutcome> {
  const { service, businessId, slug, order } = params;

  const { data: bizRow } = await service
    .from("businesses")
    .select("afip_auto_emit, afip_cuit, afip_punto_venta")
    .eq("id", businessId)
    .maybeSingle();
  const biz = bizRow as {
    afip_auto_emit: boolean | null;
    afip_cuit: string | null;
    afip_punto_venta: number | null;
  } | null;

  if (!biz?.afip_auto_emit) return "off";
  if (!biz.afip_cuit || !biz.afip_punto_venta) return "sin-afip";

  // Misma base que el motor: subtotal − descuento, SIN propina.
  if (order.total_cents - (order.tip_cents ?? 0) <= 0) return "sin-base";

  const { data: vivas } = await service
    .from("invoices")
    .select("id")
    .eq("order_id", order.id)
    .in("tipo_comprobante", ["factura_a", "factura_b"])
    .in("status", ["pending", "authorized"])
    .limit(1);
  if ((vivas ?? []).length > 0) return "ya-tiene";

  // Factura B a consumidor final, siempre (D4): es el 97 % del caso real
  // (ratio B:A de 40:1 en MaxiRest) y el único tipo que se puede emitir **sin
  // pedirle datos a nadie**. La A necesita CUIT y condición de IVA (spec 053),
  // o sea alguien tipeando — sigue siendo el flujo manual, y por eso el botón
  // «Emitir comprobante» no se va. Tampoco se usa `afip_default_tipo`: si un
  // negocio lo tiene en `factura_a`, la automática sería un rechazo por mesa.
  const result = await emitInvoiceCore(
    businessId,
    { orderId: order.id, slug, tipoComprobante: "factura_b" },
    { auto: true },
  );

  return result.ok ? "encolada" : "rechazada";
}
