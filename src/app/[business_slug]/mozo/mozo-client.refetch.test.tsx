import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MozoClient } from "./mozo-client";

/**
 * Spec 107 — el home del mozo se re-sincroniza por refetch, no por re-render de
 * la ruta.
 *
 * Este test existe por un bug concreto, y es el MISMO que el review de la spec
 * 102 encontró en el salón: al mover el snapshot del server a estado propio,
 * todo hijo que siga resolviendo con `router.refresh()` queda **mudo** — el
 * payload nuevo llega y se descarta. Acá le tocó a "entregar comanda" desde el
 * drawer de la mesa: la action pegaba en la DB y la fila seguía diciendo
 * «Activa» con el botón puesto, sin nada que lo curara (la action no escribe
 * `tables`, así que el realtime tampoco dispara).
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/mozo/use-tables-realtime", () => ({ useTablesRealtime: () => {} }));
vi.mock("@/components/notifications/use-notifications-realtime", () => ({
  useNotificationsRealtime: () => ({
    notifications: [],
    unreadCount: 0,
    markReadLocally: vi.fn(),
    markAllReadLocally: vi.fn(),
  }),
}));

const marcarComandaEntregada = vi.fn(async () => ({ ok: true as const, data: {} }));
vi.mock("@/lib/comandas/actions", () => ({
  marcarComandaEntregada: () => marcarComandaEntregada(),
}));

const getMozoHomeData = vi.fn();
vi.mock("@/lib/mozo/home-actions", () => ({
  getMozoHomeData: () => getMozoHomeData(),
}));

const mesa = {
  id: "t1",
  label: "1",
  seats: 4,
  x: 10,
  y: 10,
  width: 60,
  height: 60,
  shape: "rect",
  status: "active",
  operational_status: "ocupada",
  opened_at: "2026-08-08T20:00:00Z",
  mozo_id: "u1",
  floor_plan_id: "plan-1",
  is_bar: false,
};

const floorPlans = [
  {
    plan: {
      id: "plan-1",
      name: "Salón",
      width: 800,
      height: 600,
      background_image_url: null,
      background_opacity: 100,
      show_customer_name: false,
    },
    tables: [mesa],
  },
] as never;

const orden = (estado: "pendiente" | "entregado") =>
  [
    {
      id: "o1",
      order_number: 12,
      daily_number: 3,
      table_id: "t1",
      delivery_type: "dine_in",
      total_cents: 10000,
      created_at: "2026-08-08T20:00:00Z",
      status: "confirmed",
      customer_name: null,
      items: [{ product_name: "Entrecot", quantity: 1, cancelled_at: null }],
      comandas: [
        {
          id: "c1",
          batch: 1,
          status: estado,
          station_name: "Parrilla",
          emitted_at: "2026-08-08T20:05:00Z",
          delivered_at: estado === "entregado" ? "2026-08-08T20:20:00Z" : null,
          cancelled_at: null,
          items: [{ product_name: "Entrecot", quantity: 1 }],
        },
      ],
    },
  ] as never;

function renderHome() {
  return render(
    <MozoClient
      businessSlug="golf"
      businessName="Golf"
      businessId="b1"
      floorPlans={floorPlans}
      reservations={[] as never}
      activeOrders={orden("pendiente")}
      mozos={[{ user_id: "u1", full_name: "Ana", role: "mozo" }] as never}
      currentUserId="u1"
      role="mozo"
      initialNotifications={[]}
      initialUnreadCount={0}
      todayTipsCents={0}
      attendance={null as never}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getMozoHomeData.mockResolvedValue({
    ok: true,
    data: {
      floorPlans,
      reservations: [],
      activeOrders: orden("entregado"),
      mozos: [{ user_id: "u1", full_name: "Ana", role: "mozo" }],
    },
  });
});

describe("MozoClient · re-sincronización por refetch (spec 107)", () => {
  it("entregar una comanda se refleja, sin re-correr la ruta", async () => {
    const user = userEvent.setup();
    renderHome();

    // Abrir el drawer de la mesa 1.
    const fila = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim().startsWith("1"))!;
    await user.click(fila);

    const entregar = await screen.findByRole("button", { name: /Entregar/i });
    await act(async () => {
      await user.click(entregar);
    });

    expect(marcarComandaEntregada).toHaveBeenCalledTimes(1);
    // El refetch de la tab corrió…
    expect(getMozoHomeData).toHaveBeenCalledTimes(1);
    // …y el drawer lo muestra: sin el cableo, la fila seguía «Activa».
    expect(screen.queryByRole("button", { name: /Entregar/i })).toBeNull();
    // Y no se re-corrió la ruta entera para lograrlo.
    expect(refresh).not.toHaveBeenCalled();
  });
});
