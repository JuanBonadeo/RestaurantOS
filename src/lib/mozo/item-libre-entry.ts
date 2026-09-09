import type { CatalogProduct } from "./catalog-query";
import { normalizeSearchText } from "./product-search";

/**
 * Spec 174 — cómo se llega al renglón libre («no existe»).
 *
 * **No es un botón aparte: es un producto más en el buscador.** Decisión de
 * Juan: la encargada no busca una función, busca *lo que quiere cobrar*. Tipea
 * «torta del cliente», no encuentra nada —y ese es exactamente el momento en
 * que el sistema tiene que ofrecerle cargarlo igual—.
 *
 * Vive acá y no en el componente porque las tres pantallas de carga comparten
 * el mismo buscador (`useProductSearch`, spec 068): la mesa, el pedido para
 * llevar y la venta de mostrador. Una sola regla, testeable sin DOM.
 */

/**
 * Id de la fila sintética. No es un uuid a propósito: los `products.id` sí lo
 * son, así que no puede colisionar con un producto real ni por accidente, y
 * cualquier caller que lo mande al server rebota contra el schema.
 */
export const ITEM_LIBRE_ID = "__item_libre__";

/** ¿Esta fila del buscador es la del «no existe»? */
export function isItemLibreEntry(product: { id: string } | undefined): boolean {
  return product?.id === ITEM_LIBRE_ID;
}

/**
 * Lo que hace aparecer la fila aunque la búsqueda sí encuentre cosas.
 *
 * «no existe» es como lo nombra el local (viene de MaxiRest). Los otros son los
 * intentos razonables de alguien que nunca lo usó: el wiki ya dejó anotado que
 * el pedido flash existía y nadie lo encontraba porque se llamaba distinto de
 * como lo piensa el salón.
 */
const DISPARADORES = ["no existe", "noexiste", "libre", "suelto", "otro", "vario"];

function esDisparador(query: string): boolean {
  const q = normalizeSearchText(query);
  if (q.length === 0) return false;
  return DISPARADORES.some((d) => normalizeSearchText(d).startsWith(q) || q.startsWith(normalizeSearchText(d)));
}

/**
 * El nombre con el que se abre el modal: lo tipeado, que nueve de cada diez
 * veces ya es el nombre del artículo («torta del cliente», «menú sanatorio»).
 *
 * Salvo que lo tipeado sea el disparador —«no existe»—, que no es el nombre de
 * nada: ahí el campo arranca vacío.
 */
export function nombreSugerido(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return "";
  return esDisparador(trimmed) ? "" : trimmed;
}

/**
 * Suma la fila «no existe» a los resultados cuando corresponde.
 *
 * Dos reglas y ninguna más:
 *
 * 1. **Sin búsqueda no aparece.** El catálogo en reposo es la carta; meterle
 *    una fila fantasma en cada categoría sería ruido en la pantalla más
 *    mirada del turno.
 * 2. **Va siempre al final.** Enter en el buscador agrega el primer resultado
 *    (spec 055): si la fila quedara arriba, tipear «mila» + Enter cargaría un
 *    renglón libre en lugar de la milanesa.
 */
export function withItemLibreEntry(
  results: CatalogProduct[],
  query: string,
  puedeCargarlo: boolean,
): CatalogProduct[] {
  if (!puedeCargarlo) return results;
  const trimmed = query.trim();
  if (trimmed.length === 0) return results;
  // Con resultados sólo aparece si la buscaron por su nombre; sin resultados
  // aparece siempre, porque «no encontré nada» *es* el caso de uso.
  if (results.length > 0 && !esDisparador(trimmed)) return results;

  return [...results, itemLibreEntry()];
}

/** La fila sintética. Precio 0 — la lista la pinta aparte, no la muestra. */
function itemLibreEntry(): CatalogProduct {
  return {
    id: ITEM_LIBRE_ID,
    category_id: null,
    name: "No existe",
    description: null,
    price_cents: 0,
    image_url: null,
    sort_order: Number.MAX_SAFE_INTEGER,
    show_online: false,
    modifier_groups: [],
  };
}

/* ---------------------------------------------------------------------------
 * La línea en el carrito
 *
 * El renglón libre entra al carrito con **la misma forma** que cualquier otra
 * línea (`AddToCartItem`), marcada por el id centinela. Es lo que evita
 * meterle una rama nueva a los tres carritos: cambiar la cantidad, borrar la
 * línea y sumar el subtotal siguen siendo el código que ya está escrito y
 * probado. Lo único que se bifurca es el payload que viaja al server.
 * ------------------------------------------------------------------------- */

/** Lo que devuelve el modal. */
export type ItemLibreDraft = {
  name: string;
  unit_price_cents: number;
  quantity: number;
};

/** Una línea del carrito, en lo mínimo que estos helpers necesitan mirar. */
type CartLineLike = {
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  notes?: string;
};

/** Arma la línea del carrito a partir de lo que devolvió el modal. */
export function itemLibreCartLine(draft: ItemLibreDraft) {
  return {
    product_id: ITEM_LIBRE_ID,
    product_name: draft.name,
    unit_price_cents: draft.unit_price_cents,
    quantity: draft.quantity,
    notes: "",
    modifiers: [] as never[],
    line_subtotal_cents: draft.unit_price_cents * draft.quantity,
  };
}

/** ¿Esta línea del carrito es un renglón libre? */
export function isItemLibreCartLine(line: { product_id: string }): boolean {
  return line.product_id === ITEM_LIBRE_ID;
}

/**
 * El payload de la línea libre, con la forma del schema `free`.
 *
 * El id centinela **no viaja**: no es un producto y el server no tiene qué
 * hacer con él. Lo que viaja es el nombre, el precio y la cantidad — y el
 * server los revalida contra el rol antes de escribir nada.
 */
export function itemLibrePayload(line: CartLineLike) {
  const notes = (line.notes ?? "").trim();
  return {
    kind: "free" as const,
    name: line.product_name,
    unit_price_cents: line.unit_price_cents,
    quantity: line.quantity,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
