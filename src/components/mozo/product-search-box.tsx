"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import type { CatalogProduct } from "@/lib/mozo/catalog-query";
import { filterProductsByQuery } from "@/lib/mozo/product-search";
import { useStickyFilter } from "@/lib/ui/use-sticky-filter";
import { SegmentedSelector } from "@/components/admin/local/segmented-selector";

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
 * Devuelve **una sola** `results` = lo que hay que mostrar, con o sin búsqueda
 * (spec 073): el caller le pasa la lista de la categoría activa en `browse` y
 * deja de decidir por su cuenta entre resultados y catálogo.
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
  browse,
  storageKey,
  onPick,
  onEnterResults,
}: {
  /** Candidatos: lo que ya pasó el filtro duro del server (`is_active` +
   *  `is_available` en `getCatalogForMozo`). El de la carta online es aparte. */
  products: CatalogProduct[];
  /** Lo que se muestra **sin** búsqueda: los productos de la categoría o
   *  pestaña activa, en el orden en que se ven (spec 073). Antes cada caller
   *  hacía su `isSearching ? resultados : categoría` y sólo los resultados
   *  tenían índice de teclado. */
  browse: CatalogProduct[];
  /** Clave de `localStorage` del filtro de la carta online, ya scopeada por
   *  superficie + negocio: la PC de deliveries y la del salón quieren cosas
   *  distintas. */
  storageKey: string;
  onPick: (product: CatalogProduct) => void;
  /**
   * `↓` en el buscador baja el **foco** a la lista de resultados (spec 075).
   * Antes movía un resaltado virtual y el foco no se iba nunca del `<input>`,
   * que es lo que dejaba al carrito a seis Tabs de distancia.
   *
   * Sin este callback (superficie táctil) `↓` no hace nada.
   */
  onEnterResults?: () => void;
}) {
  const [search, setSearch] = useState("");

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

  /**
   * Lo que hay que mostrar, buscando o no (spec 073). Antes esto era sólo los
   * resultados de la búsqueda y el catálogo por categoría iba por afuera: eran
   * dos modos distintos en la misma pantalla, y el de entrada —el que ves al
   * abrir el panel— era el que no tenía teclado.
   *
   * El filtro de la carta online aplica a los dos: sin búsqueda los chips se
   * mostraban igual pero no filtraban nada.
   */
  const results = useMemo(() => {
    const candidates = (isSearching ? products : browse).filter((p) => {
      if (cartaFilter === CARTA_EN_LINEA) return p.show_online;
      if (cartaFilter === CARTA_SOLO_LOCAL) return !p.show_online;
      return true;
    });
    // El matcheo tolerante (acentos, puntuación, tokens en cualquier orden,
    // plural) y el orden por relevancia viven en `product-search.ts`.
    return isSearching ? filterProductsByQuery(candidates, search) : candidates;
  }, [products, browse, search, cartaFilter, isSearching]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!onEnterResults) return;
      e.preventDefault();
      onEnterResults();
    } else if (e.key === "Enter") {
      // Enter desde el buscador agrega el primero — el caso de siempre: tipeás
      // tres letras y el que buscabas ya está arriba. Para cualquier otro, ↓.
      const pick = results[0];
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
    /** El que abre Enter desde el buscador; la lista lo marca. */
    enterTargetId: results[0]?.id,
    handleKeyDown,
    cartaFilter,
    setCartaFilter,
    showCartaFilter,
    cartaHint: CARTA_HINT[cartaFilter] ?? null,
  };
}

export type ProductSearchApi = ReturnType<typeof useProductSearch>;

/**
 * El filtro de la carta online, arriba del panel y con la misma cara que el
 * selector de salones (spec 111).
 *
 * Es un filtro de **contexto** —«en esta PC cargo delivery, mostrame sólo lo
 * publicado»—, se elige una vez por turno y queda pegado (`useStickyFilter`).
 * Abajo del buscador era una segunda fila de controles que se leía antes de
 * poder tipear, en la pantalla que la spec 111 vino a despejar. Arriba, junto
 * al salón, queda con los otros selectores de contexto.
 *
 * Se renderiza sólo si el catálogo tiene de los dos tipos.
 */
export function CartaOnlineSelector({ api }: { api: ProductSearchApi }) {
  const { showCartaFilter, cartaFilter, setCartaFilter } = api;
  if (!showCartaFilter) return null;

  return (
    <SegmentedSelector
      ariaLabel="Carta online"
      activeId={cartaFilter}
      onSelect={setCartaFilter}
      items={[
        { id: CARTA_ALL, label: "Toda la carta" },
        { id: CARTA_EN_LINEA, label: "En la carta online" },
        { id: CARTA_SOLO_LOCAL, label: "Solo para el local" },
      ]}
    />
  );
}

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
  conFiltroDeCarta = true,
}: {
  api: ProductSearchApi;
  /** El sidebar del salón (spec 111) sube el filtro de la carta online al
   *  header del panel, con `CartaOnlineSelector`: acá abajo son dos filas de
   *  controles antes de poder tipear, que es justo lo que se vino a limpiar. */
  conFiltroDeCarta?: boolean;
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
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
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
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-zinc-400 active:bg-zinc-100"
            aria-label="Limpiar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {conFiltroDeCarta && showCartaFilter && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              Carta online
            </span>
            {chip(CARTA_ALL, "Todos")}
            {chip(CARTA_EN_LINEA, "En la carta online")}
            {chip(CARTA_SOLO_LOCAL, "Solo para el local")}
          </div>
          {/* La explicación aparece sólo cuando hay un filtro puesto: con
              «Todos» no hay nada que aclarar y sería ruido permanente. */}
          {cartaHint && (
            <p className="text-[11px] leading-snug text-zinc-500">
              {cartaHint}
            </p>
          )}
        </div>
      )}
    </>
  );
}
