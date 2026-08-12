/**
 * Lógica pura de selección de resultado en el buscador de productos del panel
 * de carga (spec 055 — carga de pedido por teclado). Aislada de React/DOM para
 * poder testearla (TDD): el componente mantiene un `selectedIndex` sobre la
 * lista de resultados y usa estas funciones para moverlo con el teclado (↓/↑) y
 * resetearlo al cambiar la búsqueda.
 *
 * Convención: el índice es `-1` cuando no hay resultados (sin selección
 * posible); en una lista no vacía siempre queda dentro de `[0, length-1]`
 * (clamp, sin wrap-around).
 */

/** Acota `index` a un índice válido dentro de una lista de `length` elementos.
 *  Devuelve `-1` si la lista está vacía. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/** Mueve la selección `delta` posiciones con clamp (sin wrap-around).
 *  ↓ = `+1`, ↑ = `-1`. Lista vacía → `-1`. */
export function moveSelection(
  index: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return -1;
  return clampIndex(index + delta, length);
}

/** Selección inicial cuando (re)aparece una lista de resultados —p. ej. al
 *  cambiar el texto de búsqueda—: el primero (`0`), o `-1` si no hay
 *  resultados. */
export function resetSelection(length: number): number {
  return length > 0 ? 0 : -1;
}

/* ---------------------------------------------------------------------------
 * Matcheo del texto de búsqueda
 *
 * El filtro era `name.toLowerCase().includes(q)`: en hora pico eso falla con
 * todo lo que uno tipea de apuro — «pure» no encontraba «Puré», «napo mila» no
 * encontraba «Milanesa napolitana», «coca cola» no encontraba «Coca-Cola» y
 * «empanadas» no encontraba «Empanada de carne». Además el orden era el del
 * catálogo, y como Enter agrega el primer resultado, el que buscabas podía no
 * estar arriba.
 * ------------------------------------------------------------------------- */

/**
 * Minúsculas, sin diacríticos y con la puntuación convertida en espacio.
 *
 * Se aplica a los dos lados de la comparación: ni tipear la tilde ni omitirla
 * puede fallar. La puntuación va a espacio para que «Coca-Cola», «1/2 Lomo» y
 * «Ravioles (ricota)» se busquen como palabras sueltas.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Los tokens de la búsqueda, ya normalizados. */
function tokenize(query: string): string[] {
  return normalizeSearchText(query).split(" ").filter(Boolean);
}

/**
 * Plural boludo: «empanadas» → «empanada», «papas» → «papa». Sólo se usa como
 * segundo intento (ver `matchTokens`), así que no importa que sea grosero.
 */
function singular(token: string): string {
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/**
 * Qué tan bueno es el match de un token contra un texto ya normalizado.
 * Más chico = mejor. `null` = no matchea.
 *
 * 0 → el texto arranca con el token («mila» → «Milanesa napolitana»)
 * 1 → una palabra del texto arranca con el token («napo» → «Milanesa napo…»)
 * 2 → aparece en el medio de una palabra («pole» → «Napolitana»)
 */
function tokenScore(haystack: string, token: string): number | null {
  const at = haystack.indexOf(token);
  if (at < 0) return null;
  if (at === 0) return 0;
  if (haystack.indexOf(` ${token}`) >= 0) return 1;
  return 2;
}

/**
 * Todos los tokens tienen que aparecer, en cualquier orden — así «napo mila»
 * encuentra «Milanesa napolitana», que es como uno tipea cuando recuerda el
 * plato pero no cómo está escrito en la carta.
 *
 * Devuelve el puntaje (suma de los de cada token; menos es mejor) o `null` si
 * falta alguno. Si con el token tal cual no da, se reintenta en singular y se
 * penaliza (+1) para que el match exacto quede arriba.
 */
function matchTokens(haystack: string, tokens: string[]): number | null {
  let total = 0;
  for (const token of tokens) {
    const exact = tokenScore(haystack, token);
    if (exact !== null) {
      total += exact;
      continue;
    }
    const sing = singular(token);
    const loose = sing === token ? null : tokenScore(haystack, sing);
    if (loose === null) return null;
    total += loose + 1;
  }
  return total;
}

/** Lo mínimo que necesita el buscador de cada producto. */
type SearchableProduct = { name: string };

/**
 * Filtra y **ordena** por relevancia: primero lo que arranca con lo tipeado,
 * después lo que matchea el arranque de alguna palabra, al final lo del medio.
 * Empate → se respeta el orden del catálogo (sort estable), que es el que el
 * negocio eligió.
 *
 * Importa el orden porque Enter en el buscador agrega el primer resultado.
 */
export function filterProductsByQuery<T extends SearchableProduct>(
  products: T[],
  query: string,
): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return products;

  const scored: { product: T; score: number }[] = [];
  for (const product of products) {
    const score = matchTokens(normalizeSearchText(product.name), tokens);
    if (score !== null) scored.push({ product, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .map(({ product }) => product);
}
