import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MozoPedirClient } from "./pedir-client";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * «La mesa» no se esconde nunca — spec 146 · C.
 *
 * Las dos columnas del panel entraban recién con 672px de panel, y el panel
 * mide 620–668 en las notebooks del salón: la mitad izquierda —lo enviado, lo
 * que falta mandar, el total y «Cobrar»— estaba escondida detrás de una
 * pastilla **siempre**. Ahora se ve al lado o apilada abajo, pero se ve.
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

function renderPanel() {
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
      dailyMenus={[]}
      role="encargado"
      embedded
    />,
  );
}

describe("panel del salón · las dos partes siempre a la vista (spec 146 · C)", () => {
  it("no hay ninguna pastilla que abra la mesa: ya está abierta", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /^la mesa/i })).toBeNull();
  });

  it("la columna de la mesa no está escondida", () => {
    renderPanel();
    const mesa = screen.getByRole("region", { name: /^Mesa 5$/ });
    // Nada de lo que la contiene la oculta (era `hidden @2xl:flex`).
    expect(mesa.closest(".hidden")).toBeNull();
  });
});
