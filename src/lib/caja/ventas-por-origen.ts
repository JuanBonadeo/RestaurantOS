import type { VentaOrigen } from "./types";

export const EMPTY_BY_ORIGEN: Record<VentaOrigen, number> = {
  salon: 0,
  delivery: 0,
  takeaway: 0,
  otro: 0,
};

/**
 * `orders.delivery_type` es texto libre en la DB y solo existen tres valores:
 * `dine_in`, `delivery` y `pickup` (el retiro en el local, o sea take away).
 * `take_away` se acepta por defensa —  fue un valor fantasma que nunca se
 * llegó a persistir— pero es el mismo balde que `pickup`.
 *
 * Cualquier valor desconocido cae en `otro` en vez de descartarse: la suma de
 * los orígenes tiene que cerrar con `total_ventas_cents` siempre.
 */
export function origenDeDeliveryType(deliveryType: string): VentaOrigen {
  switch (deliveryType) {
    case "dine_in":
      return "salon";
    case "delivery":
      return "delivery";
    case "pickup":
    case "take_away":
      return "takeaway";
    default:
      return "otro";
  }
}

export function agruparVentasPorOrigen(
  payments: Array<{ delivery_type: string; amount_cents: number }>,
): Record<VentaOrigen, number> {
  const acc: Record<VentaOrigen, number> = { ...EMPTY_BY_ORIGEN };
  for (const p of payments) {
    const origen = origenDeDeliveryType(p.delivery_type);
    acc[origen] += p.amount_cents;
  }
  return acc;
}
