"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { computeIsOpen, type BusinessHour } from "@/lib/business-hours";
import { formatCurrency } from "@/lib/currency";
import { disponibilidadTexto, pasosDelMenu } from "@/lib/daily-menus/carta-resumen";
import type { MenuCategory, MenuDailyMenu, MenuProduct } from "@/lib/menu";

// Carta SOLO VISUAL (read-only) para el QR de la mesa. El comensal mira y le
// pide al mozo: sin carrito, sin "+", sin checkout. Estética «Restaurant del
// Golf» (spec 44): cover de lino + golfista + título de sección en script
// dorado + líder de puntos dorado plato···precio, en scroll único, sin fotos.
// Reusa el mismo catálogo (getMenu) que /menu.

// Cover art de la carta. Hoy es la identidad de golf-house (único cliente de
// carta pre-go-live), con sus assets reales en public/carta/golf/. Parametrizar
// el arte por business (settings/storage) es el fast-follow de spec 44.
const COVER = {
  linen: "/carta/golf/linen.png",
  figure: "/carta/golf/golfista.svg",
  wordmark: "/carta/golf/wordmark-blanco.svg",
  ornament: "/carta/golf/ornamento.svg",
};

type DisplayTab = {
  id: string;
  name: string;
  products: MenuProduct[];
  subcategories?: { name: string; products: MenuProduct[] }[];
};

function buildDisplayTabs(
  categories: MenuCategory[],
  beverageSuperCategoryId: string | null,
): DisplayTab[] {
  const flat = (cs: MenuCategory[]) =>
    cs.map((c) => ({ id: c.id, name: c.name, products: c.products }));

  if (!beverageSuperCategoryId) return flat(categories);

  const bevCats = categories.filter(
    (c) => c.super_category_id === beverageSuperCategoryId,
  );
  const nonBevCats = categories.filter(
    (c) => c.super_category_id !== beverageSuperCategoryId,
  );
  if (bevCats.length === 0) return flat(categories);

  const tabs: DisplayTab[] = flat(nonBevCats);
  tabs.push({
    id: "bebidas-grouped",
    name: "Bebidas",
    products: bevCats.flatMap((c) => c.products),
    subcategories: bevCats.map((c) => ({ name: c.name, products: c.products })),
  });
  return tabs;
}

// Flourish dorado reutilizable (ornamento real del cliente).
function Ornament({ width = 104 }: { width?: number }) {
  return (
    <Image
      src={COVER.ornament}
      alt=""
      aria-hidden
      unoptimized
      width={width}
      height={Math.round((width * 22) / 107)}
      style={{ opacity: 0.95 }}
    />
  );
}

// Fila de plato con líder de puntos dorado: nombre ······ precio, descripción
// debajo. Sin foto (la carta impresa no las lleva).
function ProductRow({ product }: { product: MenuProduct }) {
  const soldOut = !product.is_available;
  return (
    <li style={{ listStyle: "none", padding: "11px 0", opacity: soldOut ? 0.5 : 1 }}>
      {/* Nombre ······ Precio */}
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 15.5,
            lineHeight: 1.25,
            color: "var(--carta-ink)",
            textDecoration: soldOut ? "line-through" : "none",
          }}
        >
          {product.name}
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            margin: "0 8px 5px",
            borderBottom: "1px dotted var(--carta-gold)",
            minWidth: 16,
          }}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: 15.5,
            color: "var(--carta-ink)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {formatCurrency(product.price_cents)}
        </span>
      </div>
      {product.description && (
        <div
          style={{
            fontSize: 13,
            color: "var(--carta-ink-2)",
            lineHeight: 1.4,
            marginTop: 3,
            maxWidth: "44ch",
          }}
        >
          {product.description}
        </div>
      )}
      {soldOut && (
        <span
          style={{
            display: "inline-block",
            marginTop: 6,
            fontSize: 10.5,
            padding: "2px 7px",
            borderRadius: 4,
            background: "color-mix(in srgb, var(--carta-gold) 16%, transparent)",
            color: "var(--carta-ink-2)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          No disponible
        </span>
      )}
    </li>
  );
}

// Título de sección: script dorado centrado + ornamento debajo.
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "38px 0 8px" }}>
      <h2
        className="carta-script"
        style={{ margin: 0, fontSize: 46, lineHeight: 1 }}
      >
        {children}
      </h2>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "center" }}>
        <Ornament width={104} />
      </div>
    </div>
  );
}

// El menú del día, con la misma fila que un plato (nombre ··· precio) en vez de
// la caja dorada de antes. Debajo, en lugar de la descripción, cuándo se ofrece;
// y los pasos del menú —sólo el nombre del grupo— apilados con un «+» dorado.
// Listar las opciones una por una tapaba media carta: el «Menú» de golf-jcr
// tiene 57 componentes (spec 112).
function DailyMenuCard({
  menu,
  isSuggestion,
}: {
  menu: MenuDailyMenu;
  isSuggestion?: boolean;
}) {
  const pasos = pasosDelMenu(menu);
  const disponibilidad = disponibilidadTexto(menu.available_days);

  return (
    <li style={{ listStyle: "none", padding: "11px 0" }}>
      {/* Nombre ······ Precio */}
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <span
          style={{
            fontWeight: 600,
            fontSize: 15.5,
            lineHeight: 1.25,
            color: "var(--carta-ink)",
          }}
        >
          {menu.name}
        </span>
        {isSuggestion && (
          <span
            style={{
              marginLeft: 7,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "var(--carta-gold)",
              flexShrink: 0,
            }}
          >
            Sugerencia
          </span>
        )}
        <span
          aria-hidden
          style={{
            flex: 1,
            margin: "0 8px 5px",
            borderBottom: "1px dotted var(--carta-gold)",
            minWidth: 16,
          }}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: 15.5,
            color: "var(--carta-ink)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {formatCurrency(menu.price_cents)}
        </span>
      </div>

      {disponibilidad && (
        <div
          style={{
            fontSize: 13,
            color: "var(--carta-ink-2)",
            lineHeight: 1.4,
            marginTop: 3,
          }}
        >
          {disponibilidad}
        </div>
      )}

      {pasos.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            margin: "10px 0 2px",
            padding: 0,
            textAlign: "center",
          }}
        >
          {pasos.map((paso, i) => (
            <li
              key={`${paso}-${i}`}
              style={{
                fontSize: 13.5,
                lineHeight: 1.45,
                color: "var(--carta-ink)",
              }}
            >
              {i > 0 && (
                <span
                  aria-hidden
                  style={{
                    display: "block",
                    fontSize: 11,
                    lineHeight: 1.4,
                    color: "var(--carta-gold)",
                  }}
                >
                  +
                </span>
              )}
              {paso}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function DailyMenu({ menus }: { menus: MenuDailyMenu[] }) {
  const regular = menus.filter((m) => !m.is_suggestion);
  const suggestions = menus.filter((m) => m.is_suggestion);
  if (menus.length === 0) return null;

  return (
    <section>
      <SectionTitle>Menú del día</SectionTitle>
      <ul style={{ margin: 0, padding: 0 }}>
        {regular.map((m) => (
          <DailyMenuCard key={m.id} menu={m} />
        ))}
        {suggestions.map((m) => (
          <DailyMenuCard key={m.id} menu={m} isSuggestion />
        ))}
      </ul>
    </section>
  );
}

// Cover a pantalla: lino navy + golfista dorado + wordmark + RESTAURANTE +
// ornamento + cue de scroll hacia el menú.
function Cover({ businessName }: { businessName: string }) {
  return (
    <header
      style={{
        position: "relative",
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "56px 24px",
        color: "#fff",
        backgroundColor: "var(--carta-cover)",
        backgroundImage: `linear-gradient(rgba(20,23,28,0.45), rgba(20,23,28,0.6)), url(${COVER.linen})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Golfista + wordmark superpuesto (identidad del cliente) */}
      <div style={{ position: "relative", width: 210, maxWidth: "72%", aspectRatio: "177 / 254" }}>
        <Image
          src={COVER.figure}
          alt=""
          aria-hidden
          fill
          priority
          unoptimized
          sizes="210px"
          style={{ objectFit: "contain" }}
        />
        <Image
          src={COVER.wordmark}
          alt={businessName}
          width={333}
          height={88}
          priority
          unoptimized
          style={{
            position: "absolute",
            left: "50%",
            top: "54%",
            transform: "translate(-50%, -50%)",
            width: "150%",
            maxWidth: "none",
            height: "auto",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 34,
          fontWeight: 500,
          letterSpacing: "0.3em",
          fontSize: 16,
        }}
      >
        RESTAURANTE
      </div>
      <div style={{ marginTop: 16 }}>
        <Ornament width={116} />
      </div>

      {/* Wrapper flex para centrar horizontal: la animación del óvalo usa su
          propio transform (translateY), así que el centrado NO puede depender
          de translateX o se pisan. */}
      <div
        style={{
          position: "absolute",
          bottom: 34,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <a
          href="#carta-menu"
          aria-label="Ver la carta"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 42,
            height: 62,
            borderRadius: 40,
            border: "1.5px solid rgba(255,255,255,0.7)",
            color: "#fff",
            textDecoration: "none",
            animation: "carta-bob 2.4s ease-in-out infinite",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </header>
  );
}

export function CartaClient({
  businessName,
  tagline,
  categories,
  beverageSuperCategoryId,
  todaysMenus,
  hours,
  timezone,
  isOpenInitial,
}: {
  businessName: string;
  tagline: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  categories: MenuCategory[];
  beverageSuperCategoryId: string | null;
  todaysMenus: MenuDailyMenu[];
  hours: BusinessHour[];
  timezone: string;
  isOpenInitial: boolean;
}) {
  const displayTabs = useMemo(
    () => buildDisplayTabs(categories, beverageSuperCategoryId),
    [categories, beverageSuperCategoryId],
  );
  const [isOpen, setIsOpen] = useState(isOpenInitial);
  useEffect(() => {
    const tick = () => setIsOpen(computeIsOpen(hours, timezone));
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [hours, timezone]);

  // Cada tab se apila como sección; bebidas se despliega en sus subcategorías,
  // cada una con su propio título script (Vinos Tintos, Cervezas, …).
  const sections = useMemo(() => {
    const out: { key: string; name: string; products: MenuProduct[] }[] = [];
    for (const tab of displayTabs) {
      if (tab.subcategories) {
        for (const sub of tab.subcategories) {
          out.push({ key: `${tab.id}:${sub.name}`, name: sub.name, products: sub.products });
        }
      } else {
        out.push({ key: tab.id, name: tab.name, products: tab.products });
      }
    }
    return out.filter((s) => s.products.length > 0);
  }, [displayTabs]);

  return (
    <div className="carta-theme" style={{ minHeight: "100vh" }}>
      <Cover businessName={businessName} />

      <main
        id="carta-menu"
        style={{ maxWidth: 600, margin: "0 auto", padding: "8px 26px 100px" }}
      >
        {/* Tagline + estado, discreto */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "18px 0 4px",
            fontSize: 12.5,
            color: "var(--carta-ink-2)",
          }}
        >
          {tagline && <span style={{ fontStyle: "italic" }}>{tagline}</span>}
          {tagline && <span>·</span>}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 600,
              color: isOpen ? "var(--carta-gold)" : "var(--carta-ink-2)",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: isOpen ? "var(--carta-gold)" : "var(--carta-ink-2)",
              }}
            />
            {isOpen ? "Abierto ahora" : "Cerrado"}
          </span>
        </div>

        <DailyMenu menus={todaysMenus} />

        {sections.map((s) => (
          <section key={s.key}>
            <SectionTitle>{s.name}</SectionTitle>
            <ul style={{ margin: 0, padding: 0 }}>
              {s.products.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </ul>
          </section>
        ))}

        {sections.length === 0 && (
          <div
            style={{
              padding: "64px 16px",
              textAlign: "center",
              color: "var(--carta-ink-2)",
              fontSize: 14,
              fontStyle: "italic",
            }}
          >
            Sin productos para mostrar.
          </div>
        )}
      </main>
    </div>
  );
}
