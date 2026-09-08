"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { notifyDeliveryStatusChange } from "@/lib/notifications/delivery-notify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { bloqueoPorPlata } from "./cancel-guards";
import { cancelDownstream } from "./cancel-order";

import {
  ORDER_STATUSES,
  isOnlinePendingAdvance,
  isValidTransition,
  type OrderStatus,
} from "./status";

const UpdateStatusInput = z.object({
  order_id: z.string().uuid(),
  business_slug: z.string().min(1),
  next_status: z.enum(ORDER_STATUSES),
  cancelled_reason: z.string().max(500).optional(),
});

export async function updateOrderStatus(
  input: unknown,
): Promise<ActionResult<{ order_id: string; status: OrderStatus }>> {
  const parsed = UpdateStatusInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { order_id, business_slug, next_status, cancelled_reason } =
    parsed.data;

  if (next_status === "cancelled" && !cancelled_reason?.trim()) {
    return actionError("Motivo de cancelación requerido.");
  }

  const supabase = await createSupabaseServerClient();
  // spec 34 — actor de la anulación (para el resumen de cierre). Es una acción
  // del panel admin, así que hay sesión; si por algún motivo no, queda null.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: current, error: fetchErr } = await supabase
    .from("orders")
    .select("id, status, delivery_type")
    .eq("id", order_id)
    .maybeSingle();
  if (fetchErr || !current) return actionError("Pedido no encontrado.");

  const from = current.status as OrderStatus;
  if (!isValidTransition(from, next_status)) {
    return actionError(
      `No se puede pasar de "${from}" a "${next_status}".`,
    );
  }

  // spec 047 — un pedido online en `pending` solo se manda a cocina con
  // "Confirmar" (confirmarPedido → routeOrderToCocina, que crea las comandas e
  // imprime). Avanzarlo por acá lo dejaría en preparing sin comanda ni impresión.
  if (isOnlinePendingAdvance(from, current.delivery_type, next_status)) {
    return actionError('Usá "Confirmar" para mandar el pedido a cocina.');
  }

  const isCancel = next_status === "cancelled";
  const nowIso = new Date().toISOString();

  // issue #259 — cancelar un pedido ya pagado no puede tragarse la plata.
  //
  // `anularMesa` ya pasaba por esta guarda (spec 092); el board de pedidos
  // online nunca lo hizo. Cancelar desde acá un pedido pagado por Mercado Pago
  // no devolvía nada, no avisaba, y dejaba el cobro adentro de la caja contra
  // una venta que ya no existe: el cliente pagó y no recibe ni el pedido ni el
  // reembolso, y el arqueo cuadra igual porque el pago sigue ahí.
  //
  // La política es la que la guarda ya tenía escrita y vale igual acá: primero
  // se deshace la plata, después se anula. Bloquea en vez de arreglarlo sola
  // porque anular un cobro o emitir una nota de crédito son decisiones con
  // consecuencia fiscal, y las toma una persona.
  //
  // El rechazo (`rechazarPedido`, spec 139) sigue siendo el camino que SÍ
  // devuelve por MP: es para antes de marchar, y ahí la decisión ya está tomada.
  if (isCancel) {
    const guardService = createSupabaseServiceClient();
    const bloqueo = await bloqueoPorPlata(guardService, [order_id], "pedido");
    if (bloqueo) return actionError(bloqueo);
  }

  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      status: next_status,
      // spec 090 — al cancelar se escriben los **dos** ejes. Este camino movía
      // sólo `status` y dejaba `lifecycle_status='open'`: en el cloud quedaron
      // 4 pedidos cancelados con la cuenta abierta, que el cobro seguía
      // considerando cobrables porque guarda por `lifecycle_status`.
      lifecycle_status: isCancel ? "cancelled" : undefined,
      // Y `cancelled_at`, que no lo escribía nadie del canal online: es el campo
      // por el que filtra el bloque de anulaciones del resumen de turno, así que
      // el encargado cancelaba deliveries con su motivo tipeado y el resumen del
      // dueño no decía una palabra.
      cancelled_at: isCancel ? nowIso : null,
      cancelled_reason: isCancel ? (cancelled_reason ?? null) : null,
      cancelled_by: isCancel ? (user?.id ?? null) : null,
    })
    .eq("id", order_id);
  if (updateErr) {
    console.error("updateOrderStatus", updateErr);
    return actionError("No pudimos actualizar el estado.");
  }

  // La cascada (ítems, comandas + ticket «ANULADA», totales) va con el service
  // client: el UPDATE de arriba ya corrió bajo RLS, así que probó que este
  // usuario podía tocar la orden. Sin esto, cancelar un delivery ya marchado
  // dejaba la comanda viva en cocina — el cocinero terminaba el plato y nadie
  // lo venía a buscar — y si seguía `pendiente`, la comandera la imprimía
  // después de cancelada y sin cartel de ANULADA.
  if (isCancel) {
    const service = createSupabaseServiceClient();
    await cancelDownstream(service, {
      orderId: order_id,
      motivo: cancelled_reason?.trim() || "Cancelado",
      actorUserId: user?.id ?? null,
      nowIso,
    });
  }

  // Aviso de WhatsApp al cliente por el nuevo estado de delivery. Best-effort:
  // la función no lanza y no bloquea el cambio de estado (si WhatsApp no está
  // conectado, queda registrado en el outbox sin afectar la operación).
  await notifyDeliveryStatusChange({
    orderId: order_id,
    toStatus: next_status,
    // issue #259 — el motivo se pedía como obligatorio, se guardaba, y después
    // no se pasaba acá: moría en la base. `notifyDeliveryStatusChange` ya sabía
    // recibirlo (lo usa el rechazo, spec 139); lo que faltaba era mandárselo.
    motivo: isCancel ? (cancelled_reason?.trim() ?? undefined) : undefined,
  });

  revalidatePath(`/${business_slug}/admin`);
  revalidatePath(`/${business_slug}/admin/pedidos/${order_id}`);
  // La vista de Operación (tab "Pedidos online") produce `initialOrders` desde
  // esta ruta — sin esto su snapshot server no se invalida ante un cambio de estado.
  revalidatePath(`/${business_slug}/admin/operacion`);
  return actionOk({ order_id, status: next_status });
}
