import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";

import { MozoPedirClient } from "./pedir-client";
import { enviarComanda } from "@/lib/comandas/actions";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * Spec 116 — el borrador del pedido en armado (localStorage, spec 055/#81).
 *
 * El borrador existe para que salir de la carga y volver no te haga recargar
 * todo de nuevo. Pero se guarda desde un efecto sobre `cart`, y hay dos momentos
 * en los que ese efecto no llega a correr:
 *
 * 1. **Al enviar desde el panel del salón.** `handleSend` vacía el carrito y
 *    en el mismo commit llama a `onSent`, que cierra la carga y desmonta el
 *    panel. El efecto nunca ve el carrito vacío → el borrador queda con lo que
 *    **ya se mandó a cocina**, y la próxima vez que abrís la mesa aparece otra
 *    vez ahí, listo para volver a mandarlo.
 * 2. **Al cambiar de mesa con el panel montado.** Desde el keep-alive (spec
 *    101/114) el panel no se desmonta entre mesas: la hidratación sólo pisa el
 *    carrito si la mesa nueva tiene borrador, así que sin borrador se queda el
 *    de la mesa anterior — cargado sobre la mesa equivocada.
 *
 * Los dos terminan en comida de más en la cocina, que es de lo que no se vuelve.
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

/** Una línea de borrador con la forma real de `CartProductItem`. */
const borrador = (nombre: string) => [
  {
    _key: `k-${nombre}`,
    product_id: "p1",
    product_name: nombre,
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

function Panel({ tableId, onSent }: { tableId: string; onSent?: () => void }) {
  return (
    <MozoPedirClient
      slug="golf"
      businessName="Golf"
      table={{
        id: tableId,
        label: tableId === "t1" ? "5" : "6",
        operational_status: "ocupada",
        opened_at: "2026-08-12T20:00:00Z",
      }}
      catalog={catalog}
      stationNameById={{}}
      existingComandas={[]}
      topProductIds={["p1"]}
      dailyMenus={[]}
      role="encargado"
      embedded
      onSent={onSent}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", fakeStorage());
});

describe("panel del salón · el borrador no sobrevive al envío (spec 116)", () => {
  it("al enviar, el borrador se borra aunque el panel se cierre en el mismo commit", async () => {
    const user = userEvent.setup();
    vi.mocked(enviarComanda).mockResolvedValue({
      ok: true,
      data: { comanda_ids: ["cmd-1"] },
    } as never);

    localStorage.setItem(
      "mozo-cart:golf:t1",
      JSON.stringify(borrador("Asado de Tira")),
    );

    // El salón cierra la carga en `onSent` → el panel se desmonta.
    function Salon() {
      const [abierto, setAbierto] = useState(true);
      return abierto ? (
        <Panel tableId="t1" onSent={() => setAbierto(false)} />
      ) : null;
    }
    await act(async () => {
      render(<Salon />);
    });

    // El borrador se hidrató: hay algo para enviar.
    const enviar = await screen.findByRole("button", { name: /Enviar/ });
    await act(async () => {
      await user.click(enviar);
    });

    expect(enviarComanda).toHaveBeenCalledTimes(1);
    // Lo que se mandó a cocina no puede quedar guardado como pendiente.
    expect(localStorage.getItem("mozo-cart:golf:t1")).toBeNull();
  });

  it("cambiar de mesa con el panel montado no arrastra el carrito", async () => {
    localStorage.setItem(
      "mozo-cart:golf:t1",
      JSON.stringify(borrador("Asado de Tira")),
    );

    const { rerender } = render(<Panel tableId="t1" />);
    expect(await screen.findByRole("button", { name: /Enviar/ })).toBeTruthy();

    // Misma instancia, otra mesa: la 6 no tiene borrador, así que no puede
    // quedar nada para enviar.
    await act(async () => {
      rerender(<Panel tableId="t2" />);
    });

    expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull();
  });
});
