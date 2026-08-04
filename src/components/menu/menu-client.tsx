"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { ActiveOrderBanner } from "@/components/menu/active-order-banner";
import { I, ImageTile, StatusDot } from "@/components/delivery/primitives";
import { computeIsOpen, type BusinessHour } from "@/lib/business-hours";
import type { ActiveOrder } from "@/lib/customers/active-orders";
import { formatCurrency } from "@/lib/currency";
import type {
  MenuCategory,
  MenuDailyMenu,
  MenuProduct,
  MenuSuperCategory,
} from "@/lib/menu";
import { cartCount, cartTotal, useCart } from "@/stores/cart";

import { DailyMenuSection } from "./daily-menu-section";
import { DailyMenuSheet } from "./daily-menu-sheet";
import { ProductCard } from "./product-card";
import { ProductSheet } from "./product-sheet";

type DisplayTab = {
  id: string;
  name: string;
  products: MenuProduct[];
  subcategories?: { name: string; products: MenuProduct[] }[];
};

function buildDisplayTabs(
  categories: MenuCategory[],
  superCategories: MenuSuperCategory[],
): DisplayTab[] {
  const tabs: DisplayTab[] = [];
  const used = new Set<string>();

  // Un tab por super-categoría (en su orden), con sus categorías como
  // subcategorías diferenciadas adentro. Con una sola categoría no se muestra
  // la sub-sección (evita un encabezado redundante).
  const sortedSupers = [...superCategories].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  for (const sup of sortedSupers) {
    const supCats = categories.filter((c) => c.super_category_id === sup.id);
    if (supCats.length === 0) continue;
    supCats.forEach((c) => used.add(c.id));
    tabs.push({
      id: `super-${sup.id}`,
      name: sup.name,
      products: supCats.flatMap((c) => c.products),
      subcategories:
        supCats.length > 1
          ? supCats.map((c) => ({ name: c.name, products: c.products }))
          : undefined,
    });
  }

  // Categorías sin super-categoría → cada una su propio tab, al final.
  for (const c of categories) {
    if (used.has(c.id)) continue;
    tabs.push({ id: c.id, name: c.name, products: c.products });
  }

  return tabs;
}

export function MenuClient({
  slug,
  businessName,
  tagline,
  coverImageUrl,
  logoUrl,
  categories,
  superCategories,
  todaysMenus,
  todayLabel,
  deliveryFeeCents,
  minOrderCents,
  estimatedMinutes,
  activeOrders,
  hours,
  timezone,
  isOpenInitial,
  user,
}: {
  slug: string;
  businessName: string;
  tagline: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  categories: MenuCategory[];
  superCategories: MenuSuperCategory[];
  todaysMenus: MenuDailyMenu[];
  todayLabel: string;
  deliveryFeeCents: number;
  minOrderCents: number;
  estimatedMinutes: number | null;
  activeOrders: ActiveOrder[];
  hours: BusinessHour[];
  timezone: string;
  isOpenInitial: boolean;
  user: { name?: string; email: string } | null;
}) {
  const displayTabs = useMemo(
    () => buildDisplayTabs(categories, superCategories),
    [categories, superCategories],
  );

  const [active, setActive] = useState(displayTabs[0]?.id ?? "");
  const [selected, setSelected] = useState<MenuProduct | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedDailyMenu, setSelectedDailyMenu] =
    useState<MenuDailyMenu | null>(null);
  const [dailyMenuSheetOpen, setDailyMenuSheetOpen] = useState(false);

  const [isOpen, setIsOpen] = useState(isOpenInitial);
  useEffect(() => {
    const tick = () => setIsOpen(computeIsOpen(hours, timezone));
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [hours, timezone]);

  const activeTab = useMemo(
    () => displayTabs.find((t) => t.id === active) ?? displayTabs[0],
    [active, displayTabs],
  );

  // La barra de categorías scrollea en horizontal y en un celular no se nota
  // que hay más categorías afuera de pantalla. Marcamos con un degradé + chevron
  // de qué lado queda contenido, y sólo cuando efectivamente lo hay.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState({
    left: false,
    right: false,
  });
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const update = () => {
      // 1px de tolerancia: los anchos sub-pixel dejan un resto que nunca llega
      // a 0 y dispararía el degradé con la barra ya scrolleada hasta el final.
      setTabsOverflow({
        left: el.scrollLeft > 1,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // El contenedor por el resize de viewport; los botones porque su ancho
    // cambia cuando termina de cargar la tipografía del negocio.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [displayTabs]);

  const items = useCart(slug, (s) => s.items);
  const count = cartCount(items);
  const total = cartTotal(items);

  const cartByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      // Sólo los ítems-producto suman al badge "qty en cart" del listado de
      // productos. Los menús del día llevan su propio contador aparte.
      if (it.kind === "daily_menu" || !it.product_id) continue;
      m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.quantity);
    }
    return m;
  }, [items]);

  const fee = deliveryFeeCents;
  const min = minOrderCents;
  const hasDelivery = fee > 0 || min > 0 || estimatedMinutes != null;
  const eta = estimatedMinutes ? `${estimatedMinutes} min` : "30–45 min";

  const handleSelect = (product: MenuProduct) => {
    setSelected(product);
    setSheetOpen(true);
  };

  const handleSelectDailyMenu = (menu: MenuDailyMenu) => {
    setSelectedDailyMenu(menu);
    setDailyMenuSheetOpen(true);
  };

  const initials = user
    ? (user.name ?? user.email)
        .split(/\s+|[@.]/)
        .filter(Boolean)
        .slice(0, 1)
        .map((s) => s[0]?.toUpperCase() ?? "")
        .join("")
    : "";
  const firstName = user
    ? (user.name ?? user.email.split("@")[0]).split(" ")[0]
    : "Cuenta";

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        paddingBottom: count > 0 ? 110 : 24,
        background: "var(--bg)",
      }}
    >
      {/* Active order banner — only for logged-in users with non-terminal orders */}
      <ActiveOrderBanner
        slug={slug}
        orders={activeOrders}
        estimatedMinutes={estimatedMinutes}
      />

      {/* Hero */}
      <div style={{ position: "relative" }}>
        <ImageTile
          src={coverImageUrl}
          alt={businessName}
          tone="#C9B792"
          radius={0}
          sizes="520px"
          priority
          style={{ height: 160 }}
        />
        {user ? (
          <Link
            href={`/${slug}/perfil`}
            style={{
              position: "absolute",
              top: 20,
              right: 16,
              height: 40,
              paddingLeft: 4,
              paddingRight: 14,
              borderRadius: 99,
              background: "rgba(255,255,255,0.95)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "var(--ink)",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 99,
                background: "var(--accent)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {initials || "?"}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.1 }}>
              {firstName}
            </span>
          </Link>
        ) : (
          <Link
            href={`/${slug}/login?next=${encodeURIComponent(`/${slug}/menu`)}`}
            style={{
              position: "absolute",
              top: 20,
              right: 16,
              height: 40,
              padding: "0 16px",
              borderRadius: 99,
              background: "var(--ink)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: -0.1,
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            Ingresar
          </Link>
        )}
      </div>

      {/* Tenant info */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {logoUrl && (
            <div
              style={{
                position: "relative",
                width: 40,
                height: 40,
                borderRadius: 999,
                overflow: "hidden",
                flexShrink: 0,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                border: "1px solid var(--hairline)",
              }}
            >
              <Image
                src={logoUrl}
                alt={businessName}
                fill
                sizes="40px"
                style={{ objectFit: "cover" }}
              />
            </div>
          )}
          <div
            className="d-display"
            style={{
              fontSize: 32,
              lineHeight: 1.05,
              color: "var(--ink)",
            }}
          >
            {businessName}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
            flexWrap: "wrap",
          }}
        >
          {tagline && (
            <>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{tagline}</span>
              <span style={{ color: "var(--hairline-2)" }}>·</span>
            </>
          )}
          <StatusDot status={isOpen ? "open" : "closed"} />
          <span style={{ color: "var(--hairline-2)" }}>·</span>
          <Link
            href={`/${slug}/reservar`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--primary)",
              textDecoration: "none",
              letterSpacing: -0.1,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            Reservar mesa
            {I.chevRight("var(--primary)", 12)}
          </Link>
        </div>
        {hasDelivery && (
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 12,
              fontSize: 12,
              color: "var(--ink-2)",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {I.clock("var(--ink-3)", 13)} {eta}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {I.moto("var(--ink-3)", 14)}{" "}
              {fee > 0 ? `Envío ${formatCurrency(fee)}` : "Envío bonificado"}
            </span>
            {min > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                Mín. {formatCurrency(min)}
              </span>
            )}
          </div>
        )}
      </div>

      {!isOpen && (
        <div
          style={{
            margin: "12px 16px",
            padding: "12px 14px",
            borderRadius: 10,
            background: "#F6EEE4",
            border: "1px solid #EADFCB",
            fontSize: 13,
            color: "#6D5838",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            El local está cerrado
          </div>
          <div>Podés ver el menú pero todavía no se aceptan pedidos.</div>
        </div>
      )}

      {/* Menú del día — sección destacada arriba del catálogo */}
      <DailyMenuSection
        menus={todaysMenus}
        todayLabel={todayLabel}
        disabled={!isOpen}
        onSelect={handleSelectDailyMenu}
      />

      {/* Sticky category tabs */}
      {displayTabs.length > 0 && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 4,
            background: "var(--bg)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <div
            ref={tabsRef}
            style={{
              display: "flex",
              gap: 20,
              overflowX: "auto",
              // Fija el scroll y el gesto táctil al eje horizontal: sin esto, al
              // deslizar las categorías el gesto se filtra a scroll vertical y la
              // barra "salta" para arriba y abajo.
              overflowY: "hidden",
              touchAction: "pan-x",
              padding: "4px 16px 0",
              scrollbarWidth: "none",
            }}
            className="no-scrollbar"
          >
            {displayTabs.map((t) => {
              const isActive = t.id === active;
              return (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  style={{
                    flexShrink: 0,
                    padding: "12px 0 10px",
                    background: "none",
                    border: "none",
                    borderBottom: isActive
                      ? "2px solid var(--ink)"
                      : "2px solid transparent",
                    color: isActive ? "var(--ink)" : "var(--ink-3)",
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                    marginBottom: -1,
                  }}
                >
                  {t.name}
                </button>
              );
            })}
          </div>

          {/* Pistas de "hay más categorías" — decorativas, no roban el tap. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: 40,
              display: "flex",
              alignItems: "center",
              paddingLeft: 2,
              background:
                "linear-gradient(to right, var(--bg) 45%, transparent)",
              opacity: tabsOverflow.left ? 1 : 0,
              transition: "opacity 160ms ease",
              pointerEvents: "none",
            }}
          >
            {I.chevLeft("var(--ink-3)", 15)}
          </div>
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 0,
              width: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingRight: 2,
              background: "linear-gradient(to left, var(--bg) 45%, transparent)",
              opacity: tabsOverflow.right ? 1 : 0,
              transition: "opacity 160ms ease",
              pointerEvents: "none",
            }}
          >
            {I.chevRight("var(--ink-3)", 15)}
          </div>
        </div>
      )}

      {/* Products */}
      <div>
        {activeTab?.subcategories
          ? activeTab.subcategories.map((sub) => (
              <div key={sub.name}>
                <div
                  style={{
                    padding: "14px 16px 6px",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink-2)",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {sub.name}
                </div>
                {sub.products.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    cartQty={cartByProduct.get(p.id) ?? 0}
                    disabled={!isOpen}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            ))
          : activeTab?.products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                cartQty={cartByProduct.get(p.id) ?? 0}
                disabled={!isOpen}
                onSelect={handleSelect}
              />
            ))}
        {activeTab?.products.length === 0 && (
          <div
            style={{
              padding: "40px 16px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 14,
            }}
          >
            Sin productos en esta categoría.
          </div>
        )}
      </div>

      {/* Sticky cart pill */}
      {count > 0 && (
        <div
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 20,
            zIndex: 20,
            maxWidth: 496,
            margin: "0 auto",
          }}
        >
          <Link
            href={`/${slug}/carrito`}
            style={{
              width: "100%",
              height: 56,
              borderRadius: 14,
              background: "var(--accent)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 18px 0 14px",
              textDecoration: "none",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {count}
              </span>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.1 }}>
                Ver mi pedido
              </span>
            </span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {formatCurrency(total)}
            </span>
          </Link>
        </div>
      )}

      <ProductSheet
        slug={slug}
        product={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

      <DailyMenuSheet
        slug={slug}
        menu={selectedDailyMenu}
        open={dailyMenuSheetOpen}
        onOpenChange={setDailyMenuSheetOpen}
        disabled={!isOpen}
      />
    </div>
  );
}
