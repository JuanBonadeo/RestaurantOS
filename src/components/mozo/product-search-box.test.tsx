import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProductSearchInput, useProductSearch } from "./product-search-box";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";
import { useRovingList } from "@/lib/ui/use-roving-list";

/**
 * El buscador compartido por los tres flujos de carga (specs 066/068/073/075).
 *
 * Cubre dos cosas: que **sin escribir nada** la lista visible sea la de la
 * categoría activa y la filtre el filtro de la carta online (spec 073), y que
 * `↓` baje el **foco** a esa lista en vez de mover un resaltado virtual
 * (spec 075) — con `↑` en el primero volviendo al buscador sin perder el texto.
 */

function product(
  id: string,
  name: string,
  show_online = true,
): CatalogProduct {
  return {
    id,
    name,
    description: null,
    price_cents: 100000,
    image_url: null,
    category_id: "c1",
    station_id: null,
    show_online,
    modifier_groups: [],
  } as unknown as CatalogProduct;
}

const MILANESA = product("p1", "Milanesa");
const NAPOLITANA = product("p2", "Napolitana");
const EMPANADA = product("p3", "Empanada", false);
const ALL = [MILANESA, NAPOLITANA, EMPANADA];

let seq = 0;

function Harness({
  browse = ALL,
  onPick = () => {},
}: {
  browse?: CatalogProduct[];
  onPick?: (p: CatalogProduct) => void;
}) {
  // Una clave por montaje (no por render): el filtro de la carta online es
  // sticky en localStorage y si la clave cambiara se resetearía sola.
  const [storageKey] = useState(() => `test_${seq++}`);
  const searchRef = useRef<HTMLInputElement>(null);
  const api = useProductSearch({
    products: ALL,
    browse,
    storageKey,
    onPick,
    onEnterResults: () => zona.focusFirst(),
  });
  const zona = useRovingList<HTMLButtonElement>({
    length: api.results.length,
    onExitUp: () => searchRef.current?.focus(),
  });
  return (
    <div>
      <ProductSearchInput api={api} inputRef={searchRef} />
      <ul onKeyDown={zona.handleKeyDown}>
        {api.results.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              data-enter-target={p.id === api.enterTargetId}
              {...zona.itemProps(i)}
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const input = () => screen.getByLabelText("Buscar producto");
const rows = () =>
  screen.getAllByRole("listitem").map((li) => li.textContent);
const enterTarget = () =>
  screen
    .getAllByRole("button")
    .find((b) => b.dataset.enterTarget === "true")?.textContent;

describe("buscador de productos", () => {
  it("sin escribir nada, la lista visible es la de la categoría activa", () => {
    render(<Harness browse={[MILANESA, NAPOLITANA]} />);
    expect(rows()).toEqual(["Milanesa", "Napolitana"]);
  });

  it("marca el primero como el que abre Enter", () => {
    render(<Harness />);
    expect(enterTarget()).toBe("Milanesa");
  });

  it("↓ baja el foco a la lista y sigue bajando de a uno", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    input().focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Milanesa" })).toHaveFocus();
    });

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Napolitana" })).toHaveFocus();
  });

  it("↑ en el primer resultado vuelve al buscador sin perder lo tipeado", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    input().focus();
    await user.keyboard("mila");
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Milanesa" })).toHaveFocus();
    });

    await user.keyboard("{ArrowUp}");
    expect(input()).toHaveFocus();
    expect(input()).toHaveValue("mila");
  });

  it("Enter en el buscador agrega el primero de la lista", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);

    input().focus();
    await user.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(MILANESA);
  });

  it("el filtro de la carta online también filtra sin búsqueda", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(rows()).toContain("Empanada");

    await user.click(screen.getByRole("button", { name: "En la carta online" }));
    expect(rows()).toEqual(["Milanesa", "Napolitana"]);

    await user.click(screen.getByRole("button", { name: "Solo para el local" }));
    expect(rows()).toEqual(["Empanada"]);
  });

  it("escribiendo, busca sobre el catálogo entero y no sobre la categoría", async () => {
    const user = userEvent.setup();
    render(<Harness browse={[MILANESA]} />);

    await user.type(input(), "empan");
    expect(rows()).toEqual(["Empanada"]);
  });
});
