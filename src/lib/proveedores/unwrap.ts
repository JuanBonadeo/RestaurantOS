/**
 * Lecturas que no mienten — spec 161.
 *
 * `postgrest-js` **no lanza** ante un fallo: devuelve `{data: null, error}`. El
 * módulo hacía `(res.data ?? [])`, que convierte ese fallo en «no hay filas», y
 * la pantalla de la spec 159 muestra plata mal sin decir nada: si falla
 * `supplier_payments` el proveedor aparece debiendo todo; si falla
 * `supplier_invoices` dice «No hay comprobantes impagos»; si fallan las
 * imputaciones el encabezado dice $0 y la lista dice que debe.
 *
 * Ningún `try/catch` lo atrapa, porque no se lanza nada.
 */

/** Lo que devuelve cualquier consulta de postgrest-js. */
export type Postgrestish<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/** El corte de PostgREST (`db-max-rows`). Medido: `products` tiene 1.326 y devuelve 1.000. */
export const PAGE_SIZE = 1_000;

/**
 * Cuántos ids entran en un `.in()`. El límite real está en el largo de la URL:
 * medido contra este cloud, 600 UUIDs pasan y 680 dan `Bad Request`. 300 deja
 * margen para ids más largos y para los otros filtros de la query.
 */
export const LOTE_IN = 300;

/**
 * Devuelve las filas, o lanza si la consulta falló.
 *
 * Recibe el resultado **entero** a propósito: no hay forma de llamarlo sin
 * pasarle el `error`. Un helper que recibiera sólo `data` dejaría escribir
 * exactamente el bug que esto viene a cerrar.
 *
 * Que lance es la decisión (D1): en un Server Component la excepción sube a
 * Next y se ve. **Ver que se rompió es mucho mejor que ver $0.**
 */
export function unwrap<T>(res: Postgrestish<T>, tabla?: string): T[] {
  const dónde = tabla ? ` (${tabla})` : "";
  if (res.error) {
    throw new Error(`Falló la lectura${dónde}: ${res.error.message}`);
  }
  if (res.data == null) {
    throw new Error(`Falló la lectura${dónde}: la consulta no devolvió filas ni error`);
  }
  return res.data;
}

/** Lo mínimo que `fetchAll` necesita de una query: poder pedirle un rango. */
type Rangeable<T> = { range(desde: number, hasta: number): PromiseLike<Postgrestish<T>> };

/**
 * Trae **todas** las filas, paginando con `.range()`.
 *
 * Sin esto, `getVencimientos` y `getProyeccionPagos` —que leen el negocio
 * entero— empiezan a devolver un número más chico sin avisar. Al ritmo del Golf
 * (3.677 comprobantes y 5.761 pagos en 2025), `supplier_payments` cruza las
 * 1.000 filas en ~2 meses.
 *
 * `armar` se llama una vez por página porque una query de postgrest-js no se
 * puede reutilizar después de ejecutada. **Tiene que traer un `.order()`
 * estable** o entre página y página PostgREST puede repetir o saltear filas; en
 * este módulo se ordena por `id`, que es el único campo garantizado único.
 */
export async function fetchAll<T>(
  armar: () => Rangeable<T>,
  tabla?: string,
): Promise<T[]> {
  const todo: T[] = [];
  for (let desde = 0; ; desde += PAGE_SIZE) {
    const página = unwrap(await armar().range(desde, desde + PAGE_SIZE - 1), tabla);
    todo.push(...página);
    // Una página incompleta es la última. Con un total múltiplo exacto de
    // PAGE_SIZE hace falta una vuelta más, que vuelve vacía.
    if (página.length < PAGE_SIZE) return todo;
  }
}

/**
 * Corre `fetcher` por lotes de ids y concatena, para los `.in()` largos.
 *
 * La ficha de un proveedor con más de ~650 comprobantes hoy no abre: devuelve
 * `Bad Request` porque la lista de UUIDs no entra en la URL.
 */
export async function enLotes<Id, T>(
  ids: Id[],
  fetcher: (lote: Id[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return [];

  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IN) {
    out.push(...(await fetcher(ids.slice(i, i + LOTE_IN))));
  }
  return out;
}
