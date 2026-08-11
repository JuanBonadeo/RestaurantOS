import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SalonDesktop } from "./salon-desktop";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";

/**
 * El plano manda sobre el panel: con una mesa abierta en un modo (cargar
 * pedido, cuenta, cobro), tocar OTRA mesa cambia de mesa y tocar el plano al
 * aire cierra. Antes el tap no hacía nada visible —el modo le gana al detalle
 * en el panel— y el plano parecía muerto mientras cargabas un pedido.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/mozo/use-tables-realtime", () => ({
  useTablesRealtime: () => {},
}));
vi.mock("@/lib/reservations/use-reservations-realtime", () => ({
  useReservationsRealtime: () => {},
}));
// El catálogo nunca llega: así el modo "cargar pedido" se queda abierto en su
// estado de carga y podemos tocar el plano con el panel tomado.
vi.mock("@/lib/mozo/pedir-panel-data", () => ({
  loadPedirCatalog: vi.fn(() => new Promise(() => {})),
  loadTableComandas: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/lib/billing/cobro-panel-data", () => ({
  loadCobroForTable: vi.fn(() => new Promise(() => {})),
  loadCuentaForTable: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getSalonTabData: vi.fn(async () => ({ ok: false, error: "test" })),
}));

function plano(): FloorPlanWithTables[] {
  const mesa = (id: string, label: string, x: number) => ({
    id,
    label,
    seats: 4,
    x,
    y: 10,
    width: 60,
    height: 60,
    shape: "rect",
    status: "active",
    operational_status: "ocupada",
    opened_at: "2026-08-08T20:00:00Z",
    mozo_id: null,
  });
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
      tables: [mesa("t1", "1", 10), mesa("t2", "2", 200)],
    },
  ] as unknown as FloorPlanWithTables[];
}

/** El `<g>` de la mesa en el plano, buscado por su rótulo. */
function mesaEnPlano(container: HTMLElement, label: string): Element {
  const g = Array.from(container.querySelectorAll("svg > g")).find((el) =>
    Array.from(el.querySelectorAll("text")).some(
      (t) => t.textContent === label,
    ),
  );
  if (!g) throw new Error(`No encontré la mesa ${label} en el plano`);
  return g;
}

function renderSalon() {
  return render(
    <SalonDesktop
      slug="golf"
      businessId="b1"
      floorPlans={plano()}
      dineInOrders={[]}
      reservations={[]}
      mozos={[]}
      currentUserId="u1"
      role="encargado"
    />,
  );
}

/** Deja la mesa 1 con "Cargar pedido" abierto (esperando el catálogo). */
async function abrirPedidoDeMesa1(container: HTMLElement) {
  const user = userEvent.setup();
  await act(async () => {
    fireEvent.click(mesaEnPlano(container, "1"));
  });
  await user.click(await screen.findByRole("button", { name: /Cargar pedido/ }));
  expect(await screen.findByText(/Cargando catálogo/)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SalonDesktop · el plano manda sobre el panel", () => {
  it("con un pedido abierto, tocar otra mesa la abre a ella", async () => {
    const { container } = renderSalon();
    await abrirPedidoDeMesa1(container);

    await act(async () => {
      fireEvent.click(mesaEnPlano(container, "2"));
    });

    // El modo de la mesa 1 cedió y el panel muestra el detalle de la 2.
    expect(screen.queryByText(/Cargando catálogo/)).toBeNull();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("2");
  });

  it("tocar la MISMA mesa que estás cargando no cierra nada", async () => {
    const { container } = renderSalon();
    await abrirPedidoDeMesa1(container);

    await act(async () => {
      fireEvent.click(mesaEnPlano(container, "1"));
    });

    // Un tap de más sobre la mesa en la que ya estás no puede tirar abajo el
    // pedido en armado.
    expect(screen.getByText(/Cargando catálogo/)).toBeInTheDocument();
  });

  it("tocar el plano fuera de una mesa cierra el modo abierto", async () => {
    const { container } = renderSalon();
    await abrirPedidoDeMesa1(container);

    // Primer tap al aire: se cierra el pedido y queda el detalle de la mesa.
    await act(async () => {
      fireEvent.click(container.querySelector("svg")!);
    });
    expect(screen.queryByText(/Cargando catálogo/)).toBeNull();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("1");

    // Segundo tap: se cierra el detalle y vuelve la lista del panel.
    await act(async () => {
      fireEvent.click(container.querySelector("svg")!);
    });
    expect(screen.queryByLabelText("Cerrar detalle")).toBeNull();
  });
});
