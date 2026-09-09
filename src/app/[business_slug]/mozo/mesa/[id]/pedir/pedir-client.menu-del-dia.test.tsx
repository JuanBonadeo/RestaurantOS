import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MozoPedirClient } from "./pedir-client";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";
import type {
  DailyMenuComponent,
  DailyMenuForMozo,
} from "@/lib/mozo/daily-menus-query";

/**
 * El menú del día en el panel del salón — spec 146 · B.
 *
 * Pedido de la encargada de Golf: *"la parte esta que dice hoy, el menú del
 * día, menú ejecutivo […] prefiero tener solamente el buscador"*. Lo que estos
 * tests fijan es que la tarjeta grande se fue **y** que el menú sigue
 * teniendo puerta: una fila compacta en reposo, y el buscador.
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

const catalog: CatalogForMozo = {
  superCategories: [],
  categories: [
    {
      id: "c1",
      name: "Bebidas",
      slug: "bebidas",
      sort_order: 1,
      super_category_id: null,
      products: [
        {
          id: "p1",
          category_id: "c1",
          name: "Coca-Cola 500ml",
          description: null,
          price_cents: 300000,
          image_url: null,
          sort_order: 0,
          show_online: true,
          modifier_groups: [],
        },
      ],
    },
  ],
};

const opcion = (i: number): DailyMenuComponent => ({
  id: `op${i}`,
  label: `Entrada ${i}`,
  description: null,
  kind: "choice",
  product_id: `pp${i}`,
  product_name: `Entrada ${i}`,
  choice_group_id: "g1",
  choice_group_label: "Entrada",
  extra_price_cents: 0,
  blocks_choice_group_ids: [],
  sort_order: i,
  modifier_groups: [],
  ignored_modifier_group_ids: [],
});

const MENU: DailyMenuForMozo = {
  id: "m1",
  name: "Menú Ejecutivo",
  description: "Entrada, principal y postre",
  price_cents: 3500000,
  image_url: null,
  components: [opcion(1), opcion(2)],
  choice_groups: [
    {
      choice_group_id: "g1",
      label: "Entrada",
      options: [opcion(1), opcion(2)],
      applies_when_group_id: null,
      applies_when_product_ids: [],
    },
  ],
  has_choices: true,
};

function renderPanel(embedded = true) {
  return render(
    <MozoPedirClient
      slug="golf"
      businessName="Golf"
      table={{
        id: "t1",
        label: "5",
        operational_status: "ocupada",
        opened_at: "2026-09-03T14:00:00Z",
      }}
      catalog={catalog}
      stationNameById={{}}
      existingComandas={[]}
      topProductIds={["p1"]}
      dailyMenus={[MENU]}
      role="encargado"
      embedded={embedded}
    />,
  );
}

const buscador = () => screen.getByLabelText("Buscar producto");

describe("panel del salón · el menú del día en reposo (spec 146)", () => {
  it("no encabeza el catálogo con la tarjeta grande", () => {
    renderPanel();
    expect(screen.queryByText(/hoy en el menú del día/i)).toBeNull();
    // Ni la descripción ni el contador de pasos: eso era la tarjeta.
    expect(screen.queryByText(/entrada, principal y postre/i)).toBeNull();
    expect(screen.queryByText(/paso/i)).toBeNull();
  });

  it("pero sigue estando, en una fila: es por donde se carga el ejecutivo", () => {
    renderPanel();
    expect(
      screen.getByRole("button", { name: /menú ejecutivo/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("$ 35.000")).toBeInTheDocument();
  });

  it("el cartel de «Principales más pedidos» es un rótulo, no un bloque", () => {
    renderPanel();
    expect(screen.queryByText(/lo que más sale en los últimos/i)).toBeNull();
  });

  it("en la pantalla del mozo la tarjeta queda como estaba", () => {
    renderPanel(false);
    expect(screen.getByText(/hoy en el menú del día/i)).toBeInTheDocument();
    expect(screen.getByText(/entrada, principal y postre/i)).toBeInTheDocument();
  });
});

describe("panel del salón · el menú del día se busca (spec 146 · D-B2)", () => {
  it("«ejec» lo encuentra", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(buscador(), "ejec");
    expect(
      screen.getByRole("button", { name: /menú ejecutivo/i }),
    ).toBeInTheDocument();
    // Y el producto que no matchea no está.
    expect(screen.queryByText("Coca-Cola 500ml")).toBeNull();
  });

  it("«menu» también, que es como uno lo piensa", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(buscador(), "menu");
    expect(
      screen.getByRole("button", { name: /menú ejecutivo/i }),
    ).toBeInTheDocument();
  });

  it("buscando otra cosa no aparece", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(buscador(), "coca");
    expect(screen.queryByRole("button", { name: /menú ejecutivo/i })).toBeNull();
    expect(screen.getByText("Coca-Cola 500ml")).toBeInTheDocument();
  });

  it("si lo único que matchea es el menú, no dice «sin resultados»", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(buscador(), "ejecutivo");
    expect(
      screen.getByRole("button", { name: /menú ejecutivo/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sin resultados/i)).toBeNull();
  });

  it("↓ desde el buscador cae en el menú y Enter abre el asistente", async () => {
    const user = userEvent.setup();
    renderPanel();
    buscador().focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAccessibleName(/menú ejecutivo/i);
    await user.keyboard("{Enter}");
    // Desde la spec 155 el asistente abre preguntando cuántos menús (D1); con
    // «1» el recorrido sigue siendo el de siempre.
    expect(
      screen.getByRole("radiogroup", { name: "Cuántos menús" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toHaveAccessibleName(/^1 menú$/),
    );
    await user.keyboard("1");
    expect(screen.getByRole("radiogroup", { name: "Entrada" })).toBeTruthy();
  });
});
