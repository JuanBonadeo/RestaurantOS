import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MozoPedirClient } from "./pedir-client";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * La pastilla del mozo en el header de la mesa (spec 146 · D-A3).
 *
 * El pedido de la encargada de Golf: *"entrar en la mesa, elegir el mozo y ya
 * empezar a comandar"*. Hasta acá el panel de carga ni siquiera decía de quién
 * era la mesa.
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
          price_cents: 100000,
          image_url: null,
          sort_order: 0,
          show_online: true,
          modifier_groups: [],
        },
      ],
    },
  ],
};

function renderPanel(
  mozo: { mozoId?: string | null; mozoName?: string | null } = {},
  onElegirMozo?: () => void,
) {
  return render(
    <MozoPedirClient
      slug="golf"
      businessName="Golf"
      table={{
        id: "t1",
        label: "5",
        operational_status: "libre",
        opened_at: null,
      }}
      catalog={catalog}
      stationNameById={{}}
      existingComandas={[]}
      topProductIds={["p1"]}
      dailyMenus={[]}
      role="encargado"
      mozoId={mozo.mozoId ?? null}
      mozoName={mozo.mozoName ?? null}
      onElegirMozo={onElegirMozo}
      embedded
    />,
  );
}

const pastilla = (nombre: RegExp) =>
  screen.getByRole("button", { name: nombre });

describe("panel del salón · el mozo de la mesa (spec 146)", () => {
  it("una mesa sin mozo lo dice, y se elige desde ahí", async () => {
    const user = userEvent.setup();
    const onElegirMozo = vi.fn();
    renderPanel({}, onElegirMozo);

    await user.click(pastilla(/sin mozo/i));
    expect(onElegirMozo).toHaveBeenCalled();
  });

  it("con mozo muestra el nombre, y sigue siendo la puerta para cambiarlo", async () => {
    const user = userEvent.setup();
    const onElegirMozo = vi.fn();
    renderPanel({ mozoId: "u1", mozoName: "Pedro" }, onElegirMozo);

    await user.click(pastilla(/pedro/i));
    expect(onElegirMozo).toHaveBeenCalled();
  });

  it("sin permiso para asignar no hay botón: el nombre se lee y nada más", () => {
    renderPanel({ mozoId: "u1", mozoName: "Pedro" });
    expect(screen.getByText("Pedro")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pedro/i })).toBeNull();
  });

  it("sin permiso y sin mozo no se ofrece nada", () => {
    renderPanel();
    expect(screen.queryByText(/sin mozo/i)).toBeNull();
  });
});
