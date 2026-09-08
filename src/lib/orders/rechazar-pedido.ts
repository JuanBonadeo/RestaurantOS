"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { notifyDeliveryStatusChange } from "@/lib/notifications/delivery-notify";
import { cancelarOrden } from "@/lib/orders/cancel-order";
import { refundPayment } from "@/lib/payments/mercadopago";
import { canConfirmOrder } from "@/lib/permissions/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Spec 139 — el local rechaza un pedido que todavía no tomó.
 *
 * Por dentro es una cancelación (los estados de `orders` están cableados al
 * kanban, la caja y los reportes: sumar `rejected` para distinguir un caso de
 * copy sería caro y frágil). Lo que cambia es **el momento y el aviso**: sólo
 * se puede antes de que el pedido vaya a cocina, y al cliente se le dice que no
 * se lo pudieron tomar y por qué — no el genérico de cancelación.
 *
 * Si el pedido estaba pagado, se devuelve la plata por Mercado Pago
 * automáticamente, con las mismas reglas que la cancelación del cliente: el
 * rechazo procede igual (nadie queda colgado esperando un botón), y si MP falla
 * el pedido queda `paid` + `cancelled` para resolverlo a mano.
 */

const RechazarInput = z.object({
  order_id: z.string().uuid(),
  business_slug: z.string().min(1),
  motivo: z.string().trim().min(1, "Decile al cliente por qué.").max(500),
});

export type RechazoResult = {
  order_id: string;
  /** Qué pasó con la plata: nunca hubo, se devolvió, o hay que hacerlo a mano. */
  refund: "none" | "refunded" | "manual";
};

export async function rechazarPedido(
  input: unknown,
): Promise<ActionResult<RechazoResult>> {
  const parsed = RechazarInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { order_id, business_slug, motivo } = parsed.data;

  const business = await getBusiness(business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  // issue #259 — el rol, además de la pertenencia.
  //
  // Acá decía que «el SELECT bajo RLS es también la prueba de permisos». Eso
  // prueba **tenancy**, no rol: cualquier miembro del negocio ve las órdenes de
  // su negocio, así que un mozo o alguien de cocina podía rechazar un pedido —
  // y este camino **devuelve la plata por Mercado Pago**. Sin tope y sin
  // autorización de nadie.
  //
  // Es `canConfirmOrder` y no una condición nueva: rechazar es la otra mitad de
  // la misma decisión, en la misma pantalla, y esa función ya dice por qué el
  // mozo no entra («está en salón, no tiene visibilidad de la cola de pedidos
  // online»).
  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canConfirmOrder(ctxResult.data.role)) {
    return actionError("No tenés permiso para rechazar pedidos.");
  }

  // El SELECT bajo RLS suma la guarda de tenancy.
  const { data: found } = await supabase
    .from("orders")
    .select("id, status, delivery_type, payment_status, mp_payment_id")
    .eq("id", order_id)
    .eq("business_id", business.id)
    .maybeSingle();
  const order = found as {
    id: string;
    status: string;
    delivery_type: string;
    payment_status: string | null;
    mp_payment_id: string | null;
  } | null;
  if (!order) return actionError("Pedido no encontrado.");

  if (order.delivery_type === "dine_in") {
    return actionError("Un pedido de salón no se rechaza: se anula.");
  }
  // Después de marchar ya hay comida hecha: eso es una cancelación, con su
  // propio camino y su propia conversación.
  if (order.status !== "pending" && order.status !== "confirmed") {
    return actionError("El pedido ya está en cocina: cancelalo desde el board.");
  }

  const service = createSupabaseServiceClient();

  // La plata primero: si el rechazo se escribiera antes y el proceso muriera en
  // el medio, quedaría un pedido rechazado con la plata del cliente adentro.
  let refund: RechazoResult["refund"] = "none";
  if (order.payment_status === "paid" && order.mp_payment_id) {
    const { data: biz } = await service
      .from("businesses")
      .select("mp_access_token")
      .eq("id", business.id)
      .maybeSingle();
    const token = (biz as { mp_access_token?: string | null } | null)
      ?.mp_access_token;
    if (token) {
      const r = await refundPayment(token, order.mp_payment_id);
      refund = r.ok ? "refunded" : "manual";
      if (!r.ok) console.error("rechazarPedido · refund MP", r.error);
    } else {
      refund = "manual";
    }
  }

  const resultado = await cancelarOrden(service, {
    orderId: order.id,
    businessId: business.id,
    motivo,
    actorUserId: user.id,
  });
  if (!resultado.cancelled) {
    return actionError("El pedido ya no estaba pendiente.");
  }

  if (refund === "refunded") {
    await service
      .from("orders")
      .update({ payment_status: "refunded" })
      .eq("id", order.id);
  }

  // El aviso del rechazo, con el motivo que escribió el encargado. `rejected`
  // no es un estado de `orders`: es el evento del aviso (spec 139).
  await notifyDeliveryStatusChange({
    orderId: order.id,
    toStatus: "rejected",
    motivo,
  });

  revalidatePath(`/${business_slug}/admin`);
  revalidatePath(`/${business_slug}/admin/operacion`);
  revalidatePath(`/${business_slug}/admin/pedidos/${order.id}`);
  return actionOk({ order_id: order.id, refund });
}
