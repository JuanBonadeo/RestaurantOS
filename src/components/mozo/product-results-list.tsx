"use client";

import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";

/**
 * Resultados del buscador de productos, compartidos por los tres panales de
 * carga: mesa (`pedir-client`), para llevar/delivery (`cargar-pedido-sheet`) y
 * venta rápida de mostrador (`venta-rapida-panel`). Spec 066, FR-001/002/003.
 *
 * **Una sola columna, a propósito.** Antes esto era una `grid grid-cols-2` en
 * cada panel, con el índice del teclado moviéndose ±1: en una grilla de dos
 * columnas, "+1" es la celda de al lado, así que ↓ movía la selección al
 * costado. La alternativa —grilla + ↓/↑ de a dos y ←/→ de a uno— no sirve
 * porque el foco vive en el `<input>` de búsqueda y secuestrar ←/→ le saca al
 * usuario el cursor del texto que está tipeando. En fila, ↓ baja y listo.
 *
 * La densidad no se pierde: una fila compacta ocupa lo mismo que media grilla
 * de tarjetas de 84px. El catálogo por categoría (sin búsqueda activa) sigue
 * siendo grilla — ahí no hay índice de teclado, es superficie de toque.
 */
export function ProductResultsList({
  products,
  onPick,
  selectedProductId,
}: {
  products: CatalogProduct[];
  onPick: (p: CatalogProduct) => void;
  /** Resultado navegado por teclado: se marca y se mantiene a la vista. */
  selectedProductId?: string;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedProductId) {
      selectedRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedProductId]);

  return (
    <ul className="space-y-1.5">
      {products.map((p) => {
        const isSelected = p.id === selectedProductId;
        return (
          <li key={p.id}>
            <button
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onPick(p)}
              aria-current={isSelected ? "true" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 text-left transition active:scale-[0.99] active:bg-zinc-50 ${
                isSelected ? "ring-2 ring-emerald-500" : "ring-1 ring-zinc-200"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
                {p.name}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-700">
                {formatCurrency(p.price_cents)}
              </span>
              <span className="shrink-0 rounded-full bg-emerald-50 p-1 text-emerald-700">
                <Plus className="h-3.5 w-3.5" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
