import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// El detalle también tiene que decir PARA CUÁNDO es el pedido (#192), y sobre
// todo no perder esa indicación: el input «Entregar» del pie pisa
// `kitchen_notes` al confirmar, así que si abre vacío borra lo que el encargado
// había cargado por teléfono.

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/orders/update-status", () => ({
  updateOrderStatus: async () => ({ ok: true, data: {} }),
}));
vi.mock("./cargar-pedido-sheet", () => ({ CargarPedidoSheet: () => null }));
vi.mock("./cobrar-pedido-sheet", () => ({
  CobrarPedidoSheet: () => null,
}));
vi.mock("@/components/shared/editar-items-modal", () => ({
  EditarItemsModal: () => null,
}));

import { OrderDetailSheet } from "./order-detail-sheet";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { OrderStatus } from "@/lib/orders/status";

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "o1",
    order_number: 42,
    daily_number: 8,
    created_at: "2026-08-20T20:00:00-03:00",
    customer_name: "Juan",
    customer_phone: "3415551234",
    delivery_type: "pickup",
    total_cents: 25_000,
    status: "pending" as OrderStatus,
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
      onConfirm={() => {}}
    />,
  );
}

describe("OrderDetailSheet · para cuándo es el pedido", () => {
  it("muestra la hora del pedido arriba, con sus datos", () => {
    renderSheet(order({ scheduled_at: "2026-08-20T23:30:00.000Z" }));
    expect(screen.getByText("Entregar 20:30 hs")).toBeTruthy();
  });

  // Spec 127 — la nota de cocina dejó de hacer de hora. Antes le ganaba a la
  // real, así que «junto con la mesa 5» aparecía donde va un horario.
  it("la nota de cocina ya no ocupa el lugar de la hora", () => {
    renderSheet(order({ kitchen_notes: "junto con la mesa 5" }));
    expect(screen.queryByText("Entregar junto con la mesa 5")).toBeNull();
  });

  it("el input de cocina abre con la nota ya cargada — confirmar no la borra", () => {
    renderSheet(order({ kitchen_notes: "junto con la mesa 5" }));
    const input = screen.getByLabelText(/Nota para cocina \(sale en la comanda\)/i);
    expect((input as HTMLInputElement).value).toBe("junto con la mesa 5");
  });

  it("sin nota ni agenda, no inventa ninguna indicación", () => {
    renderSheet(order());
    // El label del input del pie también empieza con «Entregar», así que
    // miramos el chip: «Entregar …» con una indicación real detrás.
    expect(
      screen.queryByText(
        (t) => t.startsWith("Entregar ") && !t.includes("comanda"),
      ),
    ).toBeNull();
  });
});
