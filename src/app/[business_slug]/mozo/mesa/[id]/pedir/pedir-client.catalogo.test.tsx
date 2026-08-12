import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MozoPedirClient } from "./pedir-client";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * Qué se ve en el panel del salón **sin** buscar (spec 111, fase 5).
 *
 * La fase 5 sacó el selector de categoría y dejó «Más pedidos» como vista de
 * entrada. Con el catálogo real eso escondía la carta: golf-jcr tiene 482
 * productos visibles y **3** con historial de 30 días, así que el panel abría
 * con tres ítems y las bebidas sólo existían si sabías qué tipear.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/comandas/actions", () => ({
  enviarComanda: vi.fn(),
  marcarComandaEntregada: vi.fn(),
  cancelarItem: vi.fn(),
  advanceItemKitchenStatus: vi.fn(),
}));
vi.mock("@/lib/mozo/datos-mesa", () => ({ guardarDatosMesa: vi.fn() }));

const producto = (id: string, name: string, show_online = true) => ({
  id,
  category_id: null,
  name,
  description: null,
  price_cents: 100000,
  image_url: null,
  sort_order: 0,
  show_online,
  modifier_groups: [],
});

const catalog: CatalogForMozo = {
  superCategories: [],
  categories: [
    {
      id: "c1",
      name: "Parrilla",
      slug: "parrilla",
      sort_order: 1,
      super_category_id: null,
      products: [producto("p1", "Asado de Tira"), producto("p2", "Entraña")],
    },
    {
      id: "c2",
      name: "Gaseosas",
      slug: "gaseosas",
      sort_order: 2,
      super_category_id: null,
      // Como en golf-jcr: casi todas las bebidas están fuera de la carta online.
      products: [
        producto("p3", "Coca-Cola 500ml", false),
        producto("p4", "Sprite 500ml", false),
      ],
    },
  ],
};

function renderPanel(topProductIds: string[] = []) {
  return render(
    <MozoPedirClient
      slug="golf"
      businessName="Golf"
      table={{
        id: "t1",
        label: "5",
        operational_status: "ocupada",
        opened_at: "2026-08-12T20:00:00Z",
      }}
      catalog={catalog}
      stationNameById={{}}
      existingComandas={[]}
      topProductIds={topProductIds}
      dailyMenus={[]}
      role="encargado"
      embedded
    />,
  );
}

describe("panel del salón · qué se ve sin buscar (spec 111)", () => {
  it("muestra el catálogo entero, no sólo los más pedidos", () => {
    // Un solo producto con historial: el resto de la carta tiene que estar.
    renderPanel(["p1"]);

    expect(screen.getByText("Asado de Tira")).toBeInTheDocument();
    expect(screen.getByText("Entraña")).toBeInTheDocument();
    // Las bebidas, que es lo que se había perdido.
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
    expect(screen.getByText("Sprite 500ml")).toBeInTheDocument();
    expect(screen.getByText("Gaseosas")).toBeInTheDocument();
  });

  it("un producto no se repite: si está en «Más pedidos» no vuelve en su categoría", () => {
    // El índice de teclado es un Map por id; repetirlo corre el foco.
    renderPanel(["p1"]);
    expect(screen.getAllByText("Asado de Tira")).toHaveLength(1);
  });

  it("sin historial de ventas también se ve la carta entera", () => {
    renderPanel([]);
    expect(screen.getByText("Asado de Tira")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
  });

  it("no hay selector de categoría: se busca o se scrollea", () => {
    renderPanel(["p1"]);
    expect(screen.queryByLabelText("Categoría")).toBeNull();
    expect(screen.getByLabelText("Buscar producto")).toBeInTheDocument();
  });

  it("el filtro de la carta online es un desplegable y puede dejar sólo lo del local", async () => {
    const user = userEvent.setup();
    renderPanel(["p1"]);

    await user.click(
      screen.getByRole("button", { name: "Filtrar por carta online" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Solo para el local/ }),
    );

    // Las bebidas de golf-jcr son justamente las que NO van a la carta online.
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
    expect(screen.queryByText("Asado de Tira")).toBeNull();
  });
});
