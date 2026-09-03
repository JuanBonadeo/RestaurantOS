import { render, screen, waitFor } from "@testing-library/react";
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
  mozo: {
    mozoId?: string | null;
    mozoName?: string | null;
    mozoPickerAbierto?: boolean;
  } = {},
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
      mozoPickerAbierto={mozo.mozoPickerAbierto ?? false}
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

  it("con el selector abierto, el panel no le pelea el foco al montar", () => {
    // El panel no siempre monta en el mismo commit en que se abre la mesa: con
    // el catálogo frío monta DESPUÉS del modal. Sin la guarda, su autofoco de
    // montaje se llevaba el foco y lo tipeado en el modal terminaba en el
    // buscador de productos, tapado por el overlay.
    renderPanel({ mozoPickerAbierto: true }, () => {});
    expect(document.activeElement).not.toBe(
      screen.getByLabelText("Buscar producto"),
    );
  });

  it("al cerrarse el selector, el foco vuelve al buscador", async () => {
    // El modal se abre solo sobre la mesa libre sin mozo y se lleva el foco.
    // Al cerrarse, el panel tiene que quedar listo para tipear: si el foco se
    // queda en el `body`, la cadena de teclado del panel muere y hay que ir al
    // mouse — justo lo que la mesa-libre-directo-a-cargar vino a sacar.
    const { rerender } = renderPanel({ mozoPickerAbierto: true }, () => {});
    const buscador = screen.getByLabelText("Buscar producto");
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).not.toBe(buscador);

    rerender(
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
        mozoId="u1"
        mozoName="Pedro"
        mozoPickerAbierto={false}
        onElegirMozo={() => {}}
        embedded
      />,
    );

    await waitFor(() => expect(document.activeElement).toBe(buscador));
  });

  it("sin permiso y sin mozo no se ofrece nada", () => {
    renderPanel();
    expect(screen.queryByText(/sin mozo/i)).toBeNull();
  });
});
