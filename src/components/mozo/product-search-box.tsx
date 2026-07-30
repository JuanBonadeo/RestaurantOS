"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import type { CatalogProduct } from "@/lib/mozo/catalog-query";
import { moveSelection, resetSelection } from "@/lib/mozo/product-search";
import { useStickyFilter } from "@/lib/ui/use-sticky-filter";

export const CARTA_ALL = "all";
/**
 * Filtro por `products.show_online` (spec 068, FR-005).
 *
 * El vocabulario es **el mismo que el form del producto**, que ya dice
 * «Mostrar en la carta online» y explica que al desmarcarlo *"el producto
 * desaparece de la carta que ve el cliente pero el mozo lo sigue teniendo para
 * cargar en la mesa"*. Los ids describen al producto, no al flag: «va a la
 * web» no significaba nada para quien está cargando un pedido.
 */
const CARTA_EN_LINEA = "en-carta";
const CARTA_SOLO_LOCAL = "solo-local";
const CARTA_OPTIONS = [CARTA_EN_LINEA, CARTA_SOLO_LOCAL];

const CARTA_HINT: Record<string, string> = {
  [CARTA_EN_LINEA]:
    "Solo lo que el cliente ve y puede pedir desde la carta online.",
  [CARTA_SOLO_LOCAL]:
    "Solo lo que NO se publica en la carta online: se carga únicamente desde acá.",
};

/**
 * Buscador de productos de los tres flujos de carga (spec 068, FR-004/005):
 * mesa (`pedir-client`), cargar pedido y venta rápida de mostrador.
 *
 * Concentra lo que estaba copiado tres veces: el filtrado por nombre, el índice
 * de teclado (↓/↑/Enter) y el filtro de la carta online. La spec 066 ya había
 * unificado **los resultados** (`ProductResultsList`) porque el mismo bug de
 * flecha estaba escrito tres veces; esto cierra el resto.
 *
 * Es un **hook + un input**, no un componente que envuelva todo, porque en las
 * tres pantallas el buscador vive en un header fijo y los resultados en el área
 * que scrollea: un solo componente que renderice ambos tendría que pelearse con
 * tres layouts distintos. El caller pinta `results` con `ProductResultsList`
 * donde su layout quiera.
 *
 * Lo que **no** se unifica: el navegador de catálogo por categoría. Las tres
 * superficies navegan distinto a propósito (la mesa tiene tabs + menú del día;
 * venta rápida un selector plano).
 */
export function useProductSearch({
  products,
  storageKey,
  onPick,
}: {
  /** Candidatos: lo que ya pasó el filtro duro del server (`is_active` +
   *  `is_available` en `getCatalogForMozo`). El de la carta online es aparte. */
  products: CatalogProduct[];
  /** Clave de `localStorage` del filtro de la carta online, ya scopeada por
   *  superficie + negocio: la PC de deliveries y la del salón quieren cosas
   *  distintas. */
  storageKey: string;
  onPick: (product: CatalogProduct) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [cartaFilter, setCartaFilter] = useStickyFilter<string>(
    storageKey,
    CARTA_ALL,
    CARTA_OPTIONS,
  );

  // Sólo tiene sentido ofrecer el filtro si el catálogo tiene de los dos tipos.
  const showCartaFilter = useMemo(() => {
    let online = false;
    let offline = false;
    for (const p of products) {
      if (p.show_online) online = true;
      else offline = true;
      if (online && offline) return true;
    }
    return false;
  }, [products]);

  const isSearching = search.trim().length > 0;

  const results = useMemo(() => {
    if (!isSearching) return [];
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.name.toLowerCase().includes(q)) return false;
      if (cartaFilter === CARTA_EN_LINEA) return p.show_online;
      if (cartaFilter === CARTA_SOLO_LOCAL) return !p.show_online;
      return true;
    });
  }, [products, search, cartaFilter, isSearching]);

  useEffect(() => {
    setSelectedIndex(resetSelection(results.length));
  }, [results.length, search]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSearching) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => moveSelection(i, 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => moveSelection(i, -1, results.length));
    } else if (e.key === "Enter") {
      const pick = results[selectedIndex];
      if (pick) {
        e.preventDefault();
        onPick(pick);
      }
    }
  };

  return {
    search,
    setSearch,
    isSearching,
    results,
    selectedIndex,
    selectedProductId: results[selectedIndex]?.id,
    handleKeyDown,
    cartaFilter,
    setCartaFilter,
    showCartaFilter,
    cartaHint: CARTA_HINT[cartaFilter] ?? null,
  };
}

export type ProductSearchApi = ReturnType<typeof useProductSearch>;

/**
 * Input del buscador + los chips del filtro de la carta online. Uno solo para
 * las tres
 * pantallas (antes eran tres inputs con el mismo `onKeyDown` copiado).
 */
export function ProductSearchInput({
  api,
  inputRef: externalRef,
  autoFocus = false,
  placeholder = "Buscar producto…",
  className = "block h-11 w-full rounded-2xl border border-zinc-200 bg-white pl-9 pr-9 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100",
}: {
  api: ProductSearchApi;
  /** Para los callers que necesitan devolverle el foco al buscador después de
   *  agregar un producto (venta rápida, mesa). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? ownRef;
  const {
    search,
    setSearch,
    handleKeyDown,
    showCartaFilter,
    cartaFilter,
    setCartaFilter,
    cartaHint,
  } = api;

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      0,
    );
    return () => clearTimeout(t);
  }, [autoFocus, inputRef]);

  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setCartaFilter(id)}
      aria-pressed={cartaFilter === id}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
        cartaFilter === id
          ? "bg-zinc-900 text-white"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Buscar producto"
          className={className}
          autoComplete="off"
        />
        {search.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 active:bg-zinc-100"
            aria-label="Limpiar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showCartaFilter && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              Carta online
            </span>
            {chip(CARTA_ALL, "Todos")}
            {chip(CARTA_EN_LINEA, "En la carta online")}
            {chip(CARTA_SOLO_LOCAL, "Solo para el local")}
          </div>
          {/* La explicación aparece sólo cuando hay un filtro puesto: con
              «Todos» no hay nada que aclarar y sería ruido permanente. */}
          {cartaHint && (
            <p className="text-[11px] leading-snug text-zinc-500">{cartaHint}</p>
          )}
        </div>
      )}
    </>
  );
}
