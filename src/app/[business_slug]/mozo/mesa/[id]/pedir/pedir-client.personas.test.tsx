import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MozoPedirClient } from "./pedir-client";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";
import type { LoPedido } from "@/lib/mozo/lo-pedido";

/**
 * «Personas» se resuelve por mesa, no por panel (spec 146, fast-follow 2).
 *
 * El panel no se desmonta al saltar de mesa en mesa (keep-alive, specs
 * 101/114), y el número se seedeaba una sola vez para toda su vida: la mesa de
 * 4 abría la de al lado en 4, y una mesa con orden de 5 se quedaba con el
 * número de la anterior. Se veía poco mientras era un chip en el header;
 * con el modal de comensales mostrándolo grande, se ve siempre.
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
      name: "Parrilla",
      slug: "parrilla",
      sort_order: 1,
      super_category_id: null,
      products: [
        {
          id: "p1",
          category_id: "c1",
          name: "Asado de Tira",
          description: null,
          price_cents: 3900000,
          image_url: null,
          sort_order: 0,
          show_online: true,
          modifier_groups: [],
        },
      ],
    },
  ],
};

const orden = (partySize: number): LoPedido =>
  ({
    id: "o1",
    daily_number: 7,
    party_size: partySize,
    items: [],
  }) as unknown as LoPedido;

function panel(
  tableId: string,
  label: string,
  loPedido: LoPedido | null,
  estado = "ocupada",
  extra: { aperturaDeMesa?: boolean } = {},
) {
  return (
    <MozoPedirClient
      slug="golf"
      businessName="Golf"
      table={{
        id: tableId,
        label,
        operational_status: estado,
        opened_at: estado === "libre" ? null : "2026-09-03T14:00:00Z",
      }}
      catalog={catalog}
      stationNameById={{}}
      existingComandas={[]}
      loPedido={loPedido}
      topProductIds={["p1"]}
      dailyMenus={[]}
      role="encargado"
      aperturaDeMesa={extra.aperturaDeMesa ?? false}
      embedded
    />
  );
}

const elegido = () =>
  screen
    .getAllByRole("button")
    .filter(
      (b) =>
        /^\d+ personas$/.test(b.getAttribute("aria-label") ?? "") &&
        b.getAttribute("aria-pressed") === "true",
    )
    .map((b) => b.textContent)[0];

describe("personas · una mesa, un número (spec 146)", () => {
  it("la mesa con orden abre en SU cantidad, aunque llegue tarde", async () => {
    const { rerender } = render(panel("t1", "5", null));
    // Todavía sin datos de la mesa: el default.
    expect(elegido()).toBe("2");

    rerender(panel("t1", "5", orden(5)));
    await waitFor(() => expect(elegido()).toBe("5"));
  });

  it("cambiar de mesa no arrastra el número de la anterior", async () => {
    const { rerender } = render(panel("t1", "5", orden(5)));
    await waitFor(() => expect(elegido()).toBe("5"));

    // La de al lado, libre y sin orden: vuelve al default, no hereda el 5.
    rerender(panel("t2", "6", null, "libre"));
    await waitFor(() => expect(elegido()).toBe("2"));

    // Y una tercera con orden propia toma la suya.
    rerender(panel("t3", "7", orden(4)));
    await waitFor(() => expect(elegido()).toBe("4"));
  });
});

describe("comensales · el modal es de una mesa (spec 146)", () => {
  it("tocar otra mesa mientras pregunta cierra la pregunta vieja", async () => {
    const { rerender } = render(
      panel("t1", "5", null, "libre", { aperturaDeMesa: true }),
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Mesa 5/i })).toBeInTheDocument(),
    );

    // La encargada toca otra mesa en el plano: el panel se re-apunta sin
    // desmontarse (keep-alive). La pregunta de la mesa 5 no puede quedar viva
    // contestando por la 6.
    rerender(panel("t2", "6", null, "libre", { aperturaDeMesa: true }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /Mesa 6/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog", { name: /Mesa 5/i })).toBeNull();
  });

  it("la mesa ocupada no pregunta nada", () => {
    render(panel("t9", "9", orden(3), "ocupada", { aperturaDeMesa: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
