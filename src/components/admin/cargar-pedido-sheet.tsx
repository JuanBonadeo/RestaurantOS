"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  Bike,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  buscarClientes,
  getClienteDirecciones,
  type ClienteDireccion,
  type ClienteMatch,
} from "@/lib/admin/customers-actions";
import { formatCurrency } from "@/lib/currency";
import type { CatalogForMozo, CatalogProduct } from "@/lib/mozo/catalog-query";
import { loadPedirCatalog } from "@/lib/mozo/pedir-panel-data";
import { moveSelection, resetSelection } from "@/lib/mozo/product-search";
import { confirmarPedido } from "@/lib/orders/confirm-order";
import { cargarPedidoStaff } from "@/lib/orders/staff-order";
import { ProductModal, type AddToCartItem } from "@/components/mozo/product-modal";
import { ProductResultsList } from "@/components/mozo/product-results-list";

type CartItem = AddToCartItem & { _key: string };
type DeliveryType = "pickup" | "delivery";
type View = "carga" | "datos";

/** Compone una dirección guardada en una línea editable. */
function formatDireccion(a: ClienteDireccion): string {
  const base = [a.street, a.number].filter(Boolean).join(" ");
  return a.apartment ? `${base}, ${a.apartment}` : base;
}

/**
 * Spec 054 (fase 2) — «Cargar pedido» para llevar/delivery SIN mesa desde el
 * board. Alineado con el sidebar keyboard-first del salón (spec 055): buscador
 * fijo con foco, resultados navegables por ↓/↑/Enter, pedido siempre visible,
 * categorías en un `<select>` compacto, reusando `ProductModal` (ya operable por
 * teclado) y la lógica de índice de `product-search.ts`. Suma un paso de datos
 * con selector de **cliente existente** (`buscarClientes`) + entrega, que el
 * pedido de mesa no necesita. Arma el pedido con `cargarPedidoStaff` →
 * `persistOrder` (sin `table_id`).
 */
export function CargarPedidoSheet({
  slug,
  open,
  onClose,
  onCreated,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogForMozo | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [view, setView] = useState<View>("carga");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [deliveryType, setDeliveryType] = useState<DeliveryType>("pickup");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");

  // Selector de cliente existente.
  const [clienteQuery, setClienteQuery] = useState("");
  const [clienteResults, setClienteResults] = useState<ClienteMatch[]>([]);
  const [clienteLoading, setClienteLoading] = useState(false);
  const [clientePicked, setClientePicked] = useState<string | null>(null);
  const [clienteDirecciones, setClienteDirecciones] = useState<
    ClienteDireccion[]
  >([]);

  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Cargar el catálogo al abrir (lazy). ──
  useEffect(() => {
    if (!open || catalog || loadingCatalog) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    loadPedirCatalog(slug).then((r) => {
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
  }, [open, slug, catalog, loadingCatalog]);

  const isSearching = search.trim().length > 0;

  const allProducts: CatalogProduct[] =
    catalog?.categories.flatMap((c) => c.products) ?? [];
  const searchResults: CatalogProduct[] = isSearching
    ? allProducts.filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : [];

  // Reset del índice del teclado al cambiar los resultados.
  useEffect(() => {
    setSelectedIndex(resetSelection(searchResults.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Autofocus al buscador al abrir o al volver a la vista de carga.
  useEffect(() => {
    if (open && view === "carga") {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, view]);

  // Debounce de la búsqueda de clientes.
  useEffect(() => {
    const q = clienteQuery.trim();
    if (q.length < 2) {
      setClienteResults([]);
      return;
    }
    setClienteLoading(true);
    const t = setTimeout(async () => {
      const r = await buscarClientes(slug, q);
      setClienteResults(r.ok ? r.data : []);
      setClienteLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [clienteQuery, slug]);

  function focusSearch() {
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function reset() {
    setView("carga");
    setSearch("");
    setCart([]);
    setDeliveryType("pickup");
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setDeliveryNotes("");
    setClienteQuery("");
    setClienteResults([]);
    setClientePicked(null);
    setClienteDirecciones([]);
  }

  if (!open) return null;

  const cartTotal = cart.reduce((a, c) => a + c.line_subtotal_cents, 0);
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);

  const categoriesWithProducts = (catalog?.categories ?? []).filter(
    (c) => c.products.length > 0,
  );
  const catalogProducts: CatalogProduct[] = isSearching
    ? searchResults
    : (categoriesWithProducts.find((c) => c.id === activeCategory)?.products ??
      categoriesWithProducts[0]?.products ??
      []);

  function addToCart(item: AddToCartItem) {
    setCart((prev) => [...prev, { ...item, _key: crypto.randomUUID() }]);
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

  /**
   * Soltar el cliente del CRM (spec 067): se limpia el teléfono —su identidad—
   * y las direcciones guardadas, que ya no le corresponden a nadie. El nombre
   * queda como texto libre.
   */
  function quitarCliente() {
    setClientePicked(null);
    setCustomerPhone("");
    setClienteDirecciones([]);
  }

  function pickCliente(c: ClienteMatch) {
    setCustomerName(c.name ?? "");
    setCustomerPhone(c.phone);
    setClientePicked(c.id);
    setClienteQuery("");
    setClienteResults([]);
    setClienteDirecciones([]);
    // Traemos las direcciones guardadas para prellenar la de delivery (editable).
    getClienteDirecciones(slug, c.id).then((r) => {
      if (!r.ok) return;
      setClienteDirecciones(r.data);
      if (deliveryType === "delivery" && r.data.length > 0) {
        setDeliveryAddress(formatDireccion(r.data[0]));
      }
    });
  }

  const canSubmit =
    cart.length > 0 &&
    !pending &&
    (deliveryType === "pickup" ||
      (deliveryAddress.trim().length > 0 && customerPhone.trim().length >= 6));

  function submit(marchar: boolean) {
    if (cart.length === 0) {
      toast.error("Agregá al menos un producto.");
      return;
    }
    startTransition(async () => {
      const r = await cargarPedidoStaff({
        business_slug: slug,
        delivery_type: deliveryType,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        delivery_address:
          deliveryType === "delivery"
            ? deliveryAddress.trim() || undefined
            : undefined,
        delivery_notes: deliveryNotes.trim() || undefined,
        items: cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
          notes: c.notes || undefined,
          modifier_ids: c.modifiers.map((m) => m.id),
        })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (marchar) {
        const c = await confirmarPedido(r.data.order_id, slug);
        if (!c.ok) {
          toast.warning(`Pedido #${r.data.order_number} cargado, pero no marchó: ${c.error}`);
        } else {
          toast.success(`Pedido #${r.data.order_number} cargado y enviado a cocina`);
        }
      } else {
        toast.success(`Pedido #${r.data.order_number} cargado`);
      }
      reset();
      onCreated?.();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter: en carga → ir a datos; en datos → cargar y marchar.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !openProduct) {
            e.preventDefault();
            if (view === "carga" && cart.length > 0) setView("datos");
            else if (view === "datos" && canSubmit) submit(true);
          }
        }}
        className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-zinc-50 shadow-2xl"
      >
        {/* ─── Header ─── */}
        <header className="shrink-0 border-b border-zinc-200 bg-white px-3 py-2.5">
          <div className="flex items-center gap-2">
            {view === "datos" ? (
              <button
                onClick={() => setView("carga")}
                className="-ml-1 rounded-full p-2 text-zinc-700 active:bg-zinc-100"
                aria-label="Volver a la carga"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <ShoppingBag className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Cargar pedido
              </p>
              <h2 className="font-heading text-base font-bold leading-tight text-zinc-900">
                {view === "carga" ? "Elegí los productos" : "Cliente y entrega"}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-zinc-500 active:bg-zinc-100"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => setDeliveryType("pickup")}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition ${
                deliveryType === "pickup"
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200"
              }`}
            >
              <ShoppingBag className="h-4 w-4" /> Para llevar
            </button>
            <button
              onClick={() => setDeliveryType("delivery")}
              className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition ${
                deliveryType === "delivery"
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200"
              }`}
            >
              <Bike className="h-4 w-4" /> Delivery
            </button>
          </div>
        </header>

        {view === "carga" ? (
          <>
            {/* ─── Buscador fijo + categorías (spec 055) ─── */}
            <div className="shrink-0 space-y-2 border-b border-zinc-200 bg-white px-3 py-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (!isSearching) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSelectedIndex((i) =>
                        moveSelection(i, 1, searchResults.length),
                      );
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelectedIndex((i) =>
                        moveSelection(i, -1, searchResults.length),
                      );
                    } else if (e.key === "Enter") {
                      const pick = searchResults[selectedIndex];
                      if (pick) {
                        e.preventDefault();
                        setOpenProduct(pick);
                      }
                    }
                  }}
                  placeholder="Buscar producto..."
                  aria-label="Buscar producto"
                  className="block h-11 w-full rounded-2xl border border-zinc-200 bg-white pl-9 pr-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </div>
              {!isSearching && categoriesWithProducts.length > 1 && (
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="cargar-cat"
                    className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    Categoría
                  </label>
                  <select
                    id="cargar-cat"
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

            {/* ─── Resultados (scroll) ─── */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {loadingCatalog ? (
                <div className="flex h-40 items-center justify-center text-zinc-400">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : catalogError ? (
                <div className="rounded-2xl border border-dashed border-red-200 bg-red-50 py-10 text-center">
                  <p className="text-sm font-semibold text-red-700">
                    {catalogError}
                  </p>
                </div>
              ) : catalogProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-white py-10 text-center">
                  <p className="text-sm font-semibold text-zinc-700">
                    {isSearching ? "Sin resultados" : "Sin productos"}
                  </p>
                </div>
              ) : isSearching ? (
                // Buscando: lista de una columna navegable por ↓/↑. Spec 066.
                <ProductResultsList
                  products={catalogProducts}
                  onPick={setOpenProduct}
                  selectedProductId={searchResults[selectedIndex]?.id}
                />
              ) : (
                // Catálogo por categoría: grilla de toque (sin teclado).
                <div className="grid grid-cols-2 gap-2.5">
                  {catalogProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setOpenProduct(p)}
                      className="flex min-h-[84px] flex-col justify-between rounded-2xl bg-white p-3 text-left ring-1 ring-zinc-200 transition active:scale-[0.97] active:bg-zinc-50"
                    >
                      <span className="line-clamp-2 text-sm font-semibold text-zinc-900">
                        {p.name}
                      </span>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-emerald-700 tabular-nums">
                          {formatCurrency(p.price_cents)}
                        </span>
                        <span className="rounded-full bg-emerald-50 p-1 text-emerald-700">
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ─── Pedido en armado (siempre visible) ─── */}
            <div className="shrink-0 border-t border-zinc-200 bg-white">
              <div className="flex items-center justify-between px-3 pt-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Tu pedido
                </p>
                <span className="text-[11px] font-semibold text-zinc-500 tabular-nums">
                  {cartCount > 0
                    ? `${cartCount} ${cartCount === 1 ? "ítem" : "ítems"}`
                    : "vacío"}
                </span>
              </div>
              {cart.length === 0 ? (
                <p className="px-3 pb-2.5 pt-1 text-xs text-zinc-500">
                  Todavía no cargaste nada. Buscá arriba y agregá con Enter.
                </p>
              ) : (
                <ul className="max-h-36 space-y-1 overflow-y-auto px-3 py-2">
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
                      <span className="shrink-0 text-xs font-semibold text-emerald-700 tabular-nums">
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
              <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-zinc-500">Total</p>
                  <p className="text-lg font-bold tabular-nums text-zinc-900">
                    {formatCurrency(cartTotal)}
                  </p>
                </div>
                <button
                  onClick={() => setView("datos")}
                  disabled={cart.length === 0}
                  className="flex h-11 items-center gap-2 rounded-2xl bg-zinc-900 px-5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
                >
                  Continuar
                  <span className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] sm:inline">
                    ⌘↵
                  </span>
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ─── Vista datos: cliente + entrega ─── */
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
              {/* Buscar cliente existente */}
              <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
                <p className="text-xs font-semibold text-zinc-600">
                  Cliente {clientePicked && "· elegido de la lista"}
                </p>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={clienteQuery}
                    onChange={(e) => setClienteQuery(e.target.value)}
                    placeholder="Buscar cliente existente (nombre o teléfono)…"
                    className="block h-10 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-9 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                  {clienteLoading && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
                  )}
                </div>
                {clienteResults.length > 0 && (
                  <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl ring-1 ring-zinc-200">
                    {clienteResults.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => pickCliente(c)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left active:bg-zinc-50"
                        >
                          <span className="truncate text-sm font-semibold text-zinc-900">
                            {c.name ?? "Sin nombre"}
                          </span>
                          <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                            {c.phone}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Datos (editables; se prellenan si elegís un cliente) */}
              <section className="space-y-2.5 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
                <div>
                  <label className="text-xs font-semibold text-zinc-600">
                    Nombre {deliveryType === "pickup" && "(opcional)"}
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setClientePicked(null);
                    }}
                    placeholder="Mostrador"
                    className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="text-xs font-semibold text-zinc-600">
                      Teléfono{" "}
                      {clientePicked
                        ? "· del cliente elegido"
                        : deliveryType === "delivery"
                          ? "(requerido)"
                          : "(opcional)"}
                    </label>
                    {clientePicked && (
                      <button
                        type="button"
                        onClick={quitarCliente}
                        className="text-xs font-semibold text-zinc-400 underline underline-offset-2 transition hover:text-zinc-700"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  {/* Spec 067: con un cliente del CRM elegido el teléfono no se
                      edita — es la clave con la que se lo identifica, no un dato
                      más. «Quitar» suelta la identidad y vuelve a mano. */}
                  <input
                    type="tel"
                    value={customerPhone}
                    readOnly={!!clientePicked}
                    aria-readonly={!!clientePicked}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="11 5555 1234"
                    className={`mt-1 block h-10 w-full rounded-xl border px-3 text-sm focus:outline-none ${
                      clientePicked
                        ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-600"
                        : "border-zinc-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    }`}
                  />
                </div>
                {deliveryType === "delivery" && (
                  <div>
                    <label className="text-xs font-semibold text-zinc-600">
                      Dirección de entrega (requerida)
                    </label>
                    {clienteDirecciones.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {clienteDirecciones.map((a) => {
                          const linea = formatDireccion(a);
                          const activa = deliveryAddress === linea;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setDeliveryAddress(linea)}
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                                activa
                                  ? "bg-zinc-900 text-white"
                                  : "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 active:bg-zinc-200"
                              }`}
                            >
                              {a.label ? `${a.label}: ` : ""}
                              {linea}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <input
                      type="text"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder="Av. del Golf 123"
                      className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                    {clienteDirecciones.length > 0 && (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        Elegí una dirección guardada o editá el campo.
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-zinc-600">
                    Notas (opcional)
                  </label>
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="ej: sin cebolla, tocar timbre…"
                    className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
              </section>

              {/* Resumen del pedido */}
              <div className="flex items-center justify-between rounded-2xl bg-zinc-100 px-4 py-3">
                <span className="text-sm font-medium text-zinc-600">
                  {cartCount} {cartCount === 1 ? "ítem" : "ítems"}
                </span>
                <span className="text-lg font-bold tabular-nums text-zinc-900">
                  {formatCurrency(cartTotal)}
                </span>
              </div>
            </div>

            {/* Footer datos */}
            <footer className="shrink-0 space-y-2 border-t border-zinc-200 bg-white px-3 py-3">
              <button
                onClick={() => submit(true)}
                disabled={!canSubmit}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Cargar y enviar a cocina
              </button>
              <button
                onClick={() => submit(false)}
                disabled={!canSubmit}
                className="h-10 w-full rounded-2xl bg-zinc-100 text-sm font-semibold text-zinc-700 transition active:scale-[0.98] disabled:opacity-40"
              >
                Sólo cargar (marchar después)
              </button>
            </footer>
          </>
        )}

        {/* Modal de producto — scopeado al panel (embedded → overlay absolute). */}
        <ProductModal
          product={openProduct}
          open={!!openProduct}
          onClose={() => {
            setOpenProduct(null);
            focusSearch();
          }}
          onAdd={(item) => {
            addToCart(item);
            setOpenProduct(null);
            setSearch("");
            focusSearch();
          }}
          embedded
        />
      </div>
    </div>
  );
}
