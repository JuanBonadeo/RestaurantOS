import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MozoPedirClient } from "./pedir-client";
import { enviarComanda } from "@/lib/comandas/actions";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * Ctrl/⌘+Enter = enviar la comanda (spec 075, FR-016).
 *
 * El atajo está publicado en la ayuda de atajos del salón y no andaba, por dos
 * motivos distintos:
 *
 * 1. **El foco.** Escuchaba con un `onKeyDown` de React sobre el div del
 *    panel, así que sólo funcionaba si el foco estaba adentro. En el salón el
 *    foco se va todo el tiempo —un click al plano, un click al aire— y ahí el
 *    atajo quedaba muerto, sin ninguna señal de por qué.
 * 2. **El buscador.** Su handler de `Enter` no miraba los modificadores:
 *    Ctrl+Enter mientras tipeabas agregaba el primer resultado ANTES de
 *    enviar. Te ibas a cocina con un producto que nadie pidió.
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

/** Una línea ya cargada, con la forma real de `CartProductItem`. */
const borrador = [
  {
    _key: "k-1",
    product_id: "p1",
    product_name: "Provoleta",
    unit_price_cents: 100000,
    quantity: 1,
    notes: "",
    modifiers: [],
    line_subtotal_cents: 100000,
    seat_number: null,
  },
];

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } satisfies Storage;
}

function Panel({ mozoPickerAbierto = false }: { mozoPickerAbierto?: boolean }) {
  return (
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
      topProductIds={["p1"]}
      dailyMenus={[]}
      role="encargado"
      mozoPickerAbierto={mozoPickerAbierto}
      embedded
    />
  );
}

/** Panel montado con una línea ya cargada, lista para enviar. */
async function panelConCarrito(props: { mozoPickerAbierto?: boolean } = {}) {
  localStorage.setItem("mozo-cart:golf:t1", JSON.stringify(borrador));
  await act(async () => {
    render(<Panel {...props} />);
  });
  await screen.findByRole("button", { name: /Enviar/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", fakeStorage());
  vi.mocked(enviarComanda).mockResolvedValue({
    ok: true,
    data: { comanda_ids: ["cmd-1"] },
  } as never);
});

describe("panel de carga · Ctrl+Enter envía la comanda", () => {
  it("anda con el foco fuera del panel (que es donde queda tras un click al plano)", async () => {
    await panelConCarrito();

    // Nadie enfocó nada adentro del panel: la tecla llega al documento.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    });

    expect(enviarComanda).toHaveBeenCalledTimes(1);
  });

  it("NO envía con el selector de mozo abierto encima", async () => {
    // El selector se abre solo sobre la mesa libre sin mozo (spec 146,
    // fast-follow) y se lleva el foco. Con el foco perdido, ⌘Enter es la única
    // tecla que sigue llegando —escucha en `document`—, así que sin la guarda
    // un atajo de inercia mandaba la comanda con el modal en pantalla.
    await panelConCarrito({ mozoPickerAbierto: true });

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    });

    expect(enviarComanda).not.toHaveBeenCalled();
  });

  it("desde el buscador envía y NO agrega el primer resultado", async () => {
    const user = userEvent.setup();
    await panelConCarrito();

    await user.type(screen.getByLabelText("Buscar producto"), "Asado");
    await act(async () => {
      await user.keyboard("{Control>}{Enter}{/Control}");
    });

    expect(enviarComanda).toHaveBeenCalledTimes(1);
    // Lo que salió es lo que estaba cargado, no lo que se estaba buscando.
    const items = vi.mocked(enviarComanda).mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product_id: "p1", quantity: 1 });
    // Y el producto buscado ni siquiera abrió su modal.
    expect(screen.queryByRole("heading", { name: "Asado de Tira" })).toBeNull();
  });

  it("con un envío en vuelo, repetir el atajo no manda dos veces", async () => {
    let resolver: (v: unknown) => void = () => {};
    vi.mocked(enviarComanda).mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }) as never,
    );
    await panelConCarrito();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    });

    expect(enviarComanda).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolver({ ok: true, data: { comanda_ids: ["cmd-1"] } });
    });
  });
});
