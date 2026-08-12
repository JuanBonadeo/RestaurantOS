import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MozoPedirClient } from "./pedir-client";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * Qué se ve en el panel del salón **sin** buscar (spec 111, fase 5).
 *
 * Sólo los más pedidos: el panel es para cargar rápido lo que sale todo el
 * tiempo, y para el resto está el buscador. Lo que estos tests fijan es que
 * esa lista **no se recorte por categoría** —las bebidas tienen que estar— y
 * que un negocio sin historial no abra en blanco.
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
  it("muestra los más pedidos y nada más", () => {
    renderPanel(["p1", "p3"]);

    expect(screen.getByText("Asado de Tira")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
    // El resto de la carta no está: para eso está el buscador.
    expect(screen.queryByText("Entraña")).toBeNull();
    expect(screen.queryByText("Sprite 500ml")).toBeNull();
  });

  it("las bebidas entran en los más pedidos como cualquier otro producto", () => {
    // Había un filtro por la supercategoría «principales» que las habría
    // dejado afuera. No existe en ningún negocio, así que nunca corrió — pero
    // el día que alguien creara esa super, el panel se quedaba sin bebidas.
    renderPanel(["p3"]);
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
  });

  it("un producto no se repite en la lista", () => {
    // El índice de teclado es un Map por id; repetirlo corre el foco.
    renderPanel(["p1", "p1"]);
    expect(screen.getAllByText("Asado de Tira")).toHaveLength(1);
  });

  it("sin historial de ventas se muestra la carta, no una pantalla en blanco", () => {
    renderPanel([]);
    expect(screen.getByText("Asado de Tira")).toBeInTheDocument();
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
  });

  it("no hay selector de categoría: se busca o se scrollea", () => {
    renderPanel(["p1"]);
    expect(screen.queryByLabelText("Categoría")).toBeNull();
    expect(screen.getByLabelText("Buscar producto")).toBeInTheDocument();
  });

  it("el modal del producto tapa la carga, no la mesa", async () => {
    const user = userEvent.setup();
    renderPanel(["p1"]);

    await user.click(screen.getByText("Asado de Tira"));

    // El modal se abre adentro de la columna de carga: mientras elegís
    // modificadores se sigue viendo qué pidió la mesa y cuánto va.
    const titulo = screen.getByRole("heading", { name: "Asado de Tira" });
    const overlay = titulo.closest("div.absolute.inset-0");
    expect(overlay).not.toBeNull();

    const mesa = screen.getByRole("region", { name: /^Mesa 5$/ });
    expect(overlay!.contains(mesa)).toBe(false);
    expect(
      overlay!.parentElement!.contains(
        screen.getByLabelText("Buscar producto"),
      ),
    ).toBe(true);
  });

  it("el filtro de la carta online es un desplegable y puede dejar sólo lo del local", async () => {
    const user = userEvent.setup();
    renderPanel(["p1", "p3"]);

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
