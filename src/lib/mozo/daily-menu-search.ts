/**
 * Buscar el menú del día (spec 146 · D-B2).
 *
 * En el panel del salón los menús del día dejaron de encabezar el catálogo con
 * una tarjeta —era lo que la encargada de Golf pedía sacar— y pasaron a una
 * fila compacta. Eso sólo se puede hacer si el buscador, que es lo único que
 * ella dice querer, **llega** a ellos: `useProductSearch` mira productos, y un
 * `daily_menu` no es un producto, así que hasta acá el menú ejecutivo del
 * mediodía no aparecía ni tipeando el nombre exacto.
 *
 * Se apoya en el mismo matcher que la carta (`filterProductsByQuery`): sin
 * acentos, tolerante a plural, tokens en cualquier orden y ordenado por
 * relevancia. Lo único propio es el alias.
 */

import type { DailyMenuForMozo } from "./daily-menus-query";
import { filterProductsByQuery, normalizeSearchText } from "./product-search";

/**
 * Lo que se le agrega al nombre de cada menú para buscarlo.
 *
 * «menú» tiene que encontrarlos aunque el negocio los llame «Ejecutivo» o
 * «Almuerzo del mediodía»: es la palabra con la que uno los piensa, y sin esto
 * el que no se acuerda del nombre no tiene por dónde entrar.
 */
const ALIAS = "menú del día";

/**
 * Los menús del día que matchean la búsqueda, ordenados por relevancia.
 *
 * Búsqueda vacía → **nada**. Es al revés que en los productos: acá el vacío es
 * el estado de reposo del panel, y el reposo no muestra menús (D-B1). Quién los
 * muestra compactos sin búsqueda es la pantalla, no esta función.
 */
export function filterDailyMenus(
  menus: DailyMenuForMozo[],
  query: string,
): DailyMenuForMozo[] {
  if (normalizeSearchText(query) === "") return [];
  const buscables = menus.map((menu) => ({
    menu,
    name: `${menu.name} ${ALIAS}`,
  }));
  return filterProductsByQuery(buscables, query).map(({ menu }) => menu);
}
