/**
 * Spec 069 (US3) — armado del reporte de «Precios modificados».
 *
 * Puro a propósito: la query es un select plano, pero el armado tiene tres
 * trampas que merecen test — el cast de `bigint` (PostgREST lo puede devolver
 * como string, y `"600" - "1000"` no es una resta), la relación anidada que a
 * veces viene objeto y a veces array, y los dos totales que NO tienen que
 * netear.
 */

/** Fila cruda tal como sale de PostgREST, con las ambigüedades sin resolver. */
export type RawOverrideRow = {
  id: string;
  product_name: string;
  quantity: number | string;
  unit_price_cents: number | string;
  price_original_cents: number | string | null;
  price_override_at: string | null;
  price_override_by: string | null;
  price_override_reason: string | null;
  orders: unknown;
};

export type PriceOverrideRow = {
  id: string;
  productName: string;
  quantity: number;
  /** Precio de la carta al momento de pisarlo. */
  priceOriginalCents: number;
  /** Precio efectivamente cobrado. */
  unitPriceCents: number;
  /** Negativo = se resignó plata; positivo = se cobró de más. Por unidad. */
  deltaCents: number;
  reason: string | null;
  actorName: string | null;
  at: string | null;
  orderNumber: number | null;
  tableLabel: string | null;
};

/** PostgREST devuelve las relaciones a veces como objeto y a veces como array. */
function unwrap<T>(rel: unknown): T | null {
  if (rel == null) return null;
  return (Array.isArray(rel) ? (rel[0] ?? null) : rel) as T | null;
}

export function buildPriceOverrideRows(
  raw: RawOverrideRow[],
  actorNameById: Map<string, string>,
): PriceOverrideRow[] {
  return raw
    .filter((r) => r.price_original_cents != null)
    .map((r) => {
      const order = unwrap<{
        order_number: number | null;
        table_id: string | null;
        tables: unknown;
      }>(r.orders);
      const table = unwrap<{ label: string | null }>(order?.tables);

      const original = Number(r.price_original_cents) || 0;
      const unit = Number(r.unit_price_cents) || 0;

      return {
        id: r.id,
        productName: r.product_name,
        quantity: Number(r.quantity) || 0,
        priceOriginalCents: original,
        unitPriceCents: unit,
        deltaCents: unit - original,
        reason: r.price_override_reason,
        actorName: r.price_override_by
          ? (actorNameById.get(r.price_override_by) ?? null)
          : null,
        at: r.price_override_at,
        orderNumber: order?.order_number ?? null,
        tableLabel: table?.label ?? null,
      };
    })
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}

export type OverridesSummary = {
  /** Plata que el local dejó de cobrar. Positivo. */
  resignedCents: number;
  /** Plata cobrada por encima de la carta. Positivo. */
  surchargedCents: number;
};

/**
 * Dos totales SEPARADOS, nunca uno neto: netear escondería que se regalaron
 * $10.000 y se recargaron $9.000 detrás de un "-$1.000" que se lee como un
 * ajuste chico. El delta se multiplica por la cantidad de la línea — pisar el
 * precio de un ítem con cantidad 3 resigna tres veces.
 */
export function summarizeOverrides(rows: PriceOverrideRow[]): OverridesSummary {
  let resignedCents = 0;
  let surchargedCents = 0;
  for (const r of rows) {
    const total = r.deltaCents * r.quantity;
    if (total < 0) resignedCents += -total;
    else surchargedCents += total;
  }
  return { resignedCents, surchargedCents };
}
