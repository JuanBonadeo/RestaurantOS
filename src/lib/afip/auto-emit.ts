import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { emitInvoiceCore, type EmitInput } from "./emit-core";

type GenericClient = SupabaseClient;

/**
 * Lo que el operador eligió en la pantalla de cobro (spec 156 · D1): tipo de
 * comprobante y, si es A, los datos del receptor.
 *
 * Es un `Pick` de `EmitInput` a propósito: el motor es el que sabe qué campos
 * hacen falta, y si mañana suma uno, esto no se queda atrás en silencio.
 */
export type ComprobanteElegido = Pick<
  EmitInput,
  | "tipoComprobante"
  | "cuitReceptor"
  | "razonSocialReceptor"
  | "condicionIvaReceptor"
  | "fiscalEntityId"
>;

/**
 * Validación de borde: esto llega del navegador. La coherencia fina (que una A
 * tenga CUIT, que la condición de IVA case con la letra, RG 5616) la valida
 * `emitInvoiceCore`, que es donde vive esa regla desde la spec 053 — acá sólo se
 * chequea la forma.
 *
 * Sólo facturas: una nota de crédito no se elige al cobrar, se emite anulando.
 */
export const ComprobanteElegidoSchema = z.object({
  tipoComprobante: z.enum(["factura_a", "factura_b"]),
  cuitReceptor: z.string().trim().max(20).optional(),
  razonSocialReceptor: z.string().trim().max(200).optional(),
  condicionIvaReceptor: z
    .union([z.literal(1), z.literal(4), z.literal(5), z.literal(6)])
    .optional(),
  fiscalEntityId: z.string().uuid().optional(),
});

/**
 * Encola el comprobante de una orden recién saldada (spec 147).
 *
 * MaxiRest emitía por operación —el comprobante vivía en la propia apertura de
 * mesa—, así que cerrar la mesa **era** facturar y nadie tenía que acordarse.
 * Acá el mecanismo no se puede copiar (WSFE es async: no existe «emitir al
 * cerrar», existe encolar al cerrar), pero sí el comportamiento: toda mesa
 * cobrada termina en comprobante sin que nadie apriete nada.
 *
 * Spec 156 · D1 — **si el operador eligió el comprobante en la pantalla de
 * cobro, se emite ESE**, no la B por defecto. El dato se sabe antes de cobrar en
 * los tres puntos que cobran; pedirlo después obligaba a emitir a ciegas y a
 * corregir con una nota de crédito, que es un comprobante fiscal real y no un
 * undo.
 *
 * Cuatro gates, en orden de barato a caro:
 *
 *   1. `afip_auto_emit` prendido en el negocio (D3). Apagado por defecto: un
 *      negocio que factura a mano no se despierta emitiendo por un deploy.
 *      **Una elección explícita saltea este gate** (spec 156 · D3): el flag
 *      protege la emisión que *nadie pidió*, y acá alguien la pidió tocando un
 *      control. Sin esto el cambio no le serviría a golf-jcr, que lo tiene
 *      apagado y es el único negocio real que hoy factura A.
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
 * Devuelve qué pasó, para el log del caller y para que la pantalla pueda avisar
 * si el comprobante que se pidió no salió. Nunca tira: la plata no depende de
 * ARCA — si esto falla, el cobro se cierra igual.
 */
export type AutoEmitOutcome =
  | "off"
  | "sin-afip"
  | "sin-base"
  | "ya-tiene"
  | "encolada"
  | "rechazada";

export type AutoEmitResult = {
  outcome: AutoEmitOutcome;
  /** El motivo del rechazo, para mostrárselo a quien acaba de cobrar. */
  error?: string;
};

export async function autoEmitInvoiceForOrder(params: {
  service: GenericClient;
  businessId: string;
  slug: string;
  order: { id: string; total_cents: number; tip_cents: number };
  /** Lo que el operador eligió al cobrar (spec 156). Ausente = como siempre. */
  comprobante?: ComprobanteElegido | null;
}): Promise<AutoEmitResult> {
  const { service, businessId, slug, order } = params;
  const elegido = params.comprobante ?? null;

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

  // D3 — el flag sólo gobierna la emisión que nadie pidió.
  if (!elegido && !biz?.afip_auto_emit) return { outcome: "off" };
  if (!biz?.afip_cuit || !biz.afip_punto_venta) return { outcome: "sin-afip" };

  // Misma base que el motor: subtotal − descuento, SIN propina.
  if (order.total_cents - (order.tip_cents ?? 0) <= 0) {
    return { outcome: "sin-base" };
  }

  const { data: vivas } = await service
    .from("invoices")
    .select("id")
    .eq("order_id", order.id)
    .in("tipo_comprobante", ["factura_a", "factura_b"])
    .in("status", ["pending", "authorized"])
    .limit(1);
  if ((vivas ?? []).length > 0) return { outcome: "ya-tiene" };

  // Sin elección, Factura B a consumidor final (spec 147 · D4): es el 97 % del
  // caso real (ratio B:A de 40:1 en MaxiRest) y el único tipo que se puede
  // emitir **sin pedirle datos a nadie**. NO se usa `afip_default_tipo`: si un
  // negocio lo tuviera en `factura_a`, la automática sería un rechazo por mesa.
  //
  // Con elección, sale lo elegido (spec 156 · D1) — y si es una A que ARCA
  // rechaza, **no se cae a B** (D4 de la 156): emitir una B a consumidor final
  // cuando se pidió una A a un CUIT es declarar una operación que no ocurrió.
  const result = await emitInvoiceCore(
    businessId,
    {
      orderId: order.id,
      slug,
      tipoComprobante: "factura_b",
      ...(elegido ?? {}),
    },
    // `auto` aunque lo haya elegido una persona: el campo distingue «nació del
    // cobro» de «nació de un botón», y después de cobrar nadie se queda mirando
    // el CAE. Si el gateway lo rechaza más tarde, es el aviso interno el único
    // que llega (reconcile.ts filtra por `auto_emitted`).
    { auto: true },
  );

  return result.ok
    ? { outcome: "encolada" }
    : { outcome: "rechazada", error: result.error };
}
