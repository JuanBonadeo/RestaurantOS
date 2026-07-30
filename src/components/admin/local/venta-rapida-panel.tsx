"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Loader2,
  Minus,
  Plus,
  Receipt,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ProductModal, type AddToCartItem } from "@/components/mozo/product-modal";
import { ProductResultsList } from "@/components/mozo/product-results-list";
import {
  ProductSearchInput,
  useProductSearch,
} from "@/components/mozo/product-search-box";
import { emitInvoice } from "@/lib/afip/emit-invoice";
import { calculateAdjustment } from "@/lib/billing/adjustment";
import type { Caja, PaymentMethod, PaymentMethodConfig } from "@/lib/caja/types";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
import { formatCurrency } from "@/lib/currency";
import type { CatalogForMozo, CatalogProduct } from "@/lib/mozo/catalog-query";
import { loadPedirCatalog } from "@/lib/mozo/pedir-panel-data";
import {
  iniciarVentaMostrador,
  venderMostrador,
} from "@/lib/orders/venta-mostrador";

type CartItem = AddToCartItem & { _key: string };

/** Métodos de mostrador. MP link/QR quedan fuera (van por `iniciarPagoMp`). */
const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card_manual", label: "Tarjeta" },
  { value: "transfer", label: "Transfer." },
];

/** Última venta cobrada, para ofrecer la factura sin frenar la siguiente. */
type UltimaVenta = { orderId: string; orderNumber: number; totalCents: number };

/**
 * Spec 058 — **Venta rápida** de kiosko / barra: una sola pantalla para elegir
 * productos y cobrar, sin abrir mesa ni pedir datos del cliente.
 *
 * Vive como modo del sidebar del salón porque es ahí donde el encargado ya está
 * parado. Reusa el picker keyboard-first de spec 055 (buscador con foco, ↓/↑ y
 * Enter, `ProductModal` para modificadores) y le pega abajo el bloque de cobro,
 * de manera que la venta entera sea: tipear, Enter, Enter, cobrar.
 *
 * Después de cobrar el panel **no se cierra**: limpia el carrito y devuelve el
 * foco al buscador, porque en una barra las ventas vienen en fila.
 */
export function VentaRapidaPanel({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogForMozo | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [cajas, setCajas] = useState<Caja[]>([]);
  const [methodConfigs, setMethodConfigs] = useState<PaymentMethodConfig[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>("");
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [cajaId, setCajaId] = useCajaPreferida(slug, cajas);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [ultima, setUltima] = useState<UltimaVenta | null>(null);

  const [pending, startTransition] = useTransition();
  const [facturando, startFacturar] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  /** Idempotencia del cobro (issue #58): una clave por intento, no por click. */
  const requestIdRef = useRef<string | null>(null);

  // ── Carga inicial: catálogo + cajas, en paralelo. ──
  useEffect(() => {
    let alive = true;
    loadPedirCatalog(slug).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setCatalog(r.data.catalog);
        const firstCat = r.data.catalog.categories.find(
          (c) => c.products.length > 0,
        );
        setActiveCategory(firstCat?.id ?? "");
      } else {
        setCatalogError(r.error);
      }
      setLoadingCatalog(false);
    });
    iniciarVentaMostrador(slug).then((r) => {
      if (!alive) return;
      if (r.ok) {
        // La caja la resuelve `useCajaPreferida` cuando llega la lista.
        setCajas(r.data.cajas);
        setMethodConfigs(r.data.methodConfigs);
      } else {
        setInitError(r.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Autofocus al buscador al abrir.
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const categoriesWithProducts = useMemo(
    () => (catalog?.categories ?? []).filter((c) => c.products.length > 0),
    [catalog],
  );

  // Spec 068: el buscador (filtrado + teclado + filtro de la web) es el mismo
  // de la mesa y de cargar pedido.
  const allProducts = useMemo(
    () => categoriesWithProducts.flatMap((c) => c.products),
    [categoriesWithProducts],
  );
  // Lo que se ve sin búsqueda: la categoría activa. Va al hook, que decide
  // entre esto y los resultados y le da índice de teclado a los dos (spec 073).
  const browseProducts: CatalogProduct[] = useMemo(
    () =>
      categoriesWithProducts.find((c) => c.id === activeCategory)?.products ??
      categoriesWithProducts[0]?.products ??
      [],
    [categoriesWithProducts, activeCategory],
  );
  const searchApi = useProductSearch({
    products: allProducts,
    browse: browseProducts,
    storageKey: `venta_rapida_web_${slug}`,
    onPick: (p) => setOpenProduct(p),
  });
  const {
    isSearching,
    results: visibleProducts,
    selectedProductId,
  } = searchApi;

  const subtotal = cart.reduce((a, c) => a + c.line_subtotal_cents, 0);
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);

  // El ajuste que muestra la UI es el mismo que el server recalcula al cobrar
  // (`payment_method_configs`) — acá sólo se anticipa para que el encargado
  // cante el precio correcto antes de confirmar. La cuenta sale de
  // `calculateAdjustment`, la misma que usan el resto de los cobros (spec 062):
  // estaba escrita a mano acá, que es exactamente cómo se despegan los precios.
  const ajustePercent =
    methodConfigs.find((c) => c.method === method)?.adjustment_percent ?? 0;
  const { adjustmentCents: ajusteCents, finalCents: totalACobrar } =
    calculateAdjustment(subtotal, ajustePercent);

  function focusSearch() {
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function addToCart(item: AddToCartItem) {
    setCart((prev) => [...prev, { ...item, _key: crypto.randomUUID() }]);
    searchApi.setSearch("");
    focusSearch();
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((c) => c._key !== key));
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev.map((c) => {
        if (c._key !== key) return c;
        const nextQty = c.quantity + delta;
        if (nextQty < 1 || nextQty > 99) return c;
        const modsTotal = c.modifiers.reduce(
          (a, m) => a + m.price_delta_cents,
          0,
        );
        return {
          ...c,
          quantity: nextQty,
          line_subtotal_cents: (c.unit_price_cents + modsTotal) * nextQty,
        };
      }),
    );
  }

  const canCobrar = cart.length > 0 && !!cajaId && !pending && !initError;

  function cobrar() {
    if (cart.length === 0) {
      toast.error("Agregá al menos un producto.");
      return;
    }
    if (!cajaId) {
      toast.error("Elegí una caja para registrar el cobro.");
      return;
    }
    startTransition(async () => {
      const r = await venderMostrador({
        business_slug: slug,
        method,
        caja_id: cajaId,
        tip_cents: 0,
        items: cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
          notes: c.notes || undefined,
          modifier_ids: c.modifiers.map((m) => m.id),
        })),
        request_id: (requestIdRef.current ??= crypto.randomUUID()),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      requestIdRef.current = null; // cobro OK → la próxima venta usa clave nueva

      if (r.data.ruteo_error) {
        toast.warning(
          `Venta #${r.data.order_number} cobrada, pero la comanda no salió: ${r.data.ruteo_error}`,
        );
      } else if (r.data.comandas_creadas > 0) {
        toast.success(
          `Venta #${r.data.order_number} cobrada · ${r.data.comandas_creadas} comanda${r.data.comandas_creadas === 1 ? "" : "s"} a cocina`,
        );
      } else {
        toast.success(
          `Venta #${r.data.order_number} cobrada · ${formatCurrency(r.data.cobrado_cents)}`,
        );
      }

      setUltima({
        orderId: r.data.order_id,
        orderNumber: r.data.order_number,
        totalCents: r.data.cobrado_cents,
      });
      // Listo para el próximo cliente: carrito limpio, foco en el buscador.
      setCart([]);
      searchApi.setSearch("");
      focusSearch();
    });
  }

  function facturarUltima() {
    if (!ultima) return;
    startFacturar(async () => {
      const r = await emitInvoice({
        orderId: ultima.orderId,
        slug,
        tipoComprobante: "factura_b",
      });
      if (!r.ok) {
        toast.error(`No se pudo facturar: ${r.error}`);
        return;
      }
      toast.success(`Venta #${ultima.orderNumber} facturada.`);
      setUltima(null);
    });
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ─── Header ─── */}
      <header className="border-border/60 flex shrink-0 items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <Store className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Venta rápida
          </p>
          <h3 className="font-heading text-base font-bold leading-tight text-zinc-900">
            Kiosko / barra · sin mesa
          </h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-2 text-zinc-500 transition active:bg-zinc-100"
          aria-label="Cerrar venta rápida"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {initError && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800">
          {initError}
        </div>
      )}

      {/* ─── Buscador + categorías ─── */}
      <div className="shrink-0 space-y-2 border-b border-zinc-200 bg-white px-3 py-2.5">
        <ProductSearchInput api={searchApi} inputRef={searchRef} autoFocus />
        {!isSearching && categoriesWithProducts.length > 1 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="venta-cat"
              className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
            >
              Categoría
            </label>
            <select
              id="venta-cat"
              value={activeCategory}
              onChange={(e) => setActiveCategory(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-zinc-800 focus:border-emerald-400 focus:outline-none"
            >
              {categoriesWithProducts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ─── Productos ─── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loadingCatalog ? (
          <div className="flex h-40 items-center justify-center text-zinc-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : catalogError ? (
          <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 py-10 text-center">
            <p className="text-sm font-semibold text-red-700">{catalogError}</p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white py-10 text-center">
            <p className="text-sm font-semibold text-zinc-700">
              {isSearching ? "Sin resultados" : "Sin productos"}
            </p>
          </div>
        ) : (
          // Buscando o no, la misma lista navegable por ↓/↑. Spec 073.
          <ProductResultsList
            products={visibleProducts}
            onPick={setOpenProduct}
            selectedProductId={selectedProductId}
          />
        )}
      </div>

      {/* ─── Carrito + cobro (siempre visible) ─── */}
      <div className="shrink-0 border-t border-zinc-200 bg-white">
        <div className="flex items-center justify-between px-3 pt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            La venta
          </p>
          <span className="text-[11px] font-semibold tabular-nums text-zinc-500">
            {cartCount > 0
              ? `${cartCount} ${cartCount === 1 ? "ítem" : "ítems"}`
              : "vacía"}
          </span>
        </div>

        {cart.length === 0 ? (
          <p className="px-3 pb-2 pt-1 text-xs text-zinc-500">
            Buscá arriba y agregá con Enter. Se cobra sin abrir mesa.
          </p>
        ) : (
          <ul className="max-h-32 space-y-1 overflow-y-auto px-3 py-2">
            {cart.map((c) => (
              <li
                key={c._key}
                className="flex items-center gap-2 rounded-xl bg-zinc-50 px-2.5 py-1.5 ring-1 ring-zinc-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {c.product_name}
                  </p>
                  {c.notes && (
                    <p className="truncate text-[11px] italic text-zinc-500">
                      &quot;{c.notes}&quot;
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-700">
                  {formatCurrency(c.line_subtotal_cents)}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => changeQty(c._key, -1)}
                    disabled={c.quantity <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-700 ring-1 ring-zinc-200 active:bg-zinc-100 disabled:opacity-40"
                    aria-label="Menos"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-5 text-center text-sm font-bold tabular-nums">
                    {c.quantity}
                  </span>
                  <button
                    onClick={() => changeQty(c._key, 1)}
                    disabled={c.quantity >= 99}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-700 ring-1 ring-zinc-200 active:bg-zinc-100 disabled:opacity-40"
                    aria-label="Más"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeFromCart(c._key)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 active:bg-zinc-100"
                    aria-label={`Quitar ${c.product_name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Caja — sólo si hay más de una que elegir. */}
        {cajas.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Caja
            </span>
            {cajas.map((c) => (
              <button
                key={c.id}
                onClick={() => setCajaId(c.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                  cajaId === c.id
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-700 ring-1 ring-zinc-200"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Método de pago, con su recargo/descuento a la vista. */}
        <div className="grid grid-cols-3 gap-1.5 border-t border-zinc-100 px-3 py-2">
          {METODOS.map((m) => {
            const pct =
              methodConfigs.find((c) => c.method === m.value)
                ?.adjustment_percent ?? 0;
            return (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className={`rounded-xl py-2 text-sm font-semibold transition ${
                  method === m.value
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-700 ring-1 ring-zinc-200"
                }`}
              >
                {m.label}
                {pct !== 0 && (
                  <span
                    className={`ml-1 text-[10px] font-bold ${
                      method === m.value
                        ? "text-white/70"
                        : pct < 0
                          ? "text-emerald-600"
                          : "text-rose-600"
                    }`}
                  >
                    {pct > 0 ? "+" : ""}
                    {pct}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-zinc-500">
              {ajustePercent !== 0 ? (
                <>
                  {formatCurrency(subtotal)}{" "}
                  <span
                    className={
                      ajustePercent < 0 ? "text-emerald-700" : "text-rose-600"
                    }
                  >
                    {ajustePercent < 0 ? "−" : "+"}
                    {formatCurrency(Math.abs(ajusteCents))}
                  </span>
                </>
              ) : (
                "Total"
              )}
            </p>
            <p className="text-lg font-bold tabular-nums text-zinc-900">
              {formatCurrency(totalACobrar)}
            </p>
          </div>
          <button
            onClick={cobrar}
            disabled={!canCobrar}
            className="flex h-11 items-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Receipt className="h-4 w-4" />
            )}
            Cobrar {formatCurrency(totalACobrar)}
          </button>
        </div>

        {/* Factura de la última venta — opcional, nunca frena la siguiente. */}
        {ultima && (
          <div className="flex items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-600">
              Venta #{ultima.orderNumber} cobrada ·{" "}
              {formatCurrency(ultima.totalCents)}
            </p>
            <button
              onClick={facturarUltima}
              disabled={facturando}
              className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-200 transition active:bg-zinc-100 disabled:opacity-40"
            >
              {facturando ? "Facturando…" : "Facturar"}
            </button>
            <button
              onClick={() => setUltima(null)}
              className="shrink-0 rounded-full p-1 text-zinc-400 active:bg-zinc-100"
              aria-label="Descartar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <ProductModal
        product={openProduct}
        open={!!openProduct}
        onClose={() => {
          setOpenProduct(null);
          focusSearch();
        }}
        onAdd={addToCart}
        embedded
      />
    </div>
  );
}
