"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clampIndex } from "@/lib/mozo/product-search";
import { nextIndex, type RovingMove } from "./roving";

/**
 * Lista navegable con **foco real** (roving tabindex) — spec 075, FR-002/005.
 *
 * Cada zona del panel lateral de la operación (resultados, carrito, filas de
 * mesas, métodos de pago…) es una de estas. Un solo elemento queda en el orden
 * de tabulación; las flechas mueven el foco de verdad, y al llegar a un borde
 * la zona **le pasa el foco a la vecina** vía `onExitUp` / `onExitDown`. Eso es
 * lo que hace que ↓ recorra todo el panel de arriba a abajo sin que el usuario
 * tenga que saber dónde termina una lista y empieza la otra.
 *
 * Es la generalización del índice de teclado que la spec 055 tenía escrito a
 * mano en el buscador, donde el foco se quedaba en el `<input>` y el resaltado
 * era virtual. Con foco real, ←/→ quedan libres y el carrito deja de estar a
 * seis Tabs de distancia.
 *
 * Sin `onExitUp`/`onExitDown` (la primera o la última zona del panel), el
 * movimiento contra el borde simplemente no hace nada: el foco se queda.
 */
export function useRovingList<T extends HTMLElement = HTMLElement>({
  length,
  onExitUp,
  onExitDown,
}: {
  /** Cuántos elementos tiene la zona ahora mismo. */
  length: number;
  /** El borde de arriba le pasa el foco a la zona anterior. */
  onExitUp?: () => void;
  /** El borde de abajo le pasa el foco a la zona siguiente. */
  onExitDown?: () => void;
}) {
  const itemsRef = useRef<(T | null)[]>([]);
  const [index, setIndex] = useState(0);
  // Foco pedido para un elemento que todavía no montó (la zona acaba de
  // aparecer): lo resuelve el efecto de abajo en cuanto existe.
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);

  // La lista se achicó (se filtró, se quitó un ítem): el índice no puede quedar
  // apuntando al vacío.
  useEffect(() => {
    setIndex((i) => Math.max(0, clampIndex(i, length)));
  }, [length]);

  const focusAt = useCallback((i: number) => {
    const el = itemsRef.current[i];
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
    return true;
  }, []);

  useEffect(() => {
    if (pendingFocus == null) return;
    focusAt(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, focusAt]);

  /** Mueve el foco (y el índice) a la posición `i` de esta zona. */
  const focusIndex = useCallback(
    (i: number) => {
      const target = clampIndex(i, length);
      if (target < 0) return;
      setIndex(target);
      if (!focusAt(target)) setPendingFocus(target);
    },
    [length, focusAt],
  );

  /** Entrar a la zona desde la vecina de arriba. */
  const focusFirst = useCallback(() => focusIndex(0), [focusIndex]);
  /** Entrar a la zona desde la vecina de abajo. */
  const focusLast = useCallback(
    () => focusIndex(length - 1),
    [focusIndex, length],
  );

  const applyMove = useCallback(
    (move: RovingMove) => {
      if (move.kind === "index") focusIndex(move.index);
      else if (move.edge === "up") onExitUp?.();
      else onExitDown?.();
    },
    [focusIndex, onExitUp, onExitDown],
  );

  /**
   * Handler de teclas de la zona. Devuelve `true` si la consumió, para que el
   * caller pueda encadenar sus propios atajos (`+`/`−` de cantidad, dígitos)
   * sin pisar la navegación.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (e.key === "Home") {
        e.preventDefault();
        focusIndex(0);
        return true;
      }
      if (e.key === "End") {
        e.preventDefault();
        focusIndex(length - 1);
        return true;
      }

      const move =
        e.key === "ArrowDown"
          ? nextIndex(index, 1, length)
          : e.key === "ArrowUp"
            ? nextIndex(index, -1, length)
            : null;
      if (!move) return false;

      e.preventDefault();
      applyMove(move);
      return true;
    },
    [index, length, focusIndex, applyMove],
  );

  /**
   * Props del elemento `i`. El `onFocus` sincroniza el índice cuando el foco
   * llega por otro lado (click, Tab), así la próxima flecha sale de donde el
   * usuario está parado y no de donde estaba la última vez.
   */
  const itemProps = useCallback(
    (i: number) => ({
      ref: (el: T | null) => {
        itemsRef.current[i] = el;
      },
      tabIndex: i === index ? 0 : -1,
      "aria-current": i === index ? ("true" as const) : undefined,
      onFocus: () => setIndex(i),
    }),
    [index],
  );

  return {
    /** Elemento activo de la zona. */
    index,
    itemProps,
    handleKeyDown,
    focusIndex,
    focusFirst,
    focusLast,
  };
}

export type RovingListApi = ReturnType<typeof useRovingList>;
