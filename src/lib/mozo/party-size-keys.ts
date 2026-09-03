/**
 * Atajos de teclado para la cantidad de personas al abrir una mesa (spec 066,
 * FR-004). Lógica pura, aislada de React/DOM para poder testearla: el walk-in
 * mantiene el `partySize` en el form y usa esto para decidir qué hace cada
 * tecla.
 *
 * Mismo patrón que la cantidad de `ProductModal` (spec 055 fast-follow), más
 * los dígitos: una mesa de 4 se carga tecleando `4`.
 */

export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 20;

/**
 * Traduce una tecla a la nueva cantidad de personas, acotada a
 * `[MIN_PARTY_SIZE, MAX_PARTY_SIZE]`.
 *
 * - `+` / `=` (la misma tecla sin Shift) → una más.
 * - `-` → una menos.
 * - `1`–`9` → esa cantidad, directo.
 *
 * Devuelve `null` si la tecla no es nuestra — el componente la deja pasar. Una
 * tecla reconocida que no mueve el número (p. ej. `+` en el tope) devuelve el
 * valor igual, para que el componente igual frene el evento.
 */
export function partySizeFromKey(key: string, current: number): number | null {
  if (key === "+" || key === "=") {
    return Math.min(MAX_PARTY_SIZE, current + 1);
  }
  if (key === "-") {
    return Math.max(MIN_PARTY_SIZE, current - 1);
  }
  if (key >= "1" && key <= "9" && key.length === 1) {
    return Math.min(MAX_PARTY_SIZE, Number(key));
  }
  return null;
}

/**
 * Lo mismo, pero para el modal de **comensales** que se abre al entrar a una
 * mesa libre (spec 146, fast-follow 2). La diferencia es qué pasa después de
 * mover el número:
 *
 * - un **dígito** fija la cantidad **y confirma** — «4» y ya estás cargando
 *   productos. Pedido de Juan: *"no que tenga que poner 4 más Enter, son pasos
 *   extras que no queremos"*. Es el 99 % de las mesas.
 * - `+` / `−` sólo **ajustan**: son el camino a las mesas de 10 a 20, donde no
 *   alcanza un dígito. Ahí confirma el Enter.
 *
 * `null` = la tecla no es nuestra.
 */
export function comensalesDesdeTecla(
  key: string,
  current: number,
): { valor: number; confirma: boolean } | null {
  const valor = partySizeFromKey(key, current);
  if (valor === null) return null;
  const esDigito = key.length === 1 && key >= "1" && key <= "9";
  return { valor, confirma: esDigito };
}
