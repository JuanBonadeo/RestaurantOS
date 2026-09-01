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
    kitchen_at: null,
    kitchen_notes: null,
    items: [{ product_name: "Milanesa", quantity: 1 }],
    ...overrides,
  };
}

function renderCard(
  o: AdminOrder,
  extra: { marchLeadKitchenMin?: number } = {},
) {
  return render(
    <OrderCard
      order={o}
      slug="golf"
      timezone="America/Argentina/Buenos_Aires"
      onAdvance={() => {}}
      {...extra}
    />,
  );
}

describe("OrderCard · para cuándo es el pedido", () => {
  it("muestra la hora del pedido en lugar del transcurrido", () => {
    renderCard(
      order({ scheduled_at: "2026-08-20T23:30:00.000Z" }), // 20:30 en AR
    );
    expect(screen.getByText("20:30 hs")).toBeTruthy();
    expect(screen.queryByText("1h 30")).toBeNull();
  });

  // Spec 127 — la nota volvió a ser una nota. Antes le ganaba a la hora real,
  // así que un pedido con «junto con la mesa 5» mostraba eso donde va una hora.
  it("la nota de cocina ya no se muestra como si fuera la hora", () => {
    renderCard(order({ kitchen_notes: "junto con la mesa 5" }));
    expect(screen.queryByText("junto con la mesa 5")).toBeNull();
    expect(screen.getByText("1h 30")).toBeTruthy();
  });

  it("sin hora, sigue mostrando el transcurrido", () => {
    renderCard(order());
    expect(screen.getByText("1h 30")).toBeTruthy();
  });
});

// ── Spec 127 · el agendado vive en «Nuevos», con su chip ────────────────────

describe("OrderCard · el pedido programado", () => {
  const enDosHoras = () =>
    new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  it("se marca como Programado sin salir de la columna", () => {
    renderCard(order({ scheduled_at: enDosHoras(), status: "confirmed" }));
    expect(screen.getByText("Programado")).toBeTruthy();
  });

  it("un pedido para ahora no lleva chip", () => {
    renderCard(order());
    expect(screen.queryByText("Programado")).toBeNull();
  });

  it("avisa cuando pasó su hora de marcha y sigue ahí", () => {
    // Cocina 20:00 con lead 40 → tenía que marchar 19:20. Si el pedido sigue en
    // «Nuevos» a las 21, el cron no lo levantó y hay que ir a mirar.
    renderCard(
      order({
        scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        kitchen_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        status: "confirmed",
      }),
      { marchLeadKitchenMin: 40 },
    );
    expect(screen.getByText("No marchó")).toBeTruthy();
  });
});
