import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// El form pega a varias server actions; acá sólo importa el teclado.
vi.mock("@/lib/admin/customers-actions", () => ({
  buscarClientes: async () => ({ ok: true, data: [] }),
}));
vi.mock("@/lib/reservations/booking-actions", () => ({
  createFlexibleReservation: async () => ({ ok: true, data: {} }),
  createReservationFromAdmin: async () => ({ ok: true, data: {} }),
}));

function servicio(name: string, opens_at: string, closes_at: string) {
  return {
    id: `s-${name}`,
    business_id: "b1",
    name,
    day_of_week: null,
    opens_at,
    closes_at,
    soft_capacity: null,
    floor_plan_id: null,
  };
}

vi.mock("@/lib/reservations/availability-actions", () => ({
  fetchReservationContext: async () => ({
    ok: true,
    data: {
      mode: "flexible",
      services: [
        servicio("Almuerzo", "12:00", "15:00"),
        servicio("Cena", "20:00", "23:00"),
      ],
    },
  }),
  fetchFlexibleAvailability: async () => ({
    ok: true,
    data: {
      freeTables: [],
      reservedCovers: 0,
      softCapacity: null,
      overCapacity: false,
    },
  }),
  fetchAvailability: async () => ({ ok: true, data: { slots: [] } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ReservaForm } from "./new-reservation-modal";

/**
 * Cargar una reserva es el flujo con más campos del panel y era 100% mouse
 * (spec 075, pedido de Juan 2026-08-03). Lo que se fija acá: los atajos de
 * Personas —los mismos que abrir mesa— y que la grilla de horarios se navegue
 * con las flechas en dos dimensiones.
 */

/**
 * El buscador de cliente se enfoca solo al abrir (spec 068, FR-002) pero lo
 * hace con un `setTimeout(0)`. Hay que dejarlo aterrizar antes de mover el
 * foco a mano, o el timer lo roba en medio del test.
 */
async function esperarAutofocus() {
  await waitFor(() =>
    expect(document.activeElement?.tagName).toBe("INPUT"),
  );
}

function renderForm() {
  render(
    <ReservaForm
      slug="demo"
      tables={[]}
      floorPlanId={null}
      onDone={vi.fn()}
      footerClassName="p-3"
    />,
  );
}

/**
 * Mueve la fecha a mañana: con la fecha de hoy el form esconde los horarios ya
 * pasados, así que la grilla dependería de la hora a la que corran los tests.
 */
async function fechaManana() {
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const input = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  fireEvent.change(input, { target: { value: manana } });
  await waitFor(() => expect(input.value).toBe(manana));
}

const personas = () =>
  screen
    .getByRole("button", { name: "Una persona más" })
    .parentElement!.querySelector(".tabular-nums")!.textContent;

const pararseEnPersonas = () =>
  screen.getByRole("button", { name: "Una persona más" }).focus();

const horarios = () =>
  screen.getAllByRole("button").filter((b) => /^\d{2}:\d{2}$/.test(b.textContent ?? ""));

describe("nueva reserva · teclado (spec 075)", () => {
  it("un dígito fija la cantidad de personas, como al abrir una mesa", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(personas()).toBe("2");
    await esperarAutofocus();
    // El foco arranca en el buscador de cliente (un INPUT): ahí el 6 se escribe.
    // Parado fuera de un campo, en cambio, es la cantidad.
    pararseEnPersonas();
    await user.keyboard("6");
    expect(personas()).toBe("6");
  });

  it("+ y − mueven la cantidad de a uno", async () => {
    const user = userEvent.setup();
    renderForm();

    await esperarAutofocus();
    pararseEnPersonas();
    await user.keyboard("+");
    expect(personas()).toBe("3");
    await user.keyboard("-");
    expect(personas()).toBe("2");
  });

  it("escribiendo el nombre del cliente, un dígito NO cambia las personas", async () => {
    const user = userEvent.setup();
    renderForm();

    const nombre = screen.getByLabelText(/Cliente/i);
    await user.click(nombre);
    await user.keyboard("Ana 4");

    expect(nombre).toHaveValue("Ana 4");
    expect(personas()).toBe("2");
  });

  it("los servicios se eligen con las flechas y Enter", async () => {
    const user = userEvent.setup();
    renderForm();

    const almuerzo = await screen.findByRole("button", { name: "Almuerzo" });
    await esperarAutofocus();
    almuerzo.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Cena" })).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(horarios().length).toBeGreaterThan(0));
  });

  it("la grilla de horarios se navega en dos dimensiones", async () => {
    const user = userEvent.setup();
    renderForm();

    await screen.findByRole("button", { name: "Almuerzo" });
    await esperarAutofocus();
    await fechaManana();
    await user.click(screen.getByRole("button", { name: "Almuerzo" }));
    await waitFor(() => expect(horarios().length).toBeGreaterThan(5));

    const grilla = horarios();
    grilla[0].focus();

    // → se mueve de a uno.
    await user.keyboard("{ArrowRight}");
    expect(grilla[1]).toHaveFocus();

    // ↓ baja una fila entera (4 columnas en jsdom, que no aplica el breakpoint sm).
    grilla[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(grilla[4]).toHaveFocus();
  });

  it("Enter sobre un horario lo elige", async () => {
    const user = userEvent.setup();
    renderForm();

    await screen.findByRole("button", { name: "Almuerzo" });
    await esperarAutofocus();
    await fechaManana();
    await user.click(screen.getByRole("button", { name: "Almuerzo" }));
    await waitFor(() => expect(horarios().length).toBeGreaterThan(0));

    const primero = horarios()[0];
    primero.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(horarios()[0].className).toContain("bg-blue-600");
    });
  });
});
