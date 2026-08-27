"use server";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCrearPedidoFlash } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { pedidoFlashSchema } from "./pedido-flash-schema";

type CrearPedidoFlashInput = {
  slug: string;
  concepto: string;
  montoCents: number;
};

type CrearPedidoFlashResult = {
  orderId: string;
};

/**
 * Crea un "pedido flash": una `order` con un único `order_item` por monto
 * (concepto libre, `product_id = null`), sin dar de alta el producto en la
 * carta. La orden resultante queda lista para cobrar y/o facturar con el
 * `emitInvoice` existente (su `total_cents` iguala el monto).
 *
 * Permiso: mostrador (encargado/admin). Dinero en centavos, scope business_id.
 */
export async function crearPedidoFlash(
  input: CrearPedidoFlashInput,
): Promise<ActionResult<CrearPedidoFlashResult>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCrearPedidoFlash(ctxResult.data.role)) {
    return actionError("No tenés permiso para crear un pedido flash.");
  }

  const parsed = pedidoFlashSchema.safeParse({
    concepto: input.concepto,
    montoCents: input.montoCents,
  });
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Datos del pedido flash inválidos.",
    );
  }
  const { concepto, montoCents } = parsed.data;

  const service = createSupabaseServiceClient();

  // La orden flash no pasa por salón: cliente snapshot = concepto, sin mesa.
  // `order_number` lo asigna el trigger `set_order_number` (pasamos 0).
  const { data: order, error: orderErr } = await service
    .from("orders")
    .insert({
      order_number: 0,
      // `business_day` y `daily_number` los asigna el trigger
      // `set_order_daily_number` (migración 0049): van con los sentinels que el
      // trigger reconoce (null y 0). El tipo generado los pide porque en la base
      // son NOT NULL sin default de columna — los tipos no saben de triggers.
      business_day: null as unknown as string,
      daily_number: 0,
      business_id: business.id,
      customer_name: concepto,
      customer_phone: "-",
      delivery_type: "dine_in",
      subtotal_cents: montoCents,
      total_cents: montoCents,
      lifecycle_status: "open",
    })
    .select("id")
    .single();
  if (orderErr || !order) {
    console.error("pedido flash: order insert", orderErr);
    return actionError("No pudimos crear el pedido flash.");
  }

  // Renglón ficticio por monto: product_id null (soportado desde 0020),
  // sin station_id (no va a comanda — es facturación pura).
  const { error: itemErr } = await service.from("order_items").insert({
    order_id: order.id,
    product_id: null,
    product_name: concepto,
    unit_price_cents: montoCents,
    quantity: 1,
    subtotal_cents: montoCents,
  });
  if (itemErr) {
    console.error("pedido flash: order_item insert", itemErr);
    return actionError("No pudimos cargar el renglón del pedido flash.");
  }

  return actionOk({ orderId: order.id });
}
