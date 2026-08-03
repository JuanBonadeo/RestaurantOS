/**
 * Lógica pura de navegación por teclado del panel lateral de la operación
 * (spec 075). Aislada de React/DOM para poder testearla; el hook
 * `use-roving-list` la usa para mover el foco.
 *
 * **Qué agrega sobre [`product-search.ts`](../mozo/product-search.ts).** Aquel
 * `moveSelection` clampea en los bordes: ↓ en el último se queda en el último.
 * Eso alcanzaba cuando la única lista navegable era la de resultados. En un
 * panel con **zonas encadenadas** (buscador → resultados → carrito → enviar) el
 * borde no es el final: es el punto donde hay que **pasarle el foco a la zona
 * vecina**. Por eso acá el movimiento devuelve `index` o `exit`, y el caller
 * decide a quién le entrega el foco.
 *
 * Convención heredada: el índice es `-1` cuando no hay selección.
 */

import { clampIndex } from "@/lib/mozo/product-search";

/** Resultado de un movimiento: quedarse en la zona, o salir por un borde. */
export type RovingMove =
  | { kind: "index"; index: number }
  | { kind: "exit"; edge: "up" | "down" };

/**
 * Mueve `delta` posiciones dentro de una lista de `length` elementos.
 *
 * A diferencia de `moveSelection`, pasarse de un borde **no** clampea: devuelve
 * `exit` para que el caller le pase el foco a la zona de arriba o de abajo.
 *
 * Una zona vacía es **transparente**: sale en la dirección del movimiento, así
 * el foco la atraviesa sin quedar atrapado (ej: el carrito todavía sin ítems).
 */
export function nextIndex(
  index: number,
  delta: number,
  length: number,
): RovingMove {
  if (length <= 0) return { kind: "exit", edge: delta < 0 ? "up" : "down" };
  // El índice puede venir viejo (la lista cambió debajo): se acomoda antes de
  // moverse, así ↑ desde un índice fuera de rango baja al último y no sale.
  const from = clampIndex(index, length);
  // Salvo el caso de entrada `-1` + ↓, que tiene que aterrizar en el primero.
  const target = index < 0 && delta > 0 ? 0 : from + delta;
  if (target < 0) return { kind: "exit", edge: "up" };
  if (target > length - 1) return { kind: "exit", edge: "down" };
  return { kind: "index", index: target };
}

/**
 * Lo mismo sobre una **grilla** de `columns` columnas (el catálogo por
 * categoría): ↓/↑ mueven de fila, ←/→ de a uno.
 *
 * ←/→ se mueven en **orden de lectura**: al final de una fila siguen en la
 * primera celda de la siguiente. Así el catálogo entero se recorre con una sola
 * flecha, que es lo que hace falta cuando no querés pensar en la grilla.
 *
 * Devuelve `null` si la tecla no es una flecha (el caller la deja pasar).
 *
 * Nota: la spec 066 había descartado usar ←/→ acá porque el foco vivía en el
 * `<input>` de búsqueda y se le robaba el cursor al usuario. Con el modelo de
 * zonas de la spec 075 el foco está en la celda, no en el texto: la restricción
 * ya no aplica.
 */
export function gridNextIndex(
  index: number,
  key: string,
  length: number,
  columns: number,
): RovingMove | null {
  const cols = columns > 0 ? Math.floor(columns) : 1;
  switch (key) {
    case "ArrowDown":
      return nextIndex(index, cols, length);
    case "ArrowUp":
      return nextIndex(index, -cols, length);
    case "ArrowRight":
      return nextIndex(index, 1, length);
    case "ArrowLeft":
      return nextIndex(index, -1, length);
    default:
      return null;
  }
}

/**
 * `"1"`…`"9"` → índice 0-8 si existe en la lista, si no `null`.
 *
 * Es el atajo de "elegir la opción N" que ya usaban el asistente del menú del
 * día (donde nació, spec 072) y el walk-in para la cantidad de personas
 * (spec 066); la spec 075 lo trae acá para que también lo use el selector de
 * método de pago.
 */
export function indexFromDigit(key: string, length: number): number | null {
  if (key.length !== 1 || key < "1" || key > "9") return null;
  const index = Number(key) - 1;
  return index < length ? index : null;
}

/**
 * ¿Esta tecla es texto que el usuario quiso escribir?
 *
 * Habilita el "escribí desde donde estés" (FR-014): con el foco en un resultado
 * o en una línea del carrito, apretar una letra devuelve el foco al buscador y
 * la escribe. Sin eso, salir de la zona del buscador se sentiría una trampa.
 *
 * El espacio queda afuera a propósito: sobre un botón enfocado, espacio
 * **activa**, no escribe.
 */
export function isPrintableKey(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Shift **no** descalifica: una mayúscula es texto que el usuario escribió. */
  shiftKey?: boolean;
}): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 && e.key !== " ";
}
