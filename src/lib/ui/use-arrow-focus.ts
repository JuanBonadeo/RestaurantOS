"use client";

import { useCallback } from "react";

import { nextIndex } from "./roving";

/**
 * Selector de "lo que puede recibir el foco" — el mismo que ya usaban los
 * focus-trap del `ProductModal` y del asistente del menú del día, para que las
 * flechas y el Tab recorran exactamente el mismo conjunto.
 */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** ¿En este elemento las flechas ↑/↓ ya significan algo (mover el cursor)? */
function movesCaretVertically(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
  );
}

/**
 * `↑`/`↓` se mueven entre los controles de un panel — spec 075.
 *
 * Para las **listas** homogéneas (resultados, carrito, filas de mesas) está
 * `useRovingList`, que lleva índice propio. Esto es para los panales tipo
 * formulario —detalle de mesa, walk-in, acciones de la cuenta—, donde los
 * controles son heterogéneos y aparecen o desaparecen según el estado: en vez
 * de mantener un registro, se leen del DOM en el momento, igual que hacen los
 * focus-trap existentes.
 *
 * En resumen: las flechas hacen lo que hace Tab, pero sin obligar al encargado
 * a cambiar de mano ni de tecla en medio del recorrido.
 *
 * No secuestra las flechas cuando el foco está en un `<textarea>` o un
 * `<select>`: ahí ↑/↓ ya mueven el cursor o la opción.
 *
 * Devuelve un handler que informa si consumió la tecla, para poder encadenarlo
 * con los atajos propios del panel (`+`/`−`, dígitos).
 */
export function useArrowFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  opts: { onExitUp?: () => void; onExitDown?: () => void } = {},
) {
  const { onExitUp, onExitDown } = opts;

  return useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
      const active = document.activeElement;
      if (movesCaretVertically(active)) return false;

      const container = containerRef.current;
      if (!container) return false;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (items.length === 0) return false;

      const from = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const move = nextIndex(from, e.key === "ArrowDown" ? 1 : -1, items.length);

      e.preventDefault();
      if (move.kind === "index") {
        const el = items[move.index];
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
      } else if (move.edge === "up") {
        onExitUp?.();
      } else {
        onExitDown?.();
      }
      return true;
    },
    [containerRef, onExitUp, onExitDown],
  );
}
