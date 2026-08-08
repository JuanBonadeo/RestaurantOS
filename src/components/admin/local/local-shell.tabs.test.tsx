import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LocalShell } from "./local-shell";

/**
 * Spec 101 — el cambio de tab no toca la red.
 *
 * Los invariantes que se prueban acá son los que hacen que la tab se sienta
 * instantánea; si alguno se rompe volvemos al round-trip de ~30 queries por
 * click aunque la pantalla siga "andando".
 *
 * Los paneles se mockean: lo que se testea es el shell (conmutación + montaje),
 * no lo que cada tab dibuja adentro.
 */

const replace = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, refresh }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/components/admin/local/salon-desktop", () => ({
  SalonDesktop: () => <div data-testid="panel-salon">MESAS</div>,
}));
vi.mock("@/components/admin/local/comandas-kanban", () => ({
  ComandasKanban: () => <div data-testid="panel-comandas">COMANDAS</div>,
}));
vi.mock("@/components/admin/local/caja-admin-board", () => ({
  CajaAdminBoard: () => <div data-testid="panel-caja">CAJA</div>,
}));
vi.mock("@/components/admin/local/rendicion-mozos-tab", () => ({
  RendicionMozosTab: () => <div data-testid="panel-rendicion">RENDICION</div>,
}));
vi.mock("@/components/admin/local/fichaje-tab", () => ({
  FichajeTab: () => <div data-testid="panel-fichaje">FICHAJE</div>,
}));
vi.mock("@/components/admin/orders-realtime-board", () => ({
  OrdersRealtimeBoard: () => <div data-testid="panel-pedidos">PEDIDOS</div>,
}));
vi.mock("@/components/reservations/admin-day-list", () => ({
  AdminDayList: () => <div data-testid="panel-reservas">RESERVAS</div>,
}));

/**
 * Props del shell con las 7 promesas ya resueltas. Se arman **una sola vez por
 * test**: si se recrearan en cada render, cada `use()` volvería a suspender y
 * el keep-alive se vería roto sin estarlo.
 */
function shellProps() {
  return {
    slug: "golf",
    businessId: "b1",
    timezone: "America/Argentina/Buenos_Aires",
    currentUserId: "u1",
    role: "encargado",
    salones: [],
    salon: Promise.resolve({
      floorPlans: [],
      dineInOrders: [],
      reservations: [],
      mozos: [],
    }),
    comandas: Promise.resolve({
      initialComandas: [],
      stations: [],
      mozos: [],
      printAgentLastSeenAt: null,
    }),
    pedidos: Promise.resolve({
      initialOrders: [],
      scheduledSlots: [],
      marchLeadPickupMin: 0,
      marchLeadDeliveryMin: 0,
    }),
    caja: Promise.resolve({ cajas: [] }),
    rendicion: Promise.resolve({
      rendicionPendientes: [],
      rendicionHistorial: [],
      cajaAssignments: [],
      businessMembers: [],
    }),
    fichaje: Promise.resolve({ initialPresent: [], todaySummary: undefined }),
    reservas: Promise.resolve({
      date: "2026-08-06",
      rows: [],
      floorPlans: [],
      activeTables: [],
      mode: "estricto",
      services: [],
    }),
  } as unknown as React.ComponentProps<typeof LocalShell>;
}

/**
 * El render va DENTRO de un `act` awaiteado: cada tab lee su dato con
 * `use(promise)` y, montada fuera de act, la suspensión no se reanuda en este
 * entorno — el árbol se queda en los skeletons y no se ve ningún panel.
 */
async function shell(url = "/golf/admin/operacion") {
  window.history.replaceState(null, "", url);
  const props = shellProps();
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<LocalShell {...props} />);
  });
  return utils;
}

/**
 * Click en una tab, DENTRO de un `act` awaiteado.
 *
 * Hace falta para Comandas, la única tab **sin pill**: su promesa no la consumió
 * nadie durante el page-load, así que React la descubre recién cuando el panel
 * monta y esa suspensión sólo se reanuda si el act que la provocó se awaitea.
 * Las demás ya venían resueltas por su pill.
 */
async function clickTab(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  const boton = screen.getByRole("button", { name });
  await act(async () => {
    await user.click(boton);
  });
}

describe("LocalShell · tabs sin red (spec 101)", () => {
  it("cambiar de tab NO navega: la URL se escribe sin router.replace/push", async () => {
    const user = userEvent.setup();
    await shell();

    expect(screen.getByTestId("panel-salon")).toBeInTheDocument();
    await clickTab(user, /Caja/);

    expect(screen.getByTestId("panel-caja")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?tab=caja");
  });

  it("keep-alive: la tab que se deja NO se desmonta (el realtime sigue vivo)", async () => {
    const user = userEvent.setup();
    const { container } = await shell();

    const mesas = screen.getByTestId("panel-salon");
    await clickTab(user, /Comandas/);

    expect(screen.getByTestId("panel-comandas")).toBeInTheDocument();
    // Mesas sigue en el DOM y es el MISMO nodo (no se remontó), pero oculto.
    expect(screen.getByTestId("panel-salon")).toBe(mesas);
    expect(container.querySelector(".hidden")?.contains(mesas)).toBe(true);
  });

  it("una tab que nunca se visitó no se monta (montaje lazy)", async () => {
    const user = userEvent.setup();
    await shell();

    expect(screen.queryByTestId("panel-rendicion")).toBeNull();
    expect(screen.queryByTestId("panel-fichaje")).toBeNull();

    await clickTab(user, /Fichaje/);
    expect(screen.getByTestId("panel-fichaje")).toBeInTheDocument();
    // Entrar a Fichaje no arrastró a Rendición.
    expect(screen.queryByTestId("panel-rendicion")).toBeNull();
  });

  it("el deep-link ?tab=caja abre en Caja sin montar el resto", async () => {
    await shell("/golf/admin/operacion?tab=caja");

    expect(screen.getByTestId("panel-caja")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-salon")).toBeNull();
  });

  it("la primera entrada a Rendición revalida (no muestra plata del page-load)", async () => {
    const user = userEvent.setup();
    refresh.mockClear();
    await shell();
    expect(refresh).not.toHaveBeenCalled();

    // Montaje lazy: el panel monta YA activo. Sin la guarda con `onMount`, esta
    // primera entrada —la que más importa— se quedaba con el snapshot inicial.
    await clickTab(user, /Rendición/);
    expect(screen.getByTestId("panel-rendicion")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Y vuelve a revalidar en cada re-entrada, no sólo la primera.
    await clickTab(user, /Mesas/);
    await clickTab(user, /Rendición/);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("Reservas también revalida al entrar (no tiene realtime propio)", async () => {
    const user = userEvent.setup();
    refresh.mockClear();
    await shell();

    await clickTab(user, /Reservas/);
    expect(screen.getByTestId("panel-reservas")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("volver a la tab default deja la URL sin ?tab (canónica)", async () => {
    const user = userEvent.setup();
    await shell("/golf/admin/operacion?tab=caja");

    await clickTab(user, /Mesas/);
    expect(screen.getByTestId("panel-salon")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
