import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transferTable = vi.fn(async () => ({ ok: true as const, data: {} }));
vi.mock("@/lib/mozo/actions", () => ({
  transferTable: (...args: unknown[]) => transferTable(...(args as [])),
}));

import type { MozoMember } from "@/lib/mozo/queries";

import { TransferTableModal } from "./transfer-table-modal";

/**
 * Buscador de mozos del modal Transferir mozo (spec 079).
 *
 * Lo que más importa acá no es el filtro —eso se testea puro en
 * `lib/mozo/mozo-search.test.ts`— sino que no se pueda transferir a alguien que
 * quedó fuera de la búsqueda: la mesa cambia de dueño y le llega notificación
 * al destino, así que un destino invisible es un error que se comete sin verlo.
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

function renderModal(mozos: MozoMember[], currentMozoId: string | null = null) {
  return render(
    <TransferTableModal
      tableId="t1"
      tableLabel="5"
      currentMozoId={currentMozoId}
      mozos={mozos}
      businessSlug="golf-jcr"
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
}

const buscador = () => screen.getByRole("textbox", { name: /buscar mozo/i });
const cta = () => screen.getByRole("button", { name: /transferir mozo/i });

beforeEach(() => {
  transferTable.mockClear();
});

describe("transferir mozo · buscador (spec 079)", () => {
  it("con equipo chico no hay buscador", () => {
    renderModal(equipo.slice(0, 4));
    expect(
      screen.queryByRole("textbox", { name: /buscar mozo/i }),
    ).not.toBeInTheDocument();
    // Y siguen estando todos los candidatos.
    expect(screen.getByText("Carla Díaz")).toBeInTheDocument();
  });

  it("con equipo grande aparece y filtra por nombre", () => {
    renderModal(equipo);
    fireEvent.change(buscador(), { target: { value: "roman" } });
    expect(screen.getByText("Román Gómez")).toBeInTheDocument();
    expect(screen.queryByText("Juan Pérez")).not.toBeInTheDocument();
  });

  it("sin resultados avisa en vez de dejar la lista vacía", () => {
    renderModal(equipo);
    fireEvent.change(buscador(), { target: { value: "zzz" } });
    expect(screen.getByText(/ningún mozo coincide/i)).toBeInTheDocument();
  });

  it("no transfiere a un mozo que la búsqueda dejó fuera de pantalla", () => {
    renderModal(equipo);
    // Elijo a Juan…
    fireEvent.click(screen.getByText("Juan Pérez"));
    expect(cta()).not.toBeDisabled();

    // …y después busco otra cosa: Juan ya no está en pantalla.
    fireEvent.change(buscador(), { target: { value: "ana" } });
    expect(screen.queryByText("Juan Pérez")).not.toBeInTheDocument();
    expect(cta()).toBeDisabled();

    fireEvent.click(cta());
    expect(transferTable).not.toHaveBeenCalled();
  });

  it("al limpiar la búsqueda vuelve a estar elegido el de antes", () => {
    renderModal(equipo);
    fireEvent.click(screen.getByText("Juan Pérez"));
    fireEvent.change(buscador(), { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: /limpiar/i }));

    expect(cta()).not.toBeDisabled();
    fireEvent.click(cta());
    expect(transferTable).toHaveBeenCalledWith(
      "t1",
      "u1",
      "golf-jcr",
      undefined,
    );
  });

  it("transfiere al que se eligió dentro de la búsqueda", () => {
    renderModal(equipo);
    fireEvent.change(buscador(), { target: { value: "vera" } });
    fireEvent.click(screen.getByText("Gastón Vera"));
    fireEvent.click(cta());
    expect(transferTable).toHaveBeenCalledWith(
      "t1",
      "u8",
      "golf-jcr",
      undefined,
    );
  });
});
