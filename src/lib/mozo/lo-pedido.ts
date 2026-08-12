/**
 * «Lo pedido» — lo que la mesa ya tiene cargado, para la columna izquierda del
 * panel de carga (spec 111).
 *
 * **Por qué no se arma con las comandas.** El panel ya recibe
 * `existingComandas`, y agrupar eso por sector parecía alcanzar. No alcanza:
 * `enviarComanda` inserta con `station_id = null` —y **sin generar comanda**—
 * todo lo que no resuelve sector (comandas/actions.ts:450). En golf-house los
 * sectores son cocina, parrilla, fritera y postre: **no hay barra**, así que
 * cada gaseosa, cerveza y café de la mesa no está en ninguna comanda. Una
 * columna hecha con comandas escondería justo eso, y el total daría de menos.
 *
 * Entonces la fuente es la **orden**: todos sus `order_items`, con la comanda
 * colgada al lado cuando la hay (para la tanda, la hora y el sector).
 *
 * Este módulo es puro y testeable; la lectura vive en `lo-pedido-query.ts`.
 */

import type { KitchenItemStatus } from "@/lib/comandas/types";

export type LoPedidoItem = {
  order_item_id: string;
  product_name: string;
  quantity: number;
  notes: string | null;
  /** Los modificadores elegidos, ya aplanados a sus nombres. */
  modifiers: string[];
  unit_price_cents: number;
  subtotal_cents: number;
  seat_number: number | null;
  station_id: string | null;
  kitchen_status: KitchenItemStatus;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  /** `null` = el ítem no fue a cocina (bebida, ítem de stock). */
  comanda_id: string | null;
  /** Tanda de la comanda. `null` con `comanda_id` null. */
  batch: number | null;
  emitted_at: string | null;
};

export type LoPedido = {
  order_id: string;
  /** El número que ve el local («Orden #25»). */
  order_number: number;
  items: LoPedidoItem[];
  /** Personas de la visita (spec 111). `null` = no se cargó. */
  party_size: number | null;
  /** Totales **de la orden**, no sumados a mano: los recalcula el server en
   *  cada envío (`recomputeOrderTotals`) y ya traen descuento y propina. */
  subtotal_cents: number;
  discount_cents: number;
  tip_cents: number;
  total_cents: number;
};

/** Una tanda: lo que se mandó junto en un envío. */
export type TandaLoPedido = {
  /** `batch` de la comanda, o `null` para el grupo de lo que no fue a cocina. */
  batch: number | null;
  /** El envío más viejo de la tanda; `null` en el grupo sin comanda. */
  emitted_at: string | null;
  items: LoPedidoItem[];
};

/**
 * Agrupa por tanda, en el orden en que la mesa las pidió.
 *
 * Lo que no fue a cocina no tiene tanda —ni hora: `order_items` no guarda
 * timestamp propio— así que va en **un grupo al final** (`batch: null`) en vez
 * de inventarle una posición. Es lo que hoy el mozo no ve en ningún lado sin
 * salir a la cuenta.
 */
export function agruparPorTanda(items: LoPedidoItem[]): TandaLoPedido[] {
  const porBatch = new Map<number, LoPedidoItem[]>();
  const sinComanda: LoPedidoItem[] = [];

  for (const item of items) {
    if (item.batch == null) {
      sinComanda.push(item);
      continue;
    }
    const bucket = porBatch.get(item.batch);
    if (bucket) bucket.push(item);
    else porBatch.set(item.batch, [item]);
  }

  const tandas: TandaLoPedido[] = [...porBatch.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([batch, grupo]) => ({
      batch,
      // Una tanda puede tener varias comandas (una por sector) emitidas con
      // milisegundos de diferencia: vale la más vieja.
      emitted_at: grupo.reduce<string | null>(
        (min, i) =>
          i.emitted_at && (!min || i.emitted_at < min) ? i.emitted_at : min,
        null,
      ),
      items: grupo,
    }));

  if (sinComanda.length > 0) {
    tandas.push({ batch: null, emitted_at: null, items: sinComanda });
  }
  return tandas;
}

/** Un ítem anulado no se cobra, pero se sigue mostrando (tachado, con motivo). */
export function estaAnulado(item: LoPedidoItem): boolean {
  return item.cancelled_at != null;
}

/** Cuántos ítems vivos tiene la mesa (para el encabezado de la columna). */
export function contarItemsVivos(items: LoPedidoItem[]): number {
  return items.reduce((n, i) => (estaAnulado(i) ? n : n + i.quantity), 0);
}
