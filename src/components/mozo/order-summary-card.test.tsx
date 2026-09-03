import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelarComanda = vi.fn(async () => ({ ok: true as const, data: undefined }));
const marcarComandaEntregada = vi.fn(async () => ({ ok: true as const, data: undefined }));
const refresh = vi.fn();

vi.mock("@/lib/comandas/actions", () => ({
  cancelarComanda: (...args: unknown[]) => cancelarComanda(...(args as [])),
  marcarComandaEntregada: (...args: unknown[]) =>
    marcarComandaEntregada(...(args as [])),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/components/shared/editar-items-modal", () => ({
  EditarItemsModal: () => <div>editor abierto</div>,
}));

import { OrderSummaryCard, type ComandaSummary } from "./order-summary-card";

/**
 * Spec 078 — el atajo para anular la comanda desde el panel de la mesa.
 *
 * Lo que se cuida acá es el gate (rol + estado de la comanda) y que una
 * comanda anulada se vea anulada: antes de esta spec la card no recibía
 * `cancelled_at`, así que una comanda ya anulada se dibujaba «Activa» y con
 * el botón Entregar habilitado.
 */
const COMANDA: ComandaSummary = {
  id: "c1",
  batch: 1,
  status: "pendiente",
  station_name: "Parrilla",
  emitted_at: new Date("2026-08-04T20:00:00Z").toISOString(),
  delivered_at: null,
  cancelled_at: null,
  items: [{ product_name: "Bife de chorizo", quantity: 2 }],
};

function renderCard(
  comanda: Partial<ComandaSummary>,
  props: { canAnular?: boolean } = {},
) {
  return render(
    <OrderSummaryCard
      order={{
        order_number: 42,
        daily_number: 7,
        total_cents: 120_000,
        items: [
          { product_name: "Bife de chorizo", quantity: 2, cancelled_at: null },
        ],
        comandas: [{ ...COMANDA, ...comanda }],
      }}
      slug="golf-jcr"
      tableLabel="5"
      {...props}
    />,
  );
}

const menuTrigger = () => screen.queryByRole("button", { name: /opciones de la comanda/i });

describe("panel de mesa · anular comanda (spec 078)", () => {
  beforeEach(() => {
    cancelarComanda.mockClear();
    marcarComandaEntregada.mockClear();
    refresh.mockClear();
  });

  it("el encargado ve el atajo sobre una comanda activa", () => {
    renderCard({}, { canAnular: true });
    expect(menuTrigger()).not.toBeNull();
    expect(screen.getByText("Activa")).toBeTruthy();
  });

  it("el mozo no lo ve", () => {
    renderCard({}, { canAnular: false });
    expect(menuTrigger()).toBeNull();
    // Pero sigue pudiendo entregar: el gate es sólo sobre anular.
    expect(screen.getByRole("button", { name: /entregar/i })).toBeTruthy();
  });

  it("no se ofrece sobre una comanda ya entregada", () => {
    renderCard(
      { status: "entregado", delivered_at: new Date().toISOString() },
      { canAnular: true },
    );
    expect(menuTrigger()).toBeNull();
    expect(screen.getByText("Cerrada")).toBeTruthy();
  });

  it("una comanda anulada se ve Anulada, sin Entregar ni atajo", () => {
    renderCard(
      { cancelled_at: new Date().toISOString() },
      { canAnular: true },
    );
    expect(screen.getByText("Anulada")).toBeTruthy();
    expect(screen.queryByText("Activa")).toBeNull();
    expect(screen.queryByRole("button", { name: /entregar/i })).toBeNull();
    expect(menuTrigger()).toBeNull();
  });

  it("anula con motivo desde el ⋯ y refresca", async () => {
    const user = userEvent.setup();
    renderCard({}, { canAnular: true });

    await user.click(menuTrigger()!);
    await user.click(await screen.findByText(/anular comanda/i));

    // El modal es el mismo del tab Comandas: motivo obligatorio.
    await user.click(
      screen.getByRole("button", { name: /anular comanda/i }),
    );
    expect(cancelarComanda).not.toHaveBeenCalled();

    await user.type(
      screen.getByPlaceholderText(/motivo/i),
      "la mesa se levantó",
    );
    await user.click(screen.getByRole("button", { name: /anular comanda/i }));

    expect(cancelarComanda).toHaveBeenCalledWith(
      "golf-jcr",
      "c1",
      "la mesa se levantó",
    );
    expect(refresh).toHaveBeenCalled();
  });
});

/**
 * Spec 125 · issue #169 — los ítems de la mesa se editan desde el panel.
 *
 * El gesto lo habilita el caller, no la card: es él quien sabe si la cuenta
 * está abierta e impaga y si el rol alcanza. La app del mozo no pasa nada, así
 * que ahí no aparece.
 */
describe("OrderSummaryCard · editar ítems", () => {
  const ITEM = {
    order_item_id: "i1",
    product_id: "p1",
    product_name: "Bife de chorizo",
    quantity: 2,
    notes: null,
    combo_name: null,
    station_id: "s1",
    unit_price_cents: 60_000,
    price_original_cents: null,
    price_override_reason: null,
  };

  function renderConEditables(itemsEditables?: (typeof ITEM)[]) {
    return render(
      <OrderSummaryCard
        order={{
          order_number: 42,
          daily_number: 7,
          total_cents: 120_000,
          items: [
            { product_name: "Bife de chorizo", quantity: 2, cancelled_at: null },
          ],
          comandas: [COMANDA],
        }}
        slug="golf-jcr"
        tableLabel="5"
        itemsEditables={itemsEditables}
      />,
    );
  }

  it("con líneas editables → aparece el gesto y abre el editor", async () => {
    renderConEditables([ITEM]);
    const boton = screen.getByRole("button", { name: /Editar ítems/i });
    await userEvent.click(boton);
    expect(screen.getByText("editor abierto")).toBeTruthy();
  });

  it("sin líneas editables (mozo, o cuenta cobrada) → sin gesto", () => {
    renderConEditables(undefined);
    expect(screen.queryByRole("button", { name: /Editar ítems/i })).toBeNull();
  });

  it("lista vacía → sin gesto (todo lo que queda es combo o está cancelado)", () => {
    renderConEditables([]);
    expect(screen.queryByRole("button", { name: /Editar ítems/i })).toBeNull();
  });
});
