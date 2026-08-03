"use client";

import { useCallback } from "react";

import { indexFromDigit, isPrintableKey } from "@/lib/ui/roving";
import { useRovingList } from "@/lib/ui/use-roving-list";

/**
 * El pedido en armado, operable sin mouse — spec 075, FR-012.
 *
 * La spec 055 puso el carrito a la vista mientras se carga; lo que faltaba era
 * poder **tocarlo**: hoy corregir una cantidad o sacar una línea son seis Tabs
 * o un viaje al mouse en el medio de la carga.
 *
 * El elemento que recibe el foco es **la línea entera**, no sus botones: con la
 * línea enfocada, ←/→ mueven la cantidad, un dígito la fija y Supr la quita.
 * Los botones siguen ahí para el mouse y para Tab.
 *
 * `Backspace` no borra la línea a propósito: en el panel de la operación esa
 * tecla ya sube un nivel en la cadena de modos, y que además borrara plata
 * cargada sería una trampa. Para quitar, Supr.
 *
 * Lo comparten la carga de una mesa y la venta rápida de mostrador, que tienen
 * el mismo carrito con dos tipos de ítem distintos.
 */
export function useCartZone({
  length,
  onExitUp,
  onExitDown,
  onQuantityDelta,
  onQuantitySet,
  onRemove,
  onActivate,
  onType,
}: {
  length: number;
  /** ↑ en la primera línea: vuelve al último resultado del catálogo. */
  onExitUp?: () => void;
  /** ↓ en la última línea: sigue hacia la acción primaria del panel. */
  onExitDown?: () => void;
  /** ←/− restan, →/+ suman. */
  onQuantityDelta: (index: number, delta: number) => void;
  /** `1`–`9` fijan la cantidad (mismo atajo que el walk-in y `ProductModal`). */
  onQuantitySet?: (index: number, quantity: number) => void;
  /** Supr. */
  onRemove: (index: number) => void;
  /** Enter sobre la línea (ej: editar el precio). */
  onActivate?: (index: number) => void;
  /** Cualquier letra: el foco vuelve al buscador y arranca a escribir (FR-014). */
  onType?: (char: string) => void;
}) {
  const zona = useRovingList<HTMLLIElement>({ length, onExitUp, onExitDown });
  const { index, handleKeyDown: navKeyDown } = zona;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (navKeyDown(e)) return;
      if (index < 0 || index >= length) return;

      switch (e.key) {
        case "ArrowRight":
        case "+":
        case "=":
          e.preventDefault();
          onQuantityDelta(index, 1);
          return;
        case "ArrowLeft":
        case "-":
          e.preventDefault();
          onQuantityDelta(index, -1);
          return;
        case "Delete":
          e.preventDefault();
          onRemove(index);
          return;
        case "Enter":
        case " ":
          if (!onActivate) return;
          e.preventDefault();
          onActivate(index);
          return;
      }

      const cantidad = onQuantitySet ? indexFromDigit(e.key, 9) : null;
      if (cantidad !== null) {
        e.preventDefault();
        onQuantitySet?.(index, cantidad + 1);
        return;
      }

      if (onType && isPrintableKey(e)) {
        e.preventDefault();
        onType(e.key);
      }
    },
    [
      navKeyDown,
      index,
      length,
      onQuantityDelta,
      onQuantitySet,
      onRemove,
      onActivate,
      onType,
    ],
  );

  return { ...zona, handleKeyDown };
}
