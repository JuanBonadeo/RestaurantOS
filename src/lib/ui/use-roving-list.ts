"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clampIndex } from "@/lib/mozo/product-search";
import { gridNextIndex, nextIndex, type RovingMove } from "./roving";

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
  columns = 1,
  onExitUp,
  onExitDown,
}: {
  /** Cuántos elementos tiene la zona ahora mismo. */
  length: number;
  /** `1` = lista (default). `>1` = grilla: ↓/↑ mueven de fila, ←/→ de a uno. */
  columns?: number;
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
  // ¿El usuario está operando ESTA zona con el teclado? Decide si hay que
  // recuperar el foco cuando el ítem enfocado se desmonta.
  const teniaFoco = useRef(false);
  const indexRef = useRef(0);
  indexRef.current = index;

  // La lista cambió: se filtró, se quitó un ítem, entró uno nuevo por realtime.
  useEffect(() => {
    setIndex((i) => Math.max(0, clampIndex(i, length)));
    // Si el ítem que tenía el foco se fue con el cambio —Supr sobre una línea
    // del carrito es el caso típico— el navegador manda el foco al `<body>`, y
    // ahí el teclado de la zona **muere**: los handlers viven en el contenedor
    // y al body no le llega nada. Se recupera en la posición equivalente.
    if (!teniaFoco.current || length === 0) return;
    if (typeof document === "undefined") return;
    if (document.activeElement !== document.body) return;
    setPendingFocus(Math.max(0, clampIndex(indexRef.current, length)));
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

      // De dónde sale el movimiento: del **foco real**, no del estado. El
      // índice es posicional y sólo se sincroniza por `onFocus`; si la lista
      // cambió sola debajo (una demora que se resuelve, una reserva que entra
      // por realtime) el estado apunta a otra fila y la primera flecha se
      // planta o saltea una.
      const enFoco = itemsRef.current.indexOf(
        document.activeElement as unknown as T,
      );
      const desde = enFoco >= 0 ? enFoco : index;

      const move =
        columns > 1
          ? gridNextIndex(desde, e.key, length, columns)
          : e.key === "ArrowDown"
            ? nextIndex(desde, 1, length)
            : e.key === "ArrowUp"
              ? nextIndex(desde, -1, length)
              : null;
      if (!move) return false;

      e.preventDefault();
      applyMove(move);
      return true;
    },
    [columns, index, length, focusIndex, applyMove],
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
      onFocus: () => {
        teniaFoco.current = true;
        setIndex(i);
      },
      onBlur: (e: React.FocusEvent) => {
        // El foco se fue a otra zona (no a otro ítem de ésta ni al `<body>` por
        // un desmontaje): dejamos de ser responsables de recuperarlo.
        const hacia = e.relatedTarget as Node | null;
        if (!hacia) return;
        if (itemsRef.current.some((el) => el === hacia)) return;
        teniaFoco.current = false;
      },
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

export type RovingListApi<T extends HTMLElement = HTMLElement> = ReturnType<
  typeof useRovingList<T>
>;
