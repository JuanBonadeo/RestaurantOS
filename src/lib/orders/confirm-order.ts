"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canConfirmOrder } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { routeOrderToCocina, type RouteOrderResult } from "./route-to-cocina";
import { isScheduledForLater } from "./scheduled";

type GenericClient = SupabaseClient;

export type ConfirmarPedidoResult = RouteOrderResult;

/**
 * Fallback manual: toma un pedido entrante (delivery / take-away / web /
 * chatbot) en estado `pending`, rutea a cocina vía `routeOrderToCocina`.
 *
 * Sobre un pedido programado es el botón «Marchar ahora»: lo manda a cocina en
 * el acto, sin esperar el lead. Por eso acepta también `confirmed` (spec 061):
 * un programado que el encargado ya aceptó sigue necesitando el escape manual.
 *
 * Solo encargado / admin / platform admin (`canConfirmOrder`).
 * Idempotente via `routeOrderToCocina`.
 */
export async function confirmarPedido(
  orderId: string,
  slug: string,
): Promise<ActionResult<ConfirmarPedidoResult>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canConfirmOrder(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden confirmar pedidos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: order } = await service
    .from("orders")
    .select("id, business_id, status, delivery_type")
    .eq("id", orderId)
    .maybeSingle();
  type OrderRow = {
    id: string;
    business_id: string;
    status: string;
    delivery_type: string;
  };
  const orderRow = order as OrderRow | null;
  if (!orderRow || orderRow.business_id !== business.id) {
    return actionError("Pedido no encontrado.");
  }
  if (orderRow.delivery_type === "dine_in") {
    return actionError(
      "Los pedidos en mesa no se confirman acá — los carga el mozo desde el salón.",
    );
  }
  if (orderRow.status !== "pending" && orderRow.status !== "confirmed") {
    return actionError(`El pedido ya está en estado "${orderRow.status}".`);
  }

  const result = await routeOrderToCocina(orderId, business.id);

  revalidatePath(`/${slug}/admin/pedidos`);
  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/mozo`);

  return result;
}

/**
 * Acepta un pedido **programado** sin marcharlo (spec 061).
 *
 * Es la contrapartida de `confirmarPedido` para el diferido: el encargado avala
 * el pedido ahora (`pending → confirmed`) pero la comanda no se crea ni se
 * imprime — de eso se encarga el cron cuando entra en ventana, con el lead del
 * negocio. Sin este gesto, un programado en efectivo (que nace impago) nunca
 * cumpliría la condición de auto-march de spec 047 y se quedaría en «Próximos»
 * para siempre.
 *
 * Solo encargado / admin / platform admin (`canConfirmOrder`), el mismo gate
 * que «Marchar ahora».
 */
export async function aceptarPedidoProgramado(
  orderId: string,
  slug: string,
): Promise<ActionResult<{ order_id: string }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canConfirmOrder(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden aceptar pedidos.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: order } = await service
    .from("orders")
    .select("id, business_id, status, delivery_type, scheduled_at")
    .eq("id", orderId)
    .maybeSingle();
  type ScheduledOrderRow = {
    id: string;
    business_id: string;
    status: string;
    delivery_type: string;
    scheduled_at: string | null;
  };
  const orderRow = order as ScheduledOrderRow | null;
  if (!orderRow || orderRow.business_id !== business.id) {
    return actionError("Pedido no encontrado.");
  }
  if (orderRow.delivery_type === "dine_in") {
    return actionError("Los pedidos en mesa no se programan.");
  }
  if (!isScheduledForLater(orderRow.scheduled_at)) {
    return actionError(
      'Este pedido no está programado para más tarde — usá "Marchar ahora".',
    );
  }
  if (orderRow.status !== "pending") {
    return actionError(`El pedido ya está en estado "${orderRow.status}".`);
  }

  const { error } = await service
    .from("orders")
    .update({ status: "confirmed" })
    .eq("id", orderId);
  if (error) {
    console.error("aceptarPedidoProgramado · update", error);
    return actionError("No pudimos aceptar el pedido.");
  }

  revalidatePath(`/${slug}/admin/pedidos`);
  revalidatePath(`/${slug}/admin/operacion`);

  return actionOk({ order_id: orderId });
}
