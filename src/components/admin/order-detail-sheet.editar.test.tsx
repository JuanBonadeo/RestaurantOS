import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Spec 125 — el detalle del pedido ofrece editar los ítems, con una sola regla:
// vivo y no cobrado. Un pedido pagado se anula y se rehace; editarlo dejaría una
// orden que no coincide con lo que se cobró (y el server lo rechaza igual).

const itemRow = {
  id: "i1",
  product_id: "p1",
  product_name: "Milanesa",
  quantity: 1,
  subtotal_cents: 25_000,
  unit_price_cents: 25_000,
  price_original_cents: null,
  price_override_reason: null,
  station_id: "s1",
  cancelled_at: null,
  notes: null,
  daily_menu_id: null,
  daily_menu_snapshot: null,
  is_combo_component: false,
  parent_order_item_id: null,
  order_item_modifiers: [],
};

/** Lo que devuelve el detalle. Se reasigna por test. */
let filaDelDetalle: Record<string, unknown> | null = {
  delivery_address: null,
  delivery_notes: null,
  subtotal_cents: 25_000,
  delivery_fee_cents: 0,
  order_items: [itemRow],
  order_status_history: [],
};

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: filaDelDetalle }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/orders/update-status", () => ({
  updateOrderStatus: async () => ({ ok: true, data: {} }),
}));
vi.mock("./cobrar-pedido-sheet", () => ({ CobrarPedidoSheet: () => null }));
vi.mock("@/components/shared/editar-items-modal", () => ({
  EditarItemsModal: () => <div>editor abierto</div>,
}));

import { OrderDetailSheet } from "./order-detail-sheet";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { OrderStatus } from "@/lib/orders/status";

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "o1",
    order_number: 42,
    daily_number: 7,
    created_at: "2026-08-20T20:00:00-03:00",
    customer_name: "Juan",
    customer_phone: "3415551234",
    delivery_type: "delivery",
    total_cents: 25_000,
    status: "preparing" as OrderStatus,
    payment_method: "cash",
    payment_status: "pending",
    cancelled_reason: null,
    scheduled_at: null,
    kitchen_notes: null,
    items: [{ product_name: "Milanesa", quantity: 1 }],
    ...overrides,
  };
}

function renderSheet(o: AdminOrder) {
  return render(
    <OrderDetailSheet
      open
      onOpenChange={() => {}}
      order={o}
      slug="golf"
      timezone="America/Argentina/Buenos_Aires"
      onAdvance={() => {}}
    />,
  );
}

const botonEditar = () => screen.queryByRole("button", { name: /Editar ítems/i });

describe("OrderDetailSheet · editar ítems (spec 125)", () => {
  it("pedido vivo e impago → ofrece editar", async () => {
    renderSheet(order());
    await waitFor(() => expect(botonEditar()).toBeTruthy());
  });

  it("entregado pero impago → sigue ofreciendo editar", async () => {
    // El delivery que volvió y se cobra al mostrador: corregirlo ANTES de
    // cobrar es justamente el momento correcto (#190).
    renderSheet(order({ status: "delivered" as OrderStatus }));
    await waitFor(() => expect(botonEditar()).toBeTruthy());
  });

  it("pedido ya cobrado → sin gesto", async () => {
    renderSheet(order({ payment_status: "paid" }));
    await waitFor(() => expect(screen.getByText("Milanesa")).toBeTruthy());
    expect(botonEditar()).toBeNull();
  });

  it("pedido cancelado → sin gesto", async () => {
    renderSheet(order({ status: "cancelled" as OrderStatus }));
    await waitFor(() => expect(screen.getByText("Milanesa")).toBeTruthy());
    expect(botonEditar()).toBeNull();
  });
});
