"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { fromZonedTime } from "date-fns-tz";
import {
  ArrowLeft,
  Bike,
  Clock,
  Loader2,
  Minus,
  Plus,
  ShoppingBag,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getClienteDirecciones,
  type ClienteDireccion,
  type ClienteMatch,
} from "@/lib/admin/customers-actions";
import { formatCurrency } from "@/lib/currency";
import type { CatalogForMozo, CatalogProduct } from "@/lib/mozo/catalog-query";
import { loadPedirCatalog } from "@/lib/mozo/pedir-panel-data";
import { confirmarPedido } from "@/lib/orders/confirm-order";
import {
  filterSlotsByLead,
  localYmd,
  SCHEDULED_MIN_LEAD_MIN,
} from "@/lib/orders/scheduled";
import { cargarPedidoStaff } from "@/lib/orders/staff-order";
import { ProductModal, type AddToCartItem } from "@/components/mozo/product-modal";
import { CustomerFields } from "@/components/shared/customer-fields";
import { PriceOverrideModal } from "@/components/shared/price-override-modal";
import { ProductResultsList } from "@/components/mozo/product-results-list";
import { useCartZone } from "@/lib/mozo/use-cart-zone";
import { isPrintableKey } from "@/lib/ui/roving";
import { useRovingList } from "@/lib/ui/use-roving-list";
import {
  ProductSearchInput,
  useProductSearch,
} from "@/components/mozo/product-search-box";

type CartItem = AddToCartItem & {
  _key: string;
  /** Precio pisado para este pedido (spec 069). */
  price_override_cents?: number | null;
  price_override_reason?: string | null;
};

/** Precio que se va a cobrar: el pisado si lo hay, si no el de catálogo. */
function effectiveUnitPriceCents(c: CartItem): number {
  return c.price_override_cents ?? c.unit_price_cents;
}
type DeliveryType = "pickup" | "delivery";
type View = "carga" | "datos";
/** Spec 085 — para ahora (lo de siempre) o programado a una hora de hoy. */
type When = "now" | "scheduled";

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
  timezone,
  scheduledSlots,
  marchLeadPickupMin,
  marchLeadDeliveryMin,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  /** TZ del negocio: el chip "21:00" es hora del local, no del navegador. */
  timezone: string;
  /** Horarios que el negocio ofrece hoy (spec 085); vacío = no se programa. */
  scheduledSlots: string[];
  marchLeadPickupMin: number;
  marchLeadDeliveryMin: number;
}) {
  const [catalog, setCatalog] = useState<CatalogForMozo | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [view, setView] = useState<View>("carga");
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [openProduct, setOpenProduct] = useState<CatalogProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  // ── Precio por ítem (spec 069) ──
  // Sin gate de rol acá: llegar a este sheet ya exige `canCargarPedido`
  // (admin/encargado), que es exactamente el mismo conjunto que
  // `canOverrideItemPrice`. El server revalida igual en `cargarPedidoStaff`.
  const [priceTargetKey, setPriceTargetKey] = useState<string | null>(null);

  const [deliveryType, setDeliveryType] = useState<DeliveryType>("pickup");
  // ── ¿Para cuándo? (spec 085) ──
  // El encargue telefónico para una hora de hoy. Los chips son los mismos que
  // ve el cliente al programar; el server revalida en `persistOrder`.
  const [when, setWhen] = useState<When>("now");
  const [schedSlot, setSchedSlot] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  // Indicación para cocina: sale como «ENTREGAR x» arriba de la comanda. Es
  // otra cosa que las notas de arriba, que son del cliente y van al control.
  const [kitchenNotes, setKitchenNotes] = useState("");

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

  // Spec 068: mismo buscador que la mesa y que venta rápida — filtrado,
  // teclado y filtro de la carta online viven en `useProductSearch`.
  const allProducts: CatalogProduct[] = useMemo(
    () => catalog?.categories.flatMap((c) => c.products) ?? [],
    [catalog],
  );
  const categoriesWithProducts = useMemo(
    () => (catalog?.categories ?? []).filter((c) => c.products.length > 0),
    [catalog],
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
    storageKey: `cargar_pedido_web_${slug}`,
    onPick: (p) => setOpenProduct(p),
    // ↓ baja el foco al catálogo (spec 075): mismas zonas que la carga de mesa.
    onEnterResults: () =>
      catalogProducts.length > 0 ? catalogo.focusFirst() : carrito.focusFirst(),
  });
  const { isSearching, results: catalogProducts, enterTargetId } = searchApi;

  // Autofocus al buscador al abrir o al volver a la vista de carga.
  useEffect(() => {
    if (open && view === "carga") {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, view]);

  const focusSearch = useCallback(() => {
    setTimeout(() => {
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      // Cursor al final: volver del catálogo con ↑ deja seguir tipeando.
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }, 0);
  }, []);

  /** Escribir desde el catálogo o el carrito vuelve al buscador (FR-014). */
  const escribirEnBuscador = useCallback(
    (char: string) => {
      searchApi.setSearch((s) => s + char);
      focusSearch();
    },
    [searchApi, focusSearch],
  );

  // ── Zonas (spec 075): buscador → catálogo → carrito ──
  const catalogo = useRovingList<HTMLButtonElement>({
    length: catalogProducts.length,
    onExitUp: focusSearch,
    onExitDown: () => carrito.focusFirst(),
  });
  const carrito = useCartZone({
    length: cart.length,
    onExitUp: () =>
      catalogProducts.length > 0 ? catalogo.focusLast() : focusSearch(),
    onQuantityDelta: (i, delta) => {
      const line = cart[i];
      if (line) changeQty(line._key, delta);
    },
    onQuantitySet: (i, quantity) => {
      const line = cart[i];
      if (line) changeQty(line._key, quantity - line.quantity);
    },
    onRemove: (i) => {
      const line = cart[i];
      if (line) removeFromCart(line._key);
    },
    onActivate: (i) => {
      const line = cart[i];
      if (line) setPriceTargetKey(line._key);
    },
    onType: escribirEnBuscador,
  });

  // Chips de horario (spec 085): los de hoy que todavía cumplen la anticipación
  // mínima. Dependen de "ahora", así que se calculan en el cliente — pero sólo
  // se renderizan al tocar «Programar», así que no hay mismatch de hidratación.
  // Al enviar se revalidan, por si el encargado tardó en cargar el pedido.
  const availableSlots = useMemo(
    () => filterSlotsByLead(scheduledSlots, timezone),
    [scheduledSlots, timezone],
  );
  const canSchedule = availableSlots.length > 0;
  const isScheduled = when === "scheduled";
  const marchLeadMin =
    deliveryType === "delivery" ? marchLeadDeliveryMin : marchLeadPickupMin;

  function reset() {
    setView("carga");
    searchApi.setSearch("");
    setCart([]);
    setDeliveryType("pickup");
    setWhen("now");
    setSchedSlot(null);
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setDeliveryNotes("");
    setKitchenNotes("");
    setClienteDirecciones([]);
  }

  if (!open) return null;

  const cartTotal = cart.reduce((a, c) => a + c.line_subtotal_cents, 0);
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);

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
          line_subtotal_cents:
            (effectiveUnitPriceCents(c) + modsTotal) * nextQty,
        };
      }),
    );
  }

  const priceTarget = cart.find((c) => c._key === priceTargetKey);

  /** `cents` null = volver al precio de la carta. */
  function setLinePrice(key: string, cents: number | null, reason: string) {
    setCart((prev) =>
      prev.map((c) => {
        if (c._key !== key) return c;
        const next: CartItem = {
          ...c,
          price_override_cents: cents,
          price_override_reason: cents === null ? null : reason,
        };
        const modsTotal = next.modifiers.reduce(
          (a, m) => a + m.price_delta_cents,
          0,
        );
        next.line_subtotal_cents =
          (effectiveUnitPriceCents(next) + modsTotal) * next.quantity;
        return next;
      }),
    );
    setPriceTargetKey(null);
  }

  /**
   * Soltar el cliente del CRM (spec 067): se limpia el teléfono —su identidad—
   * y las direcciones guardadas, que ya no le corresponden a nadie. El nombre
   * queda como texto libre.
   */
  function quitarCliente() {
    setCustomerPhone("");
    setClienteDirecciones([]);
  }

  function pickCliente(c: ClienteMatch) {
    setCustomerName(c.name ?? "");
    setCustomerPhone(c.phone);
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
    // Programar sin hora no es un pedido: es una intención (spec 085).
    (!isScheduled || !!schedSlot) &&
    (deliveryType === "pickup" ||
      (deliveryAddress.trim().length > 0 && customerPhone.trim().length >= 6));

  function submit(marchar: boolean) {
    if (cart.length === 0) {
      toast.error("Agregá al menos un producto.");
      return;
    }

    // Pedido programado (spec 085): el chip es una hora del local; armamos el
    // instante en su TZ. Revalidamos contra la anticipación mínima porque el
    // sheet pudo quedar abierto un rato. `persistOrder` valida igual.
    let scheduledAtIso: string | undefined;
    if (isScheduled) {
      if (!schedSlot) {
        toast.error("Elegí la hora del pedido.");
        return;
      }
      if (!filterSlotsByLead(scheduledSlots, timezone).includes(schedSlot)) {
        setSchedSlot(null);
        toast.error("Ese horario ya no está disponible. Elegí otro.");
        return;
      }
      scheduledAtIso = fromZonedTime(
        `${localYmd(new Date(), timezone)}T${schedSlot}:00`,
        timezone,
      ).toISOString();
    }

    startTransition(async () => {
      const r = await cargarPedidoStaff({
        business_slug: slug,
        delivery_type: deliveryType,
        scheduled_at: scheduledAtIso,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        delivery_address:
          deliveryType === "delivery"
            ? deliveryAddress.trim() || undefined
            : undefined,
        delivery_notes: deliveryNotes.trim() || undefined,
        kitchen_notes: kitchenNotes.trim() || undefined,
        items: cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
          notes: c.notes || undefined,
          modifier_ids: c.modifiers.map((m) => m.id),
          // Precio pisado (spec 069). El server revalida rol + motivo.
          price_override_cents: c.price_override_cents ?? null,
          price_override_reason: c.price_override_reason ?? null,
        })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (isScheduled) {
        // El programado no marcha ahora: sale solo antes de la hora (o a mano
        // desde «Próximos»). Si el aval falló, avisamos que hay que aceptarlo.
        if (r.data.needs_accept) {
          toast.warning(
            `Pedido #${r.data.order_number} programado para las ${schedSlot}, pero quedó sin aceptar — aceptalo desde «Próximos» para que salga solo`,
          );
        } else {
          toast.success(
            `Pedido #${r.data.order_number} programado para las ${schedSlot} · la comanda sale sola ${marchLeadMin} min antes`,
          );
        }
      } else if (marchar) {
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
          // Cmd/Ctrl+Enter: en carga → ir a datos; en datos → cargar y marchar
          // (o programar, que nunca marcha al toque).
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !openProduct) {
            e.preventDefault();
            if (view === "carga" && cart.length > 0) setView("datos");
            else if (view === "datos" && canSubmit) submit(!isScheduled);
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
              <ProductSearchInput api={searchApi} inputRef={searchRef} />
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
            <div
              onKeyDown={(e) => {
                if (catalogo.handleKeyDown(e)) return;
                if (isPrintableKey(e)) {
                  e.preventDefault();
                  escribirEnBuscador(e.key);
                }
              }}
              className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
            >
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
              ) : (
                // Buscando o no, la misma lista navegable por ↓/↑. Spec 073.
                <ProductResultsList
                  products={catalogProducts}
                  onPick={setOpenProduct}
                  enterTargetId={enterTargetId}
                  itemProps={(id) => {
                    const i = catalogProducts.findIndex((p) => p.id === id);
                    return i < 0 ? {} : catalogo.itemProps(i);
                  }}
                />
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
                <ul
                  onKeyDown={carrito.handleKeyDown}
                  className="max-h-36 space-y-1 overflow-y-auto px-3 py-2"
                >
                  {cart.map((c, i) => (
                    <li
                      key={c._key}
                      {...carrito.itemProps(i)}
                      aria-label={`${c.product_name}, cantidad ${c.quantity}. ← y → cambian la cantidad, Supr la quita.`}
                      className="flex items-center gap-2 rounded-xl bg-zinc-50 px-2.5 py-1.5 outline-none ring-1 ring-zinc-100 focus-visible:ring-2 focus-visible:ring-emerald-500"
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
                        {c.price_override_cents != null && (
                          <p className="truncate text-[11px] font-medium text-amber-700">
                            <span className="line-through opacity-60">
                              {formatCurrency(c.unit_price_cents)}
                            </span>{" "}
                            → {formatCurrency(c.price_override_cents)} ·{" "}
                            {c.price_override_reason}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-emerald-700 tabular-nums">
                        {formatCurrency(c.line_subtotal_cents)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => setPriceTargetKey(c._key)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 active:scale-95 ${
                            c.price_override_cents != null
                              ? "bg-amber-100 text-amber-700 ring-amber-300"
                              : "text-zinc-500 ring-zinc-200 active:bg-zinc-100"
                          }`}
                          aria-label={`Cambiar el precio de ${c.product_name}`}
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </button>
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
              {/* Spec 068: mismo bloque de cliente que abrir mesa y nueva
                  reserva — un solo buscador, y la regla del teléfono bloqueado
                  con un cliente elegido (spec 067) vive en `CustomerFields`. */}
              <section className="space-y-2.5 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
                <CustomerFields
                  slug={slug}
                  idPrefix="cargar"
                  name={customerName}
                  phone={customerPhone}
                  onNameChange={setCustomerName}
                  onPhoneChange={setCustomerPhone}
                  onPick={pickCliente}
                  onClear={quitarCliente}
                  nameLabel={
                    deliveryType === "pickup" ? "Cliente (opcional)" : "Cliente"
                  }
                  phoneLabel={
                    deliveryType === "delivery"
                      ? "Teléfono (requerido)"
                      : "Teléfono (opcional)"
                  }
                  labelClassName="text-xs font-semibold text-zinc-600"
                  inputClassName="block h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
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
                    Notas del pedido (opcional)
                  </label>
                  <input
                    type="text"
                    value={deliveryNotes}
                    onChange={(e) => setDeliveryNotes(e.target.value)}
                    placeholder="ej: sin cebolla, tocar timbre…"
                    className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Va en el ticket de control, con los datos de la entrega.
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600">
                    Entregar (opcional)
                  </label>
                  <input
                    type="text"
                    value={kitchenNotes}
                    onChange={(e) => setKitchenNotes(e.target.value)}
                    maxLength={120}
                    placeholder="ej: 21:30, junto con la mesa 5…"
                    className="mt-1 block h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Sale arriba de la comanda como «ENTREGAR …», para cocina.
                  </p>
                </div>
              </section>

              {/* ─── ¿Para cuándo? (spec 085) ───
                  El encargue telefónico: mismos horarios que ve el cliente,
                  sólo hoy. Al programar, la comanda no sale ahora — la manda el
                  cron con el lead del negocio. */}
              <section className="space-y-2.5 rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                  ¿Para cuándo?
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWhen("now")}
                    className={`h-9 flex-1 rounded-xl text-sm font-semibold transition ${
                      !isScheduled
                        ? "bg-zinc-900 text-white"
                        : "bg-white text-zinc-700 ring-1 ring-zinc-200 active:bg-zinc-100"
                    }`}
                  >
                    Ahora
                  </button>
                  <button
                    type="button"
                    disabled={!canSchedule}
                    onClick={() => setWhen("scheduled")}
                    className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      isScheduled
                        ? "bg-zinc-900 text-white"
                        : "bg-white text-zinc-700 ring-1 ring-zinc-200 active:bg-zinc-100"
                    }`}
                  >
                    <Clock className="h-4 w-4" /> Programar
                  </button>
                </div>
                {!canSchedule ? (
                  <p className="text-[11px] leading-snug text-zinc-500">
                    No quedan horarios para hoy — se programa con al menos{" "}
                    {SCHEDULED_MIN_LEAD_MIN} min de anticipación, sobre los
                    horarios del local.
                  </p>
                ) : (
                  isScheduled && (
                    <>
                      <div className="grid grid-cols-4 gap-1.5">
                        {availableSlots.map((slot) => {
                          const active = schedSlot === slot;
                          return (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setSchedSlot(slot)}
                              className={`h-9 rounded-xl text-sm font-semibold tabular-nums transition ${
                                active
                                  ? "bg-emerald-600 text-white"
                                  : "bg-white text-zinc-700 ring-1 ring-zinc-200 active:bg-zinc-100"
                              }`}
                            >
                              {slot}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] leading-snug text-zinc-500">
                        {schedSlot
                          ? `La comanda sale sola ${marchLeadMin} min antes de las ${schedSlot}. Hasta entonces queda en «Próximos».`
                          : "Elegí la hora del retiro o la entrega — sólo para hoy."}
                      </p>
                    </>
                  )
                )}
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

            {/* Footer datos — programado: una sola acción, porque "enviar a
                cocina" contradice el diferido (spec 085). */}
            <footer className="shrink-0 space-y-2 border-t border-zinc-200 bg-white px-3 py-3">
              {isScheduled ? (
                <button
                  onClick={() => submit(false)}
                  disabled={!canSubmit}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                  {schedSlot
                    ? `Programar para las ${schedSlot}`
                    : "Elegí una hora"}
                </button>
              ) : (
                <>
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
                </>
              )}
            </footer>
          </>
        )}

        {priceTarget && (
          <PriceOverrideModal
            productName={priceTarget.product_name}
            catalogPriceCents={priceTarget.unit_price_cents}
            currentOverrideCents={priceTarget.price_override_cents}
            currentReason={priceTarget.price_override_reason}
            onConfirm={(cents, reason) =>
              setLinePrice(priceTarget._key, cents, reason)
            }
            onClear={() => setLinePrice(priceTarget._key, null, "")}
            onClose={() => setPriceTargetKey(null)}
          />
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
            searchApi.setSearch("");
            focusSearch();
          }}
          embedded
        />
      </div>
    </div>
  );
}
