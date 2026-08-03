"use client";

import { useCallback, useRef } from "react";

/**
 * Devolver el foco a donde estaba — spec 075, FR-003/009.
 *
 * El panel lateral de la operación es una cadena de modos (lista → detalle →
 * cargar pedido / cuenta / cobro). Al cerrar uno, hoy el foco queda huérfano en
 * el `<body>`: el Esc siguiente no hace nada y hay que volver al mouse para
 * retomar. Con esto, cerrar un modo devuelve el foco a la fila o al botón que
 * lo abrió, y la cadena se recorre entera con el teclado.
 *
 * `restore()` devuelve `false` si el origen ya no está en el DOM —la fila se
 * re-renderizó porque la mesa cambió de estado, por ejemplo— para que el caller
 * pueda caer al primer elemento de la lista en vez de dejar el foco perdido.
 *
 * ```ts
 * const { capture, restore } = useReturnFocus();
 * const abrir = () => { capture(); setModo("cobro"); };
 * const cerrar = () => { setModo(null); if (!restore()) lista.focusFirst(); };
 * ```
 */
export function useReturnFocus() {
  const originRef = useRef<HTMLElement | null>(null);

  /** Anotar quién tiene el foco justo antes de abrir el modo. */
  const capture = useCallback(() => {
    const el = document.activeElement;
    originRef.current = el instanceof HTMLElement ? el : null;
  }, []);

  /** Devolverle el foco. `false` = el origen ya no existe. */
  const restore = useCallback(() => {
    const el = originRef.current;
    originRef.current = null;
    if (!el || !el.isConnected) return false;
    el.focus({ preventScroll: true });
    return true;
  }, []);

  return { capture, restore };
}
