/**
 * Cuánto le decimos al cliente que va a tardar (spec 133).
 *
 * Hasta acá el checkout tenía tres números escritos a mano y en desacuerdo
 * entre sí: «40 min» en envío, «15–20 min» en retiro y otra vez «15–20 min» en
 * «lo antes posible», que ni siquiera miraba qué había elegido el cliente.
 * Juan, 2026-08-31: el envío es de **1 h a 1 h 30** y el retiro de **40 min a
 * 1 h**.
 *
 * Se expresa como una **ventana**, no como un número: prometer «40 min» exactos
 * es prometer lo que ninguna cocina puede sostener un sábado. El piso lo pone
 * el negocio (`businesses.estimated_{delivery,pickup}_minutes`) y el techo sale
 * de redondear al siguiente medio horario en punto — 40 → 1 h, 60 → 1 h 30.
 */

/** Defaults del producto: los números que pidió Juan. */
export const DEFAULT_ESTIMATED_DELIVERY_MIN = 60;
export const DEFAULT_ESTIMATED_PICKUP_MIN = 40;

/** «40 min» · «1 h» · «1 h 30». Sin decimales ni «minutos» largo: se lee al vuelo. */
export function formatMinutos(min: number): string {
  const total = Math.max(0, Math.round(min));
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto}`;
}

/**
 * La ventana que se le muestra al cliente. El techo es el siguiente múltiplo de
 * 30 **estrictamente mayor** que el piso, así 40 → 60 y 60 → 90: siempre queda
 * aire, y nunca sale un rango de ancho cero.
 */
export function ventanaEstimada(min: number): { desde: number; hasta: number } {
  const desde = Math.max(0, Math.round(min));
  const hasta = (Math.floor(desde / 30) + 1) * 30;
  return { desde, hasta };
}

/** «40 min – 1 h» · «1 h – 1 h 30». */
export function ventanaEstimadaLabel(min: number): string {
  const { desde, hasta } = ventanaEstimada(min);
  return `${formatMinutos(desde)} – ${formatMinutos(hasta)}`;
}

/**
 * El piso de cada modo, con el default del producto cuando el negocio no lo
 * configuró.
 */
export function minutosEstimados(
  tipo: "delivery" | "pickup",
  business: {
    estimated_delivery_minutes?: number | null;
    estimated_pickup_minutes?: number | null;
  },
): number {
  if (tipo === "delivery") {
    return business.estimated_delivery_minutes ?? DEFAULT_ESTIMATED_DELIVERY_MIN;
  }
  return business.estimated_pickup_minutes ?? DEFAULT_ESTIMATED_PICKUP_MIN;
}
