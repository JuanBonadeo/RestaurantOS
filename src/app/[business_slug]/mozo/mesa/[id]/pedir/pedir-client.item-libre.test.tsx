import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MozoPedirClient } from "./pedir-client";
import { enviarComanda } from "@/lib/comandas/actions";
import type { BusinessRole } from "@/lib/admin/context";
import type { CatalogForMozo } from "@/lib/mozo/catalog-query";

/**
 * Spec 174 — el «no existe» desde la mesa.
 *
 * Lo que fijan estos tests es el contrato de la feature en la pantalla donde
 * se usa: que la fila aparezca **cuando lo tipeado no encuentra nada** (que es
 * el momento en que hace falta), que no aparezca para el mozo, y que la línea
 * llegue al server con la forma del schema `free` — sin `product_id`.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/comandas/actions", () => ({
  enviarComanda: vi.fn().mockResolvedValue({
    ok: true,
    data: { order_id: "o1", comanda_ids: [] },
  }),
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

function renderPanel(role: BusinessRole = "encargado") {
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
      topProductIds={["p1"]}
      dailyMenus={[]}
      role={role}
      embedded
    />,
  );
}

const buscar = async (user: ReturnType<typeof userEvent.setup>, texto: string) => {
  const input = screen.getByPlaceholderText(/buscar/i);
  await user.clear(input);
  await user.type(input, texto);
};

describe("spec 174 · el artículo que no existe, desde la mesa", () => {
  it("no ensucia el catálogo en reposo", () => {
    renderPanel();
    expect(screen.queryByText(/no existe/i)).toBeNull();
  });

  it("aparece justo cuando lo tipeado no encuentra nada", async () => {
    const user = userEvent.setup();
    renderPanel();
    await buscar(user, "torta del cliente");

    // En vez del «Sin resultados» de siempre, la salida.
    expect(screen.getByText(/artículo que no existe/i)).toBeInTheDocument();
  });

  it("el mozo no la ve — el gate es de encargado", async () => {
    const user = userEvent.setup();
    renderPanel("mozo");
    await buscar(user, "torta del cliente");

    expect(screen.queryByText(/artículo que no existe/i)).toBeNull();
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it("carga la línea con lo tipeado ya puesto como nombre y la manda sin product_id", async () => {
    const user = userEvent.setup();
    renderPanel();
    await buscar(user, "Torta del cliente");

    await user.click(screen.getByText(/artículo que no existe/i));
    // El nombre llega escrito: el gesto fue buscarlo, no encontrarlo y
    // cargarlo igual — no volver a tipearlo.
    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Torta del cliente");

    await user.type(screen.getByLabelText(/precio/i), "3500");
    await user.click(screen.getByRole("button", { name: /agregar/i }));

    await user.click(screen.getByRole("button", { name: /enviar/i }));

    const [payload] = vi.mocked(enviarComanda).mock.calls.at(-1)!;
    expect(payload.items).toHaveLength(1);
    const linea = payload.items[0] as Record<string, unknown>;
    expect(linea).toMatchObject({
      kind: "free",
      name: "Torta del cliente",
      unit_price_cents: 350000,
      quantity: 1,
    });
    expect(linea).not.toHaveProperty("product_id");
    // Idempotencia (spec 42): viaja con su clave como cualquier otra línea.
    expect(linea.client_line_key).toEqual(expect.any(String));
  });
});
