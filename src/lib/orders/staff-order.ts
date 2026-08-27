"use server";

import { actionError, type ActionResult } from "@/lib/actions";
import {
  validatePriceOverride,
  type PriceOverride,
} from "@/lib/comandas/price-override";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCargarPedido } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { persistOrder, type CreateOrderResult } from "./persist-order";
import { isScheduledForLater } from "./scheduled";
import { StaffOrderInput, type CreateOrderInput } from "./schema";

/**
 * Lo que devuelve `cargarPedidoStaff`. `needs_accept` sólo aparece en el caso
 * degradado de un programado que quedó creado pero sin avalar (spec 085): la
 * UI avisa que hay que aceptarlo a mano desde «Próximos».
 */
export type CargarPedidoStaffResult = CreateOrderResult & {
  needs_accept?: boolean;
};

/**
 * Carga a mano un pedido para llevar / delivery SIN mesa desde operación
 * (spec 054): el pedido de mostrador o telefónico, que hoy sólo entra
 * automático por la carta pública. Reusa `persistOrder` (que ya crea la orden
 * sin `table_id`, con items/combos/modifiers) y registra en `orders.mozo_id`
 * quién lo cargó.
 *
 * A diferencia del checkout público (`createOrder`), autentica con el gate del
 * staff (`requireMozoActionContext` + `canCargarPedido`, mostrador =
 * encargado/admin) en vez de exigir sesión de cliente + rate-limit por IP.
 *
 * El pedido nace en efectivo/`pending` y NO marcha a cocina: aparece en el
 * board (columna «Nuevos») y se marcha con el «Confirmar» existente
 * (`confirmarPedido`, spec 047). El cobro es aparte (US3, desde la card).
 *
 * **Programado (spec 085).** Con `scheduled_at` el pedido no va al kanban sino
 * a «Próximos», y lo marcha el cron con el lead del negocio. En ese caso queda
 * `confirmed` en vez de `pending`: el aval humano que exige spec 047 ya ocurrió
 * —lo cargó el encargado en persona—, así que pedirle además el «Aceptar» de
 * `aceptarPedidoProgramado` sería un gesto redundante que, si se olvida, deja
 * el pedido sin salir nunca.
 */
export async function cargarPedidoStaff(
  input: unknown,
): Promise<ActionResult<CargarPedidoStaffResult>> {
  const parsed = StaffOrderInput.safeParse(input);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Datos del pedido inválidos.",
    );
  }
  const data = parsed.data;

  const business = await getBusiness(data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCargarPedido(ctxResult.data.role)) {
    return actionError("No tenés permiso para cargar pedidos.");
  }

  // Precio por ítem (spec 069): el encargado puede pisar el precio de una línea
  // sólo para este pedido, con motivo. Validamos acá — rol + motivo — y el
  // precio viaja a `persistOrder` por opciones, nunca dentro de los items.
  const priceOverrides: (PriceOverride | null)[] = [];
  for (const item of data.items) {
    if (item.kind === "daily_menu") {
      priceOverrides.push(null);
      continue;
    }
    const validation = validatePriceOverride(item, ctxResult.data.role);
    if (!validation.ok) return actionError(validation.error);
    priceOverrides.push(validation.override);
  }

  // Defaults de mostrador: nombre anónimo → "Mostrador"; sin teléfono en pickup
  // → "-" (placeholder compartido, igual que el pedido flash). En delivery el
  // schema ya exigió teléfono + dirección.
  const mapped: CreateOrderInput = {
    business_slug: data.business_slug,
    delivery_type: data.delivery_type,
    customer_name: data.customer_name?.trim() || "Mostrador",
    customer_phone: data.customer_phone?.trim() || "-",
    delivery_address: data.delivery_address?.trim() || undefined,
    delivery_notes: data.delivery_notes?.trim() || undefined,
    kitchen_notes: data.kitchen_notes?.trim() || undefined,
    payment_method: "cash",
    // Spec 085: `persistOrder` lo valida contra la grilla del negocio (hoy,
    // anticipación, horario) — la misma validación del checkout público.
    scheduled_at: data.scheduled_at,
    // Sacamos el precio pisado de los items: a partir de acá el input tiene la
    // forma del checkout público y NINGUNA línea lleva precio. El override ya
    // está validado y viaja por `options.priceOverrides`. Si lo dejáramos acá
    // habría dos fuentes para el mismo dato y la invariante "el input público no
    // expresa precios" pasaría a depender de que nadie lo lea.
    items: data.items.map((item) => {
      if (item.kind === "daily_menu") return item;
      const { ...rest } = item;
      delete rest.price_override_cents;
      delete rest.price_override_reason;
      return rest;
    }),
  };

  try {
    const result = await persistOrder(mapped, ctxResult.data.userId, {
      mozoId: ctxResult.data.userId,
      priceOverrides,
      // Spec 127: el encargue del staff no pasa por la grilla del checkout, y
      // trae su propia hora de cocina — la que se imprime y la que manda la
      // ventana de marcha.
      source: "staff",
      kitchenAt: data.kitchen_at,
    });
    if (!result.ok || !isScheduledForLater(data.scheduled_at)) return result;

    // Avalar el programado (ver docblock). Si el update falla, la orden ya
    // existe: la devolvemos igual con `needs_accept` para que la UI diga que
    // hay que aceptarla desde «Próximos», en vez de dar un error que haría
    // creer que no se cargó nada.
    const service = createSupabaseServiceClient();
    const { error } = await service
      .from("orders")
      .update({ status: "confirmed" })
      .eq("id", result.data.order_id);
    if (error) {
      console.error("cargarPedidoStaff · avalar programado", error);
      return { ...result, data: { ...result.data, needs_accept: true } };
    }
    return result;
  } catch (err) {
    console.error("cargarPedidoStaff unexpected error", err);
    return actionError("No pudimos cargar el pedido. Intentá de nuevo.");
  }
}
