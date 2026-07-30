import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProductSearchInput, useProductSearch } from "./product-search-box";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";

/**
 * El buscador compartido por los tres flujos de carga (specs 066/068/073).
 *
 * Lo que se cubre acá es la spec 073: **sin escribir nada**, la lista visible
 * es la de la categoría activa (`browse`), ya tiene índice de teclado y el
 * filtro de la carta online la filtra. Antes ↓/↑ sólo funcionaban con una
 * búsqueda activa y los chips del filtro se mostraban sin hacer nada.
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
  const api = useProductSearch({
    products: ALL,
    browse,
    storageKey,
    onPick,
  });
  return (
    <div>
      <ProductSearchInput api={api} />
      <ul>
        {api.results.map((p) => (
          <li key={p.id} data-selected={p.id === api.selectedProductId}>
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

const input = () => screen.getByLabelText("Buscar producto");
const rows = () => screen.getAllByRole("listitem").map((li) => li.textContent);
const selected = () =>
  screen.getAllByRole("listitem").find((li) => li.dataset.selected === "true")
    ?.textContent;

describe("buscador de productos · catálogo sin buscar (spec 073)", () => {
  it("sin escribir nada, la lista visible es la de la categoría activa", () => {
    render(<Harness browse={[MILANESA, NAPOLITANA]} />);
    expect(rows()).toEqual(["Milanesa", "Napolitana"]);
  });

  it("el índice arranca en el primero aunque no haya búsqueda", () => {
    render(<Harness />);
    expect(selected()).toBe("Milanesa");
  });

  it("↓/↑ mueven sobre el catálogo, sin haber tipeado nada", () => {
    render(<Harness />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()).toBe("Napolitana");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selected()).toBe("Milanesa");
    // Clamp: no se pasa del primero.
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selected()).toBe("Milanesa");
  });

  it("Enter agrega el seleccionado sin búsqueda activa", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(NAPOLITANA);
  });

  it("al cambiar de categoría la selección vuelve al primero", () => {
    const { rerender } = render(<Harness browse={[MILANESA, NAPOLITANA]} />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selected()).toBe("Napolitana");
    rerender(<Harness browse={[EMPANADA, MILANESA]} />);
    expect(selected()).toBe("Empanada");
  });

  it("el filtro de la carta online también filtra sin búsqueda", () => {
    render(<Harness />);
    expect(rows()).toContain("Empanada");
    fireEvent.click(screen.getByRole("button", { name: "En la carta online" }));
    expect(rows()).toEqual(["Milanesa", "Napolitana"]);
    fireEvent.click(screen.getByRole("button", { name: "Solo para el local" }));
    expect(rows()).toEqual(["Empanada"]);
  });

  it("escribiendo, busca sobre el catálogo entero y no sobre la categoría", () => {
    render(<Harness browse={[MILANESA]} />);
    fireEvent.change(input(), { target: { value: "empan" } });
    expect(rows()).toEqual(["Empanada"]);
  });
});
