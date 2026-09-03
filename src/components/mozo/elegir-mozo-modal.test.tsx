import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

const transferTable = vi.fn(async () => ({ ok: true as const, data: {} }));
const assignMozoToTable = vi.fn(async () => ({ ok: true as const, data: {} }));
vi.mock("@/lib/mozo/actions", () => ({
  transferTable: (...args: unknown[]) => transferTable(...(args as [])),
  assignMozoToTable: (...args: unknown[]) => assignMozoToTable(...(args as [])),
}));

import type { MozoMember } from "@/lib/mozo/queries";

import { ElegirMozoModal } from "./elegir-mozo-modal";

/**
 * El modal único de elegir mozo (spec 146 · A). Hereda lo que probaba
 * `transfer-table-modal.test.tsx` —el buscador de la spec 079 y su regla dura:
 * no se transfiere a alguien que quedó fuera de la búsqueda— y le suma los dos
 * modos y el teclado.
 */
const equipo: MozoMember[] = [
  { user_id: "u1", full_name: "Juan Pérez", role: "mozo" },
  { user_id: "u2", full_name: "Román Gómez", role: "mozo" },
  { user_id: "u3", full_name: "Ana Torres", role: "mozo" },
  { user_id: "u4", full_name: "Carla Díaz", role: "mozo" },
  { user_id: "u5", full_name: "Diego Sosa", role: "mozo" },
  { user_id: "u6", full_name: "Eva Ruiz", role: "encargado" },
  { user_id: "u7", full_name: "Fabián Molina", role: "mozo" },
  { user_id: "u8", full_name: "Gastón Vera", role: "admin" },
];

function renderModal({
  modo = "transferir" as "asignar" | "transferir",
  mozos = equipo,
  currentMozoId = null as string | null,
  onClose = () => {},
  onSuccess = () => {},
} = {}) {
  return render(
    <ElegirMozoModal
      modo={modo}
      tableId="t1"
      tableLabel="5"
      currentMozoId={currentMozoId}
      mozos={mozos}
      businessSlug="golf-jcr"
      conTeclado
      onClose={onClose}
      onSuccess={onSuccess}
    />,
  );
}

const buscador = () => screen.getByRole("textbox", { name: /buscar mozo/i });
const cta = () => screen.getByRole("button", { name: /transferir mozo/i });

beforeEach(() => {
  transferTable.mockClear();
  assignMozoToTable.mockClear();
  toastSuccess.mockClear();
});

describe("elegir mozo · modo asignar (spec 146)", () => {
  it("elegir al mozo lo asigna en un solo paso, sin motivo ni CTA", () => {
    const onSuccess = vi.fn();
    renderModal({ modo: "asignar", mozos: equipo.slice(0, 3), onSuccess });

    expect(screen.getByText(/asignar mozo/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /motivo/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /transferir mozo/i }),
    ).toBeNull();

    fireEvent.click(screen.getByText("Ana Torres"));
    expect(assignMozoToTable).toHaveBeenCalledWith("t1", "u3", "golf-jcr");
    expect(transferTable).not.toHaveBeenCalled();
  });

  it("se maneja con las flechitas y Enter", async () => {
    const user = userEvent.setup();
    renderModal({ modo: "asignar", mozos: equipo.slice(0, 3) });

    // El foco arranca en el buscador; ↓ entra a la lista.
    expect(document.activeElement).toBe(buscador());
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("Juan Pérez");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("Román Gómez");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toHaveTextContent("Juan Pérez");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(assignMozoToTable).toHaveBeenCalledWith("t1", "u3", "golf-jcr");
  });

  it("tipear filtra, y Enter en el buscador se queda con el primero", async () => {
    const user = userEvent.setup();
    renderModal({ modo: "asignar", mozos: equipo.slice(0, 3) });

    await user.keyboard("roman");
    expect(screen.queryByText("Juan Pérez")).toBeNull();
    await user.keyboard("{Enter}");

    expect(assignMozoToTable).toHaveBeenCalledWith("t1", "u2", "golf-jcr");
  });

  it("no avisa por toast: el cambio ya se ve en la mesa y en el plano", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderModal({ modo: "asignar", mozos: equipo.slice(0, 3), onSuccess });

    await user.click(screen.getByText("Ana Torres"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("u3"));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("Esc cierra sin tocar nada", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ modo: "asignar", mozos: equipo.slice(0, 3), onClose });
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(assignMozoToTable).not.toHaveBeenCalled();
  });
});

describe("elegir mozo · modo transferir (spec 079)", () => {
  it("elegir marca, y transferir lo manda con el motivo", () => {
    renderModal({ modo: "transferir", mozos: equipo.slice(0, 4) });
    fireEvent.click(screen.getByText("Carla Díaz"));
    // Elegir NO transfiere: hay motivo que escribir y notificación al destino.
    expect(transferTable).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: /motivo/i }), {
      target: { value: "cambio de turno" },
    });
    fireEvent.click(cta());
    expect(transferTable).toHaveBeenCalledWith(
      "t1",
      "u4",
      "golf-jcr",
      "cambio de turno",
    );
  });

  it("con teclado el buscador está siempre, aunque el equipo sea chico", () => {
    renderModal({ mozos: equipo.slice(0, 4) });
    expect(buscador()).toBeInTheDocument();
    expect(screen.getByText("Carla Díaz")).toBeInTheDocument();
  });

  it("en el teléfono, con equipo chico, sigue sin haber buscador", () => {
    // Spec 079 · FR-002: ahí el modal es un bottom sheet y el input empuja la
    // lista hacia abajo, justo la que venís a mirar.
    render(
      <ElegirMozoModal
        modo="transferir"
        tableId="t1"
        tableLabel="5"
        currentMozoId={null}
        mozos={equipo.slice(0, 4)}
        businessSlug="golf-jcr"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    expect(
      screen.queryByRole("textbox", { name: /buscar mozo/i }),
    ).not.toBeInTheDocument();
  });

  it("con equipo grande aparece y filtra por nombre", () => {
    renderModal();
    fireEvent.change(buscador(), { target: { value: "roman" } });
    expect(screen.getByText("Román Gómez")).toBeInTheDocument();
    expect(screen.queryByText("Juan Pérez")).not.toBeInTheDocument();
  });

  it("↓ desde el buscador entra a la lista", async () => {
    const user = userEvent.setup();
    renderModal();
    // Con buscador, el foco arranca ahí: se entra tipeando.
    expect(document.activeElement).toBe(buscador());
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("Juan Pérez");
  });

  it("sin resultados avisa en vez de dejar la lista vacía", () => {
    renderModal();
    fireEvent.change(buscador(), { target: { value: "zzz" } });
    expect(screen.getByText(/ningún mozo coincide/i)).toBeInTheDocument();
  });

  it("no transfiere a un mozo que la búsqueda dejó fuera de pantalla", () => {
    renderModal();
    fireEvent.click(screen.getByText("Juan Pérez"));
    expect(cta()).not.toBeDisabled();

    fireEvent.change(buscador(), { target: { value: "ana" } });
    expect(screen.queryByText("Juan Pérez")).not.toBeInTheDocument();
    expect(cta()).toBeDisabled();

    fireEvent.click(cta());
    expect(transferTable).not.toHaveBeenCalled();
  });

  it("al limpiar la búsqueda vuelve a estar elegido el de antes", () => {
    renderModal();
    fireEvent.click(screen.getByText("Juan Pérez"));
    fireEvent.change(buscador(), { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: /limpiar/i }));

    expect(cta()).not.toBeDisabled();
    fireEvent.click(cta());
    expect(transferTable).toHaveBeenCalledWith("t1", "u1", "golf-jcr", undefined);
  });

  it("el mozo que ya tiene la mesa no está entre los candidatos", () => {
    renderModal({ mozos: equipo.slice(0, 4), currentMozoId: "u1" });
    expect(screen.queryByText("Juan Pérez")).not.toBeInTheDocument();
    expect(screen.getByText("Ana Torres")).toBeInTheDocument();
  });
});
