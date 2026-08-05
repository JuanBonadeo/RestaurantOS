"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { calculateAdjustment } from "@/lib/billing/adjustment";
import { registrarPago } from "@/lib/billing/cobro-actions";
import { getCajasForBusiness, getPaymentMethodConfigs } from "@/lib/caja/queries";
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
  /** Lo que efectivamente pagó el cliente (total + ajuste del método). */
  cobrado_cents: number;
  /** Comandas creadas por el ruteo — 0 si nada de lo vendido tiene sector. */
  comandas_creadas: number;
  /** Ítems que no salieron a ninguna comandera (kiosco puro: alfajor, gaseosa). */
  items_sin_sector: number;
  /** El ruteo falló pero la venta quedó cobrada igual (el aviso es del caller). */
  ruteo_error: string | null;
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
    { mozoId: ctx.userId },
  );
  if (!created.ok) return created;

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const orderId = created.data.order_id;

  const { data: orderRow } = await service
    .from("orders")
    .select("total_cents")
    .eq("id", orderId)
    .maybeSingle();
  const totalCents = Number(
    (orderRow as { total_cents: number } | null)?.total_cents ?? 0,
  );

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

  // Un descuento configurado (porcentaje negativo) deja `total_paid` por debajo
  // de `total_cents`, y la RPC no considera la orden saldada → no cierra. En una
  // venta de mostrador eso es siempre un falso negativo: se pagó lo que el
  // negocio decidió cobrar, en un único pago, acá mismo.
  if (!pago.data.orderClosed) {
    await service
      .from("orders")
      .update({
        lifecycle_status: "closed",
        closed_at: new Date().toISOString(),
        total_paid_cents: finalCents,
        payment_status: "paid",
      })
      .eq("id", orderId)
      .eq("business_id", business.id)
      .eq("lifecycle_status", "open");
  }

  // ── 3. La cocina ──────────────────────────────────────────────────────
  // Sólo imprime lo que tiene sector resuelto: el alfajor y la gaseosa no
  // generan comanda, el tostado sale a sanguchería. La regla no es código
  // nuevo — cae del modelado del producto (spec 08).
  let comandasCreadas = 0;
  let itemsSinSector = 0;
  let ruteoError: string | null = null;
  try {
    const ruteo = await routeOrderToCocina(orderId, business.id);
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
    cobrado_cents: finalCents,
    comandas_creadas: comandasCreadas,
    items_sin_sector: itemsSinSector,
    ruteo_error: ruteoError,
  });
}
