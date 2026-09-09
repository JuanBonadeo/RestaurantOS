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
  /** `null` = el renglón libre de la spec 174: nombre y precio a mano, sin
   *  producto de catálogo detrás. */
  product_id: string | null;
  product_name: string;
  quantity: number;
  notes: string | null;
  /** Los modificadores elegidos, ya aplanados a sus nombres. */
  modifiers: string[];
  unit_price_cents: number;
  subtotal_cents: number;
  /**
   * Precio de CARTA de la línea cuando se le pisó el precio (spec 069), o
   * `null` si se cobra el de catálogo. Con esto la línea enviada muestra
   * contra qué se decidió —y ofrece cambiarlo (issue #283)—, igual que la del
   * carrito: `unit_price_cents` es lo que se cobra, no lo que vale.
   */
  price_original_cents: number | null;
  price_override_reason: string | null;
  /** De qué menú del día viene la línea. Con valor, su precio vive en el
   *  combo: `editarItemComanda` no la deja tocar. */
  daily_menu_id: string | null;
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
  /** El correlativo global del pedido, que no se reinicia nunca. */
  order_number: number;
  /** El número que ve el local y canta en voz alta («Orden #7»): arranca en 1
   *  cada jornada y es el que sale impreso en la comanda. */
  daily_number: number;
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

/**
 * ¿Esta línea ya enviada admite que le cambien el precio? (issue #283)
 *
 * Sin el rol: eso lo decide `canOverrideItemPrice` en la superficie. Acá está
 * lo que hace a la línea, y es el espejo de lo que rechaza `editarItemComanda`:
 *
 * Toma el shape mínimo y no `LoPedidoItem`: las dos pantallas de la mesa
 * dibujan la línea desde fuentes distintas —la orden en el panel del salón, la
 * comanda en la de teléfono— y la regla tiene que ser una sola.
 *
 * - **anulada** — ya no se cobra, no hay precio que discutir;
 * - **menú del día / combo** — su precio vive en el padre, el server no la deja;
 * - **renglón libre** (spec 174, sin `product_id`) — no tiene precio de carta
 *   contra el cual medir el cambio: el editor mostraría «Precio de la carta $X»
 *   inventando una carta que no existe. Se corrige borrándolo y cargándolo de
 *   nuevo, como en el carrito.
 */
export function sePuedeRepreciar(item: {
  cancelled_at: string | null;
  daily_menu_id: string | null;
  product_id: string | null;
}): boolean {
  return (
    item.cancelled_at == null &&
    item.daily_menu_id == null &&
    item.product_id != null
  );
}

/** Una tanda: lo que se mandó junto en un envío. */
export type TandaLoPedido = {
  /**
   * La vuelta de la mesa: 1 es lo primero que se mandó. `null` = el grupo de lo
   * que no fue a cocina.
   *
   * No es el `batch` de la comanda (issue #188). `batch` es autoincremental
   * dentro de **(orden, sector)**, a propósito: es el número de ticket de esa
   * cocina. Como número de vuelta no sirve —la primera comanda de parrilla es
   * la 1 aunque salga en la tercera vuelta— y agrupar por él metía envíos
   * distintos en la misma tanda, con la hora del más viejo.
   */
  numero: number | null;
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
/**
 * Cuánto puede tardar un envío en terminar de escribir sus comandas.
 *
 * `enviarComanda` inserta una comanda por sector, una atrás de otra: con cuatro
 * sectores y la base en la nube son un par de segundos entre la primera y la
 * última. Todo lo que caiga adentro de esta ventana se lee como el mismo envío.
 */
const VENTANA_DE_ENVIO_MS = 10_000;

export function agruparPorTanda(items: LoPedidoItem[]): TandaLoPedido[] {
  const sinComanda: LoPedidoItem[] = [];
  const enviados: LoPedidoItem[] = [];

  for (const item of items) {
    if (item.emitted_at == null) sinComanda.push(item);
    else enviados.push(item);
  }

  // La unidad no es el ítem sino la **comanda**: dos milanesas del mismo envío
  // viajan en el mismo papel, y es el papel el que tiene hora y sector.
  const porComanda = new Map<
    string,
    { stationId: string | null; emitted: string; items: LoPedidoItem[] }
  >();
  for (const item of enviados) {
    const clave = item.comanda_id ?? `sin-comanda:${item.emitted_at}`;
    const grupo = porComanda.get(clave);
    if (grupo) grupo.items.push(item);
    else
      porComanda.set(clave, {
        stationId: item.station_id,
        emitted: item.emitted_at!,
        items: [item],
      });
  }

  // Por hora de emisión: es lo único que dice cuándo salió cada cosa.
  const comandas = [...porComanda.values()].sort((a, b) =>
    a.emitted < b.emitted ? -1 : 1,
  );

  const grupos: (typeof comandas)[] = [];
  let arranque: number | null = null;
  let sectoresDeLaTanda = new Set<string | null>();

  for (const comanda of comandas) {
    const t = new Date(comanda.emitted).getTime();
    // Dos señales de que empezó otra vuelta:
    //  1. pasó demasiado tiempo desde que arrancó esta;
    //  2. se repite un sector — un envío crea a lo sumo una comanda por sector,
    //     así que ver fritera dos veces es sí o sí otra vuelta.
    const otraVuelta =
      arranque == null ||
      t - arranque > VENTANA_DE_ENVIO_MS ||
      sectoresDeLaTanda.has(comanda.stationId);

    if (otraVuelta) {
      grupos.push([comanda]);
      arranque = t;
      sectoresDeLaTanda = new Set([comanda.stationId]);
    } else {
      grupos[grupos.length - 1].push(comanda);
      sectoresDeLaTanda.add(comanda.stationId);
    }
  }

  const tandas: TandaLoPedido[] = grupos.map((grupo, i) => ({
    numero: i + 1,
    // La tanda arranca cuando salió su primera comanda.
    emitted_at: grupo[0].emitted,
    items: grupo.flatMap((c) => c.items),
  }));

  if (sinComanda.length > 0) {
    tandas.push({ numero: null, emitted_at: null, items: sinComanda });
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
