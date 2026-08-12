import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SalonDesktop } from "./salon-desktop";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { SalonOrderRef, SalonReservationRef } from "./salon-desktop";

/**
 * Spec 114 — el catálogo del panel del salón.
 *
 * El test existe por una regresión concreta: al mover el catálogo al cache
 * compartido, se perdió el reintento que tenía el camino viejo (`openPedir`
 * re-pedía el catálogo en cada apertura, así que un fallo de red se curaba en el
 * siguiente tap). Con el keep-alive de la spec 101 el panel se monta **una vez
 * por carga de página**: sin reintento, un solo fallo dejaba al encargado sin
 * poder cargar pedidos el resto del turno, y el único botón decía «Cerrar».
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/mozo/use-tables-realtime", () => ({ useTablesRealtime: () => {} }));
vi.mock("@/lib/reservations/use-reservations-realtime", () => ({
  useReservationsRealtime: () => {},
}));
vi.mock("@/lib/billing/cobro-panel-data", () => ({
  loadCobroForTable: vi.fn(() => new Promise(() => {})),
  loadCuentaForTable: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getSalonTabData: vi.fn(async () => ({ ok: false, error: "test" })),
}));

const loadPedirCatalog = vi.fn();
vi.mock("@/lib/mozo/pedir-panel-data", () => ({
  loadPedirCatalog: (slug: string) => loadPedirCatalog(slug),
  loadTableComandas: vi.fn(() => new Promise(() => {})),
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
        opened_at: "2026-08-09T20:00:00Z",
        mozo_id: null,
      },
    ],
  },
] as unknown as FloorPlanWithTables[];

function renderSalon() {
  return render(
    <SalonDesktop
      slug="golf"
      businessId="b1"
      floorPlans={floorPlans}
      dineInOrders={[] as SalonOrderRef[]}
      reservations={[] as SalonReservationRef[]}
      mozos={[]}
      currentUserId="u1"
      role="encargado"
    />,
  );
}

/** La mesa en el plano. Desde el rediseño del panel (spec 111) el tap sobre la
 *  mesa **es** el camino a la carga: no hay un detalle en el medio. */
function mesaEnPlano(container: HTMLElement) {
  const svg = container.querySelector('svg[viewBox="0 0 800 600"]')!;
  return Array.from(svg.querySelectorAll("g")).find((g) =>
    g.textContent?.trim().startsWith("1"),
  )!;
}

/** jsdom no expone `localStorage` acá; mismo stub que `use-sticky-filter.test.ts`. */
function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } satisfies Storage;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", fakeStorage());
  loadPedirCatalog.mockResolvedValue({ ok: false, error: "boom de red" });
});

describe("SalonDesktop · el catálogo del panel (spec 114)", () => {
  it("si el catálogo falla, el panel ofrece reintentar — y el reintento pide de nuevo", async () => {
    const user = userEvent.setup();
    const { container } = renderSalon();
    // El montaje ya pidió el catálogo (y falló).
    await vi.waitFor(() => expect(loadPedirCatalog).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.click(mesaEnPlano(container));
    });

    // El error se ve, y con salida: sin esto el encargado quedaba sin poder
    // cargar pedidos hasta recargar la página, sin que nada se lo dijera.
    const reintentar = await screen.findByRole("button", { name: /Reintentar/i });

    loadPedirCatalog.mockResolvedValue({
      ok: true,
      data: {
        businessName: "Golf",
        catalog: { superCategories: [], categories: [] },
        stationNameById: {},
        topProductIds: [],
        dailyMenus: [],
      },
    });
    await user.click(reintentar);

    // La clave: el reintento sale a la red de verdad.
    await vi.waitFor(() => expect(loadPedirCatalog).toHaveBeenCalledTimes(2));
  });
});
