"use client";

import { useCallback } from "react";

import { nextIndex } from "./roving";

/**
 * Selector de "lo que puede recibir el foco" — el mismo que ya usaban los
 * focus-trap del `ProductModal` y del asistente del menú del día, para que las
 * flechas y el Tab recorran exactamente el mismo conjunto.
 *
 * `:not([tabindex="-1"])` es lo que hace que esto **componga con zonas
 * anidadas**: una grilla con roving tabindex (los horarios de una reserva, por
 * ejemplo) deja un solo elemento en `tabindex=0`, así que aporta **una** parada
 * al recorrido del formulario en vez de veinte.
 */
const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [href]';

/** Tipos de `<input>` donde ↑/↓ ya mueven el valor (fecha, hora, número). */
const INPUTS_CON_FLECHAS = new Set(["date", "datetime-local", "month", "number", "time", "week"]);

/** ¿En este elemento las flechas ↑/↓ ya significan algo? */
function usaLasFlechas(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLInputElement && INPUTS_CON_FLECHAS.has(el.type)) return true;
  return false;
}

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

function irA(el: HTMLElement | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest" });
}

/**
 * `↑`/`↓` se mueven entre los controles de un panel — spec 075.
 *
 * Para las **listas** homogéneas (resultados, carrito, filas de mesas) está
 * `useRovingList`, que lleva índice propio. Esto es para los panales tipo
 * formulario —detalle de mesa, walk-in, nueva reserva, acciones de la cuenta—,
 * donde los controles son heterogéneos y aparecen o desaparecen según el
 * estado: en vez de mantener un registro, se leen del DOM en el momento, igual
 * que hacen los focus-trap existentes.
 *
 * En resumen: las flechas hacen lo que hace Tab, pero sin obligar al encargado
 * a cambiar de mano ni de tecla en medio del recorrido.
 *
 * No secuestra las flechas cuando el foco está en un `<textarea>`, un
 * `<select>` o un `<input type="date">`: ahí ↑/↓ ya mueven el cursor, la opción
 * o la fecha.
 *
 * Devuelve `handleKeyDown` (informa si consumió la tecla, para encadenarlo con
 * los atajos propios del panel) y `move`, que hace lo mismo **sin evento** —
 * lo usa una zona anidada para decir "me pasé del borde, seguí vos".
 */
export function useArrowFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  opts: { onExitUp?: () => void; onExitDown?: () => void } = {},
) {
  const { onExitUp, onExitDown } = opts;

  /** Mover el foco `delta` controles dentro del contenedor. */
  const move = useCallback(
    (delta: number) => {
      const container = containerRef.current;
      if (!container) return;
      const items = focusables(container);
      if (items.length === 0) return;
      const active = document.activeElement;
      const from = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const m = nextIndex(from, delta, items.length);
      if (m.kind === "index") irA(items[m.index]);
      else if (m.edge === "up") onExitUp?.();
      else onExitDown?.();
    },
    [containerRef, onExitUp, onExitDown],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
      // Una zona anidada (una grilla con su propio índice) ya la manejó: no se
      // mueve dos veces por una sola tecla.
      if (e.defaultPrevented) return false;
      if (usaLasFlechas(document.activeElement)) return false;
      if (!containerRef.current) return false;

      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
      return true;
    },
    [containerRef, move],
  );

  return { handleKeyDown, move };
}
