import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SalonDesktop, type SalonOrderRef } from "./salon-desktop";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";

/**
 * Spec 102 — el salón se re-sincroniza por refetch, no por re-render de la ruta.
 *
 * El test que importa es el último: desde que el snapshot del server vive en
 * estado propio, cualquier hijo que siga resolviendo con `router.refresh()`
 * queda **mudo** (el payload nuevo se descarta). Le pasó a "entregar comanda":
 * la action pegaba y la fila seguía diciendo «Activa» con el botón puesto.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/mozo/use-tables-realtime", () => ({
  useTablesRealtime: () => {},
}));
vi.mock("@/lib/reservations/use-reservations-realtime", () => ({
  useReservationsRealtime: () => {},
}));
vi.mock("@/lib/mozo/pedir-panel-data", () => ({
  loadPedirCatalog: vi.fn(async () => ({ ok: false as const, error: "test" })),
  loadTableComandas: vi.fn(async () => ({ ok: false as const, error: "test" })),
}));
vi.mock("@/lib/billing/cobro-panel-data", () => ({
  loadCobroForTable: vi.fn(async () => ({ ok: false as const, error: "test" })),
  loadCuentaForTable: vi.fn(async () => ({
    ok: false as const,
    error: "test",
  })),
}));

const marcarComandaEntregada = vi.fn(async () => ({
  ok: true as const,
  data: {},
}));
vi.mock("@/lib/comandas/actions", () => ({
  marcarComandaEntregada: () => marcarComandaEntregada(),
}));

/** Snapshot que devuelve el refetch: la comanda ya entregada. */
const getSalonTabData = vi.fn();
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getSalonTabData: () => getSalonTabData(),
}));

function plano(estadoMesa: string): FloorPlanWithTables[] {
  return [
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
      tables: [
        {
          id: "t1",
          label: "1",
          seats: 4,
          x: 10,
          y: 10,
          width: 60,
          height: 60,
          shape: "rect",
          status: "active",
          operational_status: estadoMesa,
          opened_at: "2026-08-08T20:00:00Z",
          mozo_id: null,
        },
      ],
    },
  ] as unknown as FloorPlanWithTables[];
}

function orden(estadoComanda: "pendiente" | "entregado"): SalonOrderRef[] {
  return [
    {
      id: "o1",
      order_number: 12,
      table_id: "t1",
      total_cents: 10000,
      created_at: "2026-08-08T20:00:00Z",
      status: "confirmed",
      customer_name: null,
      items: [{ product_name: "Entrecot", quantity: 1, cancelled_at: null }],
      comandas: [
        {
          id: "c1",
          batch: 1,
          status: estadoComanda,
          station_name: "Parrilla",
          emitted_at: "2026-08-08T20:05:00Z",
          delivered_at:
            estadoComanda === "entregado" ? "2026-08-08T20:20:00Z" : null,
          cancelled_at: null,
          items: [{ product_name: "Entrecot", quantity: 1 }],
        },
      ],
    },
  ] as unknown as SalonOrderRef[];
}

/**
 * Una reserva sobre la mesa. Desde la spec 111 tocar una mesa entra directo a
 * cargar; el **detalle** —que es lo que estos tests ejercitan, con su tarjeta
 * de comandas y el cableo de refetch de la spec 102— sigue siendo el camino de
 * una mesa con reserva encima (FR-016).
 */
const reservaEnMesa1 = [
  {
    id: "r1",
    customer_name: "Pérez",
    party_size: 2,
    starts_at: "2026-08-08T21:00:00Z",
    status: "confirmed",
    table_id: "t1",
    notes: null,
  },
] as unknown as Parameters<typeof SalonDesktop>[0]["reservations"];

function renderSalon() {
  return render(
    <SalonDesktop
      slug="golf"
      businessId="b1"
      floorPlans={plano("ocupada")}
      dineInOrders={orden("pendiente")}
      reservations={reservaEnMesa1}
      mozos={[]}
      currentUserId="u1"
      role="encargado"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSalonTabData.mockResolvedValue({
    ok: true,
    data: {
      floorPlans: plano("ocupada"),
      dineInOrders: orden("entregado"),
      reservations: reservaEnMesa1,
      mozos: [],
    },
  });
});

describe("SalonDesktop · re-sincronización por refetch (spec 102)", () => {
  it("entregar una comanda refleja el cambio sin re-correr la ruta", async () => {
    const user = userEvent.setup();
    renderSalon();

    // Abrir el detalle de la mesa 1 (tiene reserva → detalle, no carga).
    const fila = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim().startsWith("1"))!;
    await user.click(fila);

    const entregar = await screen.findByRole("button", { name: /Entregar/i });
    await act(async () => {
      await user.click(entregar);
    });

    // La action corrió, el refetch trajo el estado nuevo…
    expect(marcarComandaEntregada).toHaveBeenCalledTimes(1);
    expect(getSalonTabData).toHaveBeenCalledTimes(1);
    // …y el panel lo muestra: sin el cableo, la fila seguía «Activa» con el
    // botón puesto aunque la comanda ya estuviera entregada en la DB.
    expect(screen.queryByRole("button", { name: /Entregar/i })).toBeNull();
    // Y no se re-corrió la ruta entera para lograrlo.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("si el refetch falla, el plano mantiene lo que tenía (nunca se vacía)", async () => {
    const user = userEvent.setup();
    getSalonTabData.mockRejectedValue(new Error("red caída"));
    renderSalon();

    const fila = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim().startsWith("1"))!;
    await user.click(fila);
    const entregar = await screen.findByRole("button", { name: /Entregar/i });
    await act(async () => {
      await user.click(entregar);
    });

    // El error se traga —es un refresh de fondo, no una acción del usuario— y
    // el panel sigue mostrando lo que tenía en vez de quedar vacío.
    expect(getSalonTabData).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: /Entregar/i }),
    ).toBeInTheDocument();
  });
});
