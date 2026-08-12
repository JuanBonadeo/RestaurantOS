import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SalonDesktop } from "./salon-desktop";
import {
  loadPedirCatalog,
  loadTableComandas,
} from "@/lib/mozo/pedir-panel-data";
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

/**
 * Deja la mesa 1 con la carga abierta, esperando el catálogo.
 *
 * Desde la spec 111 el tap **es** el camino: no hay un detalle en el medio con
 * un botón «Cargar pedido» (la mesa vive en la columna izquierda de la carga).
 */
async function abrirPedidoDeMesa1(container: HTMLElement) {
  await act(async () => {
    fireEvent.click(mesaEnPlano(container, "1"));
  });
  expect(await screen.findByText(/Cargando catálogo/)).toBeInTheDocument();
}

/**
 * Deja los loaders colgados: el panel se queda en «Cargando catálogo…», que es
 * lo que estos tests necesitan para tocar el plano con el panel tomado.
 *
 * Va explícito por test porque `clearAllMocks` limpia las llamadas pero **no**
 * las implementaciones: sin esto, el `mockResolvedValue` de un test se filtra
 * a los que siguen.
 */
function conPanelQueNuncaLlega() {
  vi.mocked(loadPedirCatalog).mockImplementation(
    () => new Promise(() => {}) as never,
  );
  vi.mocked(loadTableComandas).mockImplementation(
    () => new Promise(() => {}) as never,
  );
}

/** Hace que el panel de carga llegue a montarse de verdad. */
function conPanelQueMonta() {
  vi.mocked(loadPedirCatalog).mockResolvedValue({
    ok: true,
    data: {
      businessName: "Golf",
      catalog: { superCategories: [], categories: [] },
      stationNameById: {},
      topProductIds: [],
      dailyMenus: [],
    },
  } as never);
  vi.mocked(loadTableComandas).mockResolvedValue({
    ok: true,
    data: { comandas: [], loPedido: null },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SalonDesktop · el plano manda sobre el panel", () => {
  it("con un pedido abierto, tocar otra mesa la abre a ella", async () => {
    conPanelQueMonta();
    const { container } = renderSalon();

    await act(async () => {
      fireEvent.click(mesaEnPlano(container, "1"));
    });
    expect(
      await screen.findByRole("region", { name: "Mesa 1" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(mesaEnPlano(container, "2"));
    });

    // El panel cambió de mesa: la columna izquierda es la 2.
    expect(
      await screen.findByRole("region", { name: "Mesa 2" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Mesa 1" })).toBeNull();
  });

  it("tocar la MISMA mesa que estás cargando no cierra nada", async () => {
    conPanelQueNuncaLlega();
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
    conPanelQueNuncaLlega();
    const { container } = renderSalon();
    await abrirPedidoDeMesa1(container);

    // Un tap al aire cierra la carga y vuelve la lista del panel. Antes eran
    // dos taps porque abajo de la carga quedaba el detalle de la mesa; desde
    // la spec 111 ese nivel no existe (la mesa es la columna de la carga).
    await act(async () => {
      fireEvent.click(container.querySelector("svg")!);
    });
    expect(screen.queryByText(/Cargando catálogo/)).toBeNull();
    expect(screen.queryByLabelText("Cerrar detalle")).toBeNull();
  });
});
