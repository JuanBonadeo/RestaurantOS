/**
 * Margen EFECTIVO de un producto en un período (spec 069, T019).
 *
 * Antes, la ingeniería de menú mezclaba dos fuentes en la misma tarjeta: las
 * unidades y la facturación salían de `order_items` (lo realmente vendido) y
 * el margen salía de `getCosteoOverview`, que lo calcula sobre
 * `products.price_cents` — el precio de LISTA.
 *
 * Mientras el precio de la línea era siempre el de catálogo eso era una
 * aproximación aceptable. Con el precio por ítem dejó de serlo: un plato de
 * $10.000 con food cost $3.000 regalado tres veces mostraba «$0 facturado ·
 * 70% de margen» en la misma tarjeta, y `classify()` lo mandaba al cuadrante
 * «estrella». El dueño rediseñaba la carta sobre un margen que nunca cobró.
 *
 * Acá el margen se calcula sobre lo que entró de verdad:
 *   margen = facturado − (costo por unidad × unidades servidas)
 *
 * El costo se multiplica por unidades **servidas**, no vendidas-a-precio: un
 * plato regalado igual consumió mercadería.
 */
export function effectiveMargin({
  revenueCents,
  unitsSold,
  foodCostCents,
}: {
  /** Facturado real del producto en el período (Σ `subtotal_cents`). */
  revenueCents: number;
  /** Unidades servidas, incluidas las cobradas a $0. */
  unitsSold: number;
  /** Costo de insumos por unidad. */
  foodCostCents: number;
}): { marginPercent: number; marginCents: number } {
  if (unitsSold <= 0) return { marginPercent: 0, marginCents: 0 };

  const totalCost = foodCostCents * unitsSold;
  const totalMargin = revenueCents - totalCost;
  const marginCents = totalMargin / unitsSold;

  if (revenueCents <= 0) {
    // Regalado entero: el porcentaje sobre facturación no está definido.
    // −100% es la lectura útil ("se perdió todo lo que costó"); si tampoco
    // hubo costo cargado, no se perdió nada y el 0 es honesto.
    return { marginPercent: totalCost > 0 ? -100 : 0, marginCents };
  }

  return {
    marginPercent: Math.round((totalMargin / revenueCents) * 100 * 100) / 100,
    marginCents,
  };
}
