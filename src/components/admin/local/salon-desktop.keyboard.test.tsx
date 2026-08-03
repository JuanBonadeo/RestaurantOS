import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SalonDesktop, type SalonOrderRef, type SalonReservationRef } from "./salon-desktop";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";

// El panel se prueba aislado del server y del realtime: acá lo que se verifica
// es el recorrido de teclado (spec 075), no los datos.
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

function mesa(id: string, label: string, estado: string, extra = {}) {
  return {
    id,
    label,
    seats: 4,
    x: 10,
    y: 10,
    width: 60,
    height: 60,
    shape: "rect",
    status: "active",
    operational_status: estado,
    opened_at: estado === "libre" ? null : "2026-08-03T19:00:00Z",
    mozo_id: null,
    ...extra,
  };
}

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
      mesa("t1", "1", "ocupada"),
      mesa("t2", "2", "libre"),
      mesa("t3", "3", "libre"),
    ],
  },
] as unknown as FloorPlanWithTables[];

const reservas: SalonReservationRef[] = [
  {
    id: "r1",
    customer_name: "Pérez",
    party_size: 2,
    starts_at: "2026-08-03T21:00:00Z",
    status: "confirmed",
    table_id: "t2",
    notes: null,
  } as unknown as SalonReservationRef,
];

function renderPanel(props: Partial<Parameters<typeof SalonDesktop>[0]> = {}) {
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
      {...props}
    />,
  );
}

/** La fila de una mesa en la lista lateral (el botón que la abre). */
function filaMesa(label: string) {
  return screen
    .getAllByRole("button")
    .find((b) => b.textContent?.trim().startsWith(label))!;
}

/**
 * Parar el foco en una fila **sin** clickearla: un click además la selecciona y
 * cambia el panel al detalle, que es justo lo que estos tests quieren disparar
 * después, con Enter.
 */
function pararseEn(el: HTMLElement) {
  el.focus();
  expect(el).toHaveFocus();
}

describe("SalonDesktop · teclado del panel lateral (spec 075)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("↑/↓ recorren la lista entera: de las reservas pasa a las mesas", async () => {
    const user = userEvent.setup();
    renderPanel();

    // La reserva es el tramo de arriba de la zona; abajo siguen las mesas.
    pararseEn(screen.getByRole("button", { name: /Sentar/ }));
    await user.keyboard("{ArrowDown}");

    // Primera mesa de la lista: ocupada antes que libres.
    expect(filaMesa("1")).toHaveFocus();
  });

  it("↓ y ↑ se mueven entre filas de mesas sin saltear", async () => {
    const user = userEvent.setup();
    renderPanel();

    pararseEn(filaMesa("1"));
    await user.keyboard("{ArrowDown}");
    // "2" tiene la reserva próxima → encabeza el grupo de libres.
    expect(filaMesa("2")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(filaMesa("3")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(filaMesa("2")).toHaveFocus();
  });

  it("Enter sobre una fila abre el detalle de esa mesa", async () => {
    const user = userEvent.setup();
    renderPanel();

    pararseEn(filaMesa("1"));
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("button", { name: "Cerrar detalle" }),
    ).toBeInTheDocument();
  });

  it("Esc cierra el detalle y devuelve el foco a la fila de donde vino", async () => {
    const user = userEvent.setup();
    renderPanel();

    pararseEn(filaMesa("3"));
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("button", { name: "Cerrar detalle" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("button", { name: "Cerrar detalle" }),
    ).not.toBeInTheDocument();
    // Vuelve a la mesa 3, no al principio de la lista.
    await waitFor(() => {
      expect(filaMesa("3")).toHaveFocus();
    });
  });

  it("solo la fila activa queda en el orden de tabulación", async () => {
    renderPanel();

    pararseEn(filaMesa("2"));
    await waitFor(() => {
      expect(filaMesa("2")).toHaveAttribute("tabindex", "0");
    });
    expect(filaMesa("1")).toHaveAttribute("tabindex", "-1");
  });

  it("↑/↓ recorren los controles del detalle de mesa", async () => {
    const user = userEvent.setup();
    renderPanel();

    pararseEn(filaMesa("1"));
    await user.keyboard("{Enter}");

    // Desde el botón de cerrar (el primero del panel), ↓ baja al siguiente
    // control sin necesidad de Tab.
    const cerrar = screen.getByRole("button", { name: "Cerrar detalle" });
    pararseEn(cerrar);
    await user.keyboard("{ArrowDown}");
    expect(cerrar).not.toHaveFocus();
    expect(
      screen.getByRole("button", { name: /Cargar pedido|Cobrar|Sentar/ }),
    ).toHaveFocus();
  });
});
