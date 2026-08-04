import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { SalonDesktop, type SalonOrderRef, type SalonReservationRef } from "./salon-desktop";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";

// Mismo aislamiento que el test de teclado: sin server, sin realtime.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
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
  loadCuentaForTable: vi.fn(async () => ({ ok: false as const, error: "test" })),
}));

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
    tables: [
      {
        id: "t2",
        label: "2",
        seats: 4,
        x: 10,
        y: 10,
        width: 60,
        height: 60,
        shape: "rect",
        status: "active",
        operational_status: "libre",
        opened_at: null,
        mozo_id: null,
      },
    ],
  },
] as unknown as FloorPlanWithTables[];

/** Reserva de las 21 (hora AR) sobre la mesa 2. */
const RESERVA_ISO = new Date("2026-08-04T21:00:00-03:00").toISOString();

/** Cómo la escribe el plano — depende de la TZ de la máquina, así que se
 *  calcula igual que el viewer en vez de hardcodear "21:00". */
const HORA_EN_EL_PLANO = new Date(RESERVA_ISO).toLocaleTimeString("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const reservas: SalonReservationRef[] = [
  {
    id: "r1",
    customer_name: "Pérez",
    party_size: 2,
    starts_at: RESERVA_ISO,
    status: "confirmed",
    table_id: "t2",
    notes: null,
  } as unknown as SalonReservationRef,
];

function renderPlano() {
  return render(
    <SalonDesktop
      slug="golf"
      businessId="b1"
      floorPlans={floorPlans}
      dineInOrders={[] as SalonOrderRef[]}
      reservations={reservas}
      mozos={[]}
      currentUserId="u1"
      role="encargado"
    />,
  );
}

/** El SVG del plano (el único con el viewBox del salón). */
function plano(container: HTMLElement): SVGElement {
  return container.querySelector('svg[viewBox="0 0 800 600"]')!;
}

describe("SalonDesktop · reserva dibujada en el plano (issue #117)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("al mediodía la mesa no muestra la reserva de las 21", async () => {
    vi.setSystemTime(new Date("2026-08-04T12:00:00-03:00"));
    const { container } = renderPlano();

    // El reloj del panel arranca en null y se setea al montar.
    await waitFor(() => expect(plano(container)).not.toBeNull());
    expect(plano(container).textContent).not.toContain(HORA_EN_EL_PLANO);
    expect(plano(container).textContent).not.toContain("2p");
  });

  it("a las 19:30 la mesa ya la muestra (entró en la ventana de 3 h)", async () => {
    vi.setSystemTime(new Date("2026-08-04T19:30:00-03:00"));
    const { container } = renderPlano();

    await waitFor(() =>
      expect(plano(container).textContent).toContain(HORA_EN_EL_PLANO),
    );
    expect(plano(container).textContent).toContain("2p");
  });
});
