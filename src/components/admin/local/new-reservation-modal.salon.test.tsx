import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { FloorTable } from "@/lib/reservations/types";

/**
 * Spec 144 — la reserva cargada desde la tab de Reservas elige **salón**, y la
 * mesa se toca en el plano.
 *
 * Lo que se fija acá: sin salón no se crea nada (el cupo del servicio se cuenta
 * por zona, así que una reserva sin zona no la cuenta nadie), la consulta de
 * disponibilidad viaja con el salón elegido, y el plano deja elegir sólo lo que
 * el motor da por libre.
 */

const acciones = vi.hoisted(() => ({
  fetchFlexibleAvailability: vi.fn(),
  createFlexibleReservation: vi.fn(),
}));

vi.mock("@/lib/admin/customers-actions", () => ({
  buscarClientes: async () => ({ ok: true, data: [] }),
}));
vi.mock("@/lib/reservations/booking-actions", () => ({
  createFlexibleReservation: acciones.createFlexibleReservation,
  createReservationFromAdmin: async () => ({ ok: true, data: {} }),
}));
vi.mock("@/lib/reservations/availability-actions", () => ({
  fetchReservationContext: async () => ({
    ok: true,
    data: {
      mode: "flexible",
      services: [
        {
          id: "s1",
          business_id: "b1",
          name: "Cena",
          day_of_week: null,
          opens_at: "20:00",
          closes_at: "23:00",
          soft_capacity: 100,
          floor_plan_id: null,
        },
      ],
    },
  }),
  fetchFlexibleAvailability: acciones.fetchFlexibleAvailability,
  fetchAvailability: async () => ({ ok: true, data: [] }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ReservaForm } from "./new-reservation-modal";

function mesa(over: Partial<FloorTable> & { id: string; floor_plan_id: string }): FloorTable {
  return {
    id: over.id,
    floor_plan_id: over.floor_plan_id,
    label: over.label ?? over.id,
    seats: over.seats ?? 4,
    shape: "square",
    x: over.x ?? 0,
    y: 0,
    width: 60,
    height: 60,
    rotation: 0,
    status: over.status ?? "active",
    created_at: "2026-01-01T00:00:00Z",
    is_bar: over.is_bar ?? false,
  };
}

const SALONES = [
  { id: "fp1", name: "Salón principal" },
  { id: "fp2", name: "Terraza" },
];

const MESAS = [
  mesa({ id: "m1", floor_plan_id: "fp1", label: "1" }),
  mesa({ id: "m2", floor_plan_id: "fp1", label: "2", x: 100 }),
  mesa({ id: "m9", floor_plan_id: "fp2", label: "9" }),
];

/** Sólo la 1 está libre: la 2 ya tiene reserva en ese servicio. */
function disponibilidad() {
  return {
    ok: true as const,
    data: {
      freeTables: [{ id: "m1", label: "1", seats: 4 }],
      reservedCovers: 10,
      softCapacity: 100,
      overCapacity: false,
      outOfTables: false,
      available: true,
    },
  };
}

beforeEach(() => {
  acciones.fetchFlexibleAvailability.mockReset();
  acciones.fetchFlexibleAvailability.mockResolvedValue(disponibilidad());
  acciones.createFlexibleReservation.mockReset();
  acciones.createFlexibleReservation.mockResolvedValue({ ok: true, data: { id: "r1" } });
});

function renderForm(props: Partial<React.ComponentProps<typeof ReservaForm>> = {}) {
  render(
    <ReservaForm
      slug="demo"
      tables={MESAS}
      floorPlanId={null}
      floorPlans={SALONES}
      onDone={vi.fn()}
      footerClassName="p-3"
      {...props}
    />,
  );
}

const crear = () => screen.getByRole("button", { name: /Crear reserva/i });

/** Mañana: con la fecha de hoy el form esconde los horarios ya pasados. */
async function fechaManana() {
  const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const input = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  fireEvent.change(input, { target: { value: manana } });
  await waitFor(() => expect(input.value).toBe(manana));
}

async function completarReserva(user: ReturnType<typeof userEvent.setup>, salon = "Salón principal") {
  await user.type(screen.getByLabelText(/Cliente/i), "Ana");
  await fechaManana();
  await user.click(await screen.findByRole("button", { name: salon }));
  await user.click(await screen.findByRole("button", { name: "20:00" }));
}

describe("nueva reserva · salón y mesa en el plano (spec 144)", () => {
  it("con más de un salón no se crea nada hasta elegir uno", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Cliente/i), "Ana");
    await fechaManana();
    await user.click(await screen.findByRole("button", { name: "20:00" }));
    expect(crear()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Salón principal" }));
    await waitFor(() => expect(crear()).toBeEnabled());
  });

  it("la disponibilidad se pide para el salón elegido", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Terraza" }));
    await waitFor(() =>
      expect(acciones.fetchFlexibleAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ floor_plan_id: "fp2", service: "Cena" }),
      ),
    );
  });

  it("sin mesa, la reserva se guarda igual CON salón (es lo que cuenta el cupo)", async () => {
    const user = userEvent.setup();
    renderForm();

    await completarReserva(user);
    await user.click(crear());

    await waitFor(() =>
      expect(acciones.createFlexibleReservation).toHaveBeenCalledWith(
        expect.objectContaining({ floor_plan_id: "fp1", customer_name: "Ana" }),
      ),
    );
    expect(acciones.createFlexibleReservation.mock.calls[0][0]).not.toHaveProperty("table_id");
  });

  it("la mesa se elige tocándola en el plano del salón", async () => {
    const user = userEvent.setup();
    renderForm();

    await completarReserva(user);
    await user.click(screen.getByRole("button", { name: /Elegir mesa en el plano/i }));

    // Sólo las mesas del salón elegido: la 9 es de la Terraza.
    expect(screen.queryByRole("button", { name: /^Mesa 9,/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Mesa 1, 4 lugares, libre/ }));
    expect(screen.getByText("Mesa 1")).toBeInTheDocument();

    await user.click(crear());
    await waitFor(() =>
      expect(acciones.createFlexibleReservation).toHaveBeenCalledWith(
        expect.objectContaining({ table_id: "m1", floor_plan_id: "fp1" }),
      ),
    );
  });

  it("una mesa que el motor no da por libre no se puede elegir", async () => {
    const user = userEvent.setup();
    renderForm();

    await completarReserva(user);
    await user.click(screen.getByRole("button", { name: /Elegir mesa en el plano/i }));

    const ocupada = screen.getByRole("button", { name: /^Mesa 2, 4 lugares, ocupada/ });
    await user.click(ocupada);
    expect(screen.queryByText("Mesa 2")).toBeNull();
  });

  it("con un solo salón no se pregunta nada", async () => {
    const user = userEvent.setup();
    renderForm({ floorPlans: [SALONES[0]] });

    expect(screen.queryByText("Salón *")).toBeNull();
    await user.type(screen.getByLabelText(/Cliente/i), "Ana");
    await fechaManana();
    await user.click(await screen.findByRole("button", { name: "20:00" }));
    await waitFor(() => expect(crear()).toBeEnabled());

    await user.click(crear());
    await waitFor(() =>
      expect(acciones.createFlexibleReservation).toHaveBeenCalledWith(
        expect.objectContaining({ floor_plan_id: "fp1" }),
      ),
    );
  });
});
