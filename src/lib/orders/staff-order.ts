"use server";

import { actionError, type ActionResult } from "@/lib/actions";
import {
  validatePriceOverride,
  type PriceOverride,
} from "@/lib/comandas/price-override";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCargarPedido } from "@/lib/permissions/can";
import { getBusiness } from "@/lib/tenant";

import { persistOrder, type CreateOrderResult } from "./persist-order";
import { StaffOrderInput, type CreateOrderInput } from "./schema";

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
 */
export async function cargarPedidoStaff(
  input: unknown,
): Promise<ActionResult<CreateOrderResult>> {
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
    payment_method: "cash",
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
    return await persistOrder(mapped, ctxResult.data.userId, {
      mozoId: ctxResult.data.userId,
      priceOverrides,
    });
  } catch (err) {
    console.error("cargarPedidoStaff unexpected error", err);
    return actionError("No pudimos cargar el pedido. Intentá de nuevo.");
  }
}
