import type { BusinessRole } from "@/lib/admin/context";
import { canOverrideItemPrice } from "@/lib/permissions/can";

/**
 * Spec 069 — precio por ítem editable con motivo (override de mostrador).
 *
 * El encargado cobra una línea a un precio distinto al de catálogo SOLO para
 * ese pedido: plato fuera de carta, cortesía a $0, media porción, error de la
 * carta impresa, precio pactado con un socio.
 *
 * Módulo puro a propósito: la validación y la resolución del precio son las
 * dos piezas que tienen que comportarse igual en los tres caminos de escritura
 * (`enviarComanda`, `cargarPedidoStaff` → `persist-order`, y la edición
 * post-envío `editarItemComanda`). Duplicarlas es cómo se termina con un
 * camino que no pide motivo.
 *
 * ⚠️ `unit_price_cents` es SIEMPRE el precio efectivamente cobrado. Cuando hay
 * override, el de lista queda en `price_original_cents`.
 */

/** Par (precio, motivo) tal como viene del cliente. Ambos opcionales. */
export type PriceOverrideInput = {
  price_override_cents?: number | null;
  price_override_reason?: string | null;
};

/** Override ya validado y normalizado. */
export type PriceOverride = {
  cents: number;
  reason: string;
};

export type PriceOverrideValidation =
  | { ok: true; override: PriceOverride | null }
  | { ok: false; error: string };

/**
 * Valida el override contra el rol. Devuelve `override: null` cuando la línea
 * no trae ninguno (el caso normal), y error cuando el par está mal armado.
 *
 * NO hay tope por porcentaje ni por monto (decisión de Juan 2026-07-30): el
 * override puede ser $0 y puede quedar por encima del precio de lista. El
 * control es el gate de rol más el registro de quién/cuándo/por qué, no un
 * límite duro que en hora pico sólo estorba.
 */
export function validatePriceOverride(
  input: PriceOverrideInput,
  role: BusinessRole,
): PriceOverrideValidation {
  const cents = input.price_override_cents;
  const rawReason = input.price_override_reason;

  const hasCents = cents !== undefined && cents !== null;
  const hasReason = typeof rawReason === "string" && rawReason.trim() !== "";

  // Sin precio: no hay override. Un motivo suelto es señal de un cliente mal
  // armado — lo rechazamos en vez de tragarlo en silencio.
  if (!hasCents) {
    if (hasReason) {
      return {
        ok: false,
        error: "Llegó un motivo de cambio de precio sin un precio nuevo.",
      };
    }
    return { ok: true, override: null };
  }

  if (!canOverrideItemPrice(role)) {
    return {
      ok: false,
      error: "Tu rol no permite cambiar el precio de un ítem. Pedile al encargado.",
    };
  }

  if (!Number.isInteger(cents) || cents < 0) {
    return {
      ok: false,
      error: "El precio nuevo tiene que ser un monto válido (en centavos, sin decimales).",
    };
  }

  if (!hasReason) {
    return { ok: false, error: "El cambio de precio requiere un motivo." };
  }

  return { ok: true, override: { cents, reason: rawReason.trim() } };
}

/** Las cuatro columnas de `order_items` que dependen del override, + el precio. */
export type ResolvedLinePrice = {
  unit_price_cents: number;
  price_original_cents: number | null;
  price_override_at: string | null;
  price_override_by: string | null;
  price_override_reason: string | null;
};

/**
 * Resuelve qué precio termina en la línea.
 *
 * `existingOriginalCents` es el `price_original_cents` que la fila ya tenía (si
 * la estamos editando). Se respeta: un segundo override NO lo pisa, porque el
 * delta del reporte se mide siempre contra el precio de LISTA, no contra el
 * ajuste anterior. Si el segundo cambio lo pisara, escondería al primero.
 */
export function applyPriceOverride(
  catalogPriceCents: number,
  override: PriceOverride | null,
  actorUserId: string,
  existingOriginalCents?: number | null,
): ResolvedLinePrice {
  if (!override) {
    return {
      unit_price_cents: catalogPriceCents,
      price_original_cents: null,
      price_override_at: null,
      price_override_by: null,
      price_override_reason: null,
    };
  }

  return {
    unit_price_cents: override.cents,
    price_original_cents: existingOriginalCents ?? catalogPriceCents,
    price_override_at: new Date().toISOString(),
    price_override_by: actorUserId,
    price_override_reason: override.reason,
  };
}

/**
 * Subtotal de la línea. El override reemplaza SÓLO el precio base: los
 * adicionales son ítems de catálogo aparte y conservan su precio, así que una
 * cortesía a $0 con un extra de queso sigue cobrando el queso.
 */
export function lineSubtotalCents(
  unitPriceCents: number,
  modifiersTotalCents: number,
  quantity: number,
): number {
  return (unitPriceCents + modifiersTotalCents) * quantity;
}
