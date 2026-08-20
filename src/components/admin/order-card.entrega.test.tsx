import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// El encargue telefónico se carga a la mañana para la noche: en la tarjeta,
// "hace 5 h" no dice nada — lo que el encargado necesita ver es PARA CUÁNDO es.
// Esa indicación viaja en `kitchen_notes` (el campo libre que sale en la
// comanda como «ENTREGAR …»), o en `scheduled_at` si el pedido vino agendado.

vi.mock("./order-detail-sheet", () => ({
  OrderDetailSheet: () => null,
}));

import { OrderCard } from "./order-card";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { OrderStatus } from "@/lib/orders/status";

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "o1",
    order_number: 42,
    daily_number: 8,
    // Hace rato: sin nota, la tarjeta muestra el transcurrido.
    created_at: new Date(Date.now() - 90 * 60_000).toISOString(),
    customer_name: "Juan",
    customer_phone: "3415551234",
    delivery_type: "pickup",
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

function renderCard(o: AdminOrder) {
  return render(
    <OrderCard
      order={o}
      slug="golf"
      timezone="America/Argentina/Buenos_Aires"
      onAdvance={() => {}}
    />,
  );
}

describe("OrderCard · para cuándo es el pedido", () => {
  it("muestra la nota del encargado en lugar del transcurrido", () => {
    renderCard(order({ kitchen_notes: "21:30, junto con la mesa 5" }));
    expect(screen.getByText("21:30, junto con la mesa 5")).toBeTruthy();
    expect(screen.queryByText("1h 30")).toBeNull();
  });

  it("sin nota, cae en la hora del pedido agendado", () => {
    renderCard(
      order({ scheduled_at: "2026-08-20T23:30:00.000Z" }), // 20:30 en AR
    );
    expect(screen.getByText("20:30 hs")).toBeTruthy();
  });

  it("sin nota ni agenda, sigue mostrando el transcurrido", () => {
    renderCard(order());
    expect(screen.getByText("1h 30")).toBeTruthy();
  });
});
