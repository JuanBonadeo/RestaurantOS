"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import type { AutoEmitResult, ComprobanteElegido } from "@/lib/afip/auto-emit";
import { calculateAdjustment } from "@/lib/billing/adjustment";
import { registrarPago } from "@/lib/billing/cobro-actions";
import {
  getCajasForBusiness,
  getPaymentMethodConfigs,
} from "@/lib/caja/queries";
import type { Caja, PaymentMethodConfig } from "@/lib/caja/types";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCargarPedido } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { persistOrder } from "./persist-order";
import { cancelarOrden } from "./cancel-order";
import { routeOrderToCocina } from "./route-to-cocina";
import { VentaMostradorInput } from "./schema";

type GenericClient = SupabaseClient;

export type VentaMostradorResult = {
  order_id: string;
  order_number: number;
  /** El número del día: el que sale impreso en la comanda. */
  daily_number: number;
  /** Lo que efectivamente pagó el cliente (total + ajuste del método). */
  cobrado_cents: number;
  /** Comandas creadas por el ruteo — 0 si nada de lo vendido tiene sector. */
  comandas_creadas: number;
  /** Ítems que no salieron a ninguna comandera (kiosco puro: alfajor, gaseosa). */
  items_sin_sector: number;
  /** El ruteo falló pero la venta quedó cobrada igual (el aviso es del caller). */
  ruteo_error: string | null;
  /**
   * Qué pasó con el comprobante, tal cual lo devuelve `registrarPago`. La
   * pantalla lo usa para avisar si el que se pidió no salió — la plata nunca
   * depende de ARCA (spec 147 · 156).
   */
  comprobante?: AutoEmitResult;
};

export type VentaMostradorInit = {
  cajas: Caja[];
  methodConfigs: PaymentMethodConfig[];
};

/**
 * Cajas + configuración de métodos para abrir el panel de venta rápida.
 *
 * `iniciarCobro` hace lo mismo pero exige una orden existente, y acá la venta
 * todavía no nació: el encargado elige la caja *antes* de que haya nada que
 * cobrar. Mismo gate de mostrador que la venta.
 */
export async function iniciarVentaMostrador(
  slug: string,
): Promise<ActionResult<VentaMostradorInit>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCargarPedido(ctxResult.data.role)) {
    return actionError("No tenés permiso para cargar ventas de mostrador.");
  }

  const [cajas, methodConfigs] = await Promise.all([
    getCajasForBusiness(business.id),
    getPaymentMethodConfigs(business.id),
  ]);
  if (cajas.length === 0) {
    return actionError(
      "No hay cajas configuradas. Creá una en Configuración antes de vender.",
    );
  }

  return actionOk({ cajas, methodConfigs });
}

/**
 * Nombre de cliente de las ventas de mostrador. Sirve de discriminador legible
 * en facturación/analítica junto con `table_id IS NULL`, igual que el concepto
 * del pedido flash.
 */
const CLIENTE_MOSTRADOR = "Mostrador";

/** Teléfono placeholder — mismo que usan el pedido flash y `cargarPedidoStaff`. */
const TELEFONO_MOSTRADOR = "-";

/**
 * Venta rápida de mostrador / kiosko / barra (spec 058): crea la orden con
 * productos reales de la carta, la cobra y la cierra **en un solo gesto**, sin
 * abrir mesa ni pedir datos del cliente.
 *
 * No hay motor nuevo — encadena lo que ya existe:
 *   `persistOrder` (orden sin `table_id`) → `registrarPago({ splitId: null })`
 *   → `closeOrderIfFullyPaid` → `routeOrderToCocina`.
 *
 * Dos decisiones que sostienen la feature:
 *
 * 1. **`delivery_type: "dine_in"` + `table_id: null`** (patrón del pedido
 *    flash). Con `dine_in` la venta queda fuera del board de pedidos — que
 *    filtra `.neq("delivery_type","dine_in")` — y sin mesa queda fuera del
 *    plano del salón, que lista por `table_id`. Se ve donde tiene que verse:
 *    en la caja y en la analítica del día.
 *
 * 2. **La plata primero, la cocina después.** Si el cobro falla, la orden se
 *    cancela (una `dine_in` sin mesa y sin cerrar sería invisible en toda la
 *    UI: plata fantasma). Si falla el ruteo a cocina, la venta **no** se
 *    revierte — el dinero ya entró y la comanda se reimprime desde el kanban.
 *
 * Permiso: `canCargarPedido` (admin / encargado), el mismo gate de mostrador
 * que usa `cargarPedidoStaff`.
 */
export async function venderMostrador(
  input: unknown,
  /**
   * El comprobante que el operador eligió al cobrar (spec 156 · D1), tal como
   * ya lo mandan la mesa y el pedido. Es un **passthrough** al `registrarPago`
   * de abajo, que es quien lo valida y lo emite; acá no se decide nada.
   *
   * Sin esto el mostrador no puede emitir una Factura A por más que la pantalla
   * la pida (spec 157). Con `afip_auto_emit` prendido, la B automática sale
   * primero y la guarda de la spec 100 bloquea la A para siempre; con el flag
   * apagado —el caso de golf-jcr, el único negocio real que factura A— no sale
   * nada. Los dos se resuelven acá: una elección explícita saltea el gate del
   * flag y emite lo que se pidió (spec 156 · D3).
   */
  comprobante?: ComprobanteElegido | null,
): Promise<ActionResult<VentaMostradorResult>> {
  const parsed = VentaMostradorInput.safeParse(input);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Datos de la venta inválidos.",
    );
  }
  const data = parsed.data;

  const business = await getBusiness(data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (!canCargarPedido(ctx.role)) {
    return actionError("No tenés permiso para cargar ventas de mostrador.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // ── 0. ¿Esta venta ya se hizo? (issue #263) ───────────────────────────
  //
  // `request_id` hacía idempotente el COBRO pero no la VENTA, y son dos cosas.
  // Al segundo «Confirmar» —el que se aprieta cuando el primero tarda y no
  // vuelve— se creaba una orden nueva con sus ítems, se descontaba el stock de
  // nuevo, y recién ahí la RPC devolvía el pago viejo por idempotencia. La
  // segunda orden quedaba sin pago propio, `dine_in` sin mesa: fuera del board,
  // fuera del plano, fuera de la lista de cuentas abiertas. Invisible en toda
  // la UI y contada igual en la analítica del día.
  //
  // Se corta antes de crear nada: si ya hay un pago con este `request_id`, la
  // venta ya ocurrió y se devuelve la de antes.
  if (data.request_id) {
    const { data: previo } = await service
      .from("payments")
      .select("id, order_id, amount_cents")
      .eq("business_id", business.id)
      .eq("request_id", data.request_id)
      .maybeSingle();
    const yaEstaba = previo as {
      id: string;
      order_id: string;
      amount_cents: number;
    } | null;
    if (yaEstaba) {
      const { data: ordenPrevia } = await service
        .from("orders")
        .select("order_number, daily_number")
        .eq("id", yaEstaba.order_id)
        .maybeSingle();
      const prev = ordenPrevia as {
        order_number: number;
        daily_number: number;
      } | null;
      return actionOk({
        order_id: yaEstaba.order_id,
        order_number: prev?.order_number ?? 0,
        daily_number: prev?.daily_number ?? 0,
        cobrado_cents: yaEstaba.amount_cents,
        comandas_creadas: 0,
        items_sin_sector: 0,
        ruteo_error: null,
        comprobante: undefined,
      });
    }
  }

  // ── 1. La orden ───────────────────────────────────────────────────────
  // `persistOrder` resuelve los precios contra el catálogo (el payload sólo
  // trae ids y cantidades) y aplica el scope `business_id`, así que un producto
  // de otro negocio no entra.
  const created = await persistOrder(
    {
      business_slug: data.business_slug,
      delivery_type: "dine_in",
      customer_name: CLIENTE_MOSTRADOR,
      customer_phone: TELEFONO_MOSTRADOR,
      items: data.items,
      payment_method: "cash",
    },
    ctx.userId,
    {
      mozoId: ctx.userId,
      // Spec 174 — el mostrador también carga el «no existe»: es justo donde
      // aparece la factura al sanatorio o la torta que trajo el cliente. El
      // gate de rol lo aplica `persistOrder` con este `role`.
      allowFreeLines: true,
      role: ctx.role,
    },
  );
  if (!created.ok) return created;

  const orderId = created.data.order_id;

  // El total sale de la base y no del payload: `persistOrder` resuelve precios
  // contra el catálogo, así que es el único número confiable.
  //
  // El error de esta lectura se descartaba (issue #263) y el `?? 0` convertía
  // «no pude leer» en «no se debe nada»: se cobraba $0, la venta se cerraba, la
  // mercadería salía y el stock se descontaba igual. Ahora se corta y se cancela
  // la orden, que es lo mismo que hace el rescate de FR-007 cuando falla el
  // cobro: una `dine_in` sin mesa y sin cerrar es invisible en toda la UI.
  const { data: orderRow, error: totalErr } = await service
    .from("orders")
    .select("total_cents")
    .eq("id", orderId)
    .maybeSingle();
  const totalCents = (orderRow as { total_cents: number } | null)?.total_cents;

  if (totalErr || typeof totalCents !== "number" || totalCents <= 0) {
    console.error("venderMostrador · no se pudo leer el total de la orden", {
      orderId,
      error: totalErr?.message,
      totalCents,
    });
    await cancelarOrden(service, {
      orderId,
      businessId: business.id,
      motivo: "Venta de mostrador sin total legible",
      actorUserId: ctx.userId,
    });
    return actionError(
      "No pudimos calcular el total de la venta. No se cobró nada: volvé a cargarla.",
    );
  }

  // ── 2. El cobro ───────────────────────────────────────────────────────
  // El recargo/descuento por método se resuelve en el server contra
  // `payment_method_configs` (misma fuente que el cobro de mesa), nunca desde
  // el cliente.
  const configs = await getPaymentMethodConfigs(business.id);
  const ajustePercent =
    configs.find((c) => c.method === data.method)?.adjustment_percent ?? 0;
  const { adjustmentCents: ajusteCents, finalCents } = calculateAdjustment(
    totalCents,
    ajustePercent,
  );

  const pago = await registrarPago({
    orderId,
    splitId: null,
    method: data.method,
    amount_cents: finalCents,
    tip_cents: data.tip_cents,
    caja_id: data.caja_id,
    last_four: data.last_four,
    card_brand: data.card_brand,
    notes: data.notes,
    adjustment_percent: ajustePercent,
    adjustment_cents: ajusteCents,
    slug: data.business_slug,
    requestId: data.request_id,
    creditCustomerId: data.credit_customer_id ?? null,
    // La forma la valida `registrarPago` (`ComprobanteElegidoSchema`): esto
    // llega del navegador y el borde es el suyo, no uno nuevo acá.
    comprobante: comprobante ?? undefined,
  });

  if (!pago.ok) {
    // FR-007: sin este rescate quedaría una orden `dine_in` abierta y sin mesa
    // — invisible en board, plano y salón — inflando la analítica en silencio.
    //
    // spec 090 — el comentario de arriba decía exactamente lo que el rescate NO
    // lograba: escribía `lifecycle_status` y dejaba `status='pending'`, que es
    // justo el eje que la analítica lee. Además los `order_items` ya estaban
    // insertados (con el stock descontado) y nadie los marcaba. Ahora el helper
    // escribe los cinco ejes, y la reversión de stock de la 089 cae de rebote.
    await cancelarOrden(service, {
      orderId,
      businessId: business.id,
      motivo: "Venta de mostrador no cobrada",
      actorUserId: ctx.userId,
    });
    return actionError(pago.error);
  }

  // Acá vivía un rescate: con un método con descuento la RPC no daba la orden
  // por saldada —comparaba el bruto contra `total_cents` (issue #253)— y esto
  // la cerraba a mano para tapar el falso negativo.
  //
  // El parche curaba el síntoma y causaba otro peor (issue #263): cerrar por
  // afuera se saltea `closeOrderIfFullyPaid`, que es **quien emite el
  // comprobante**. O sea que un negocio con descuento por efectivo configurado
  // no facturaba NUNCA en el mostrador: ni la B automática ni la A que el
  // cliente pidió. El IVA de esas ventas no se declaraba, y el caso que motivó
  // la spec 157 —el evento empresarial, el abono del sanatorio, los dos a
  // CUIT— se iba sin su Factura A.
  //
  // Con la migración 0076 la RPC compara en base y la orden cierra sola por el
  // camino de siempre, comprobante incluido. El rescate se saca en vez de
  // dejarlo «por las dudas»: si algún día `orderClosed` vuelve a venir en false
  // es que algo está mal de verdad, y cerrar la orden en silencio sería
  // esconderlo otra vez.
  if (!pago.data.orderClosed) {
    console.error(
      "venderMostrador · el pago entró pero la orden no cerró",
      { orderId, finalCents },
    );
  }

  // ── 3. La cocina ──────────────────────────────────────────────────────
  // Sólo imprime lo que tiene sector resuelto: el alfajor y la gaseosa no
  // generan comanda, el tostado sale a sanguchería. La regla no es código
  // nuevo — cae del modelado del producto (spec 08).
  let comandasCreadas = 0;
  let itemsSinSector = 0;
  let ruteoError: string | null = null;
  try {
    // `skipStatusAdvance`: la orden ya está cobrada y cerrada unas líneas más
    // arriba (spec 091 le pone `status='delivered'` al cerrar). Mandarla a
    // `preparing` acá la haría figurar como pedido activo para siempre — es la
    // única fila `closed`+`preparing` que quedó en el cloud.
    const ruteo = await routeOrderToCocina(orderId, business.id, {
      skipStatusAdvance: true,
    });
    if (ruteo.ok) {
      comandasCreadas = ruteo.data.comanda_ids.length;
      itemsSinSector = ruteo.data.items_without_station;
    } else {
      ruteoError = ruteo.error;
    }
  } catch (err) {
    console.error("venderMostrador: ruteo a cocina falló", err);
    ruteoError = "No pudimos enviar la comanda a cocina.";
  }

  return actionOk({
    order_id: orderId,
    order_number: created.data.order_number,
    daily_number: created.data.daily_number,
    cobrado_cents: finalCents,
    comandas_creadas: comandasCreadas,
    items_sin_sector: itemsSinSector,
    ruteo_error: ruteoError,
    comprobante: pago.data.comprobante,
  });
}
