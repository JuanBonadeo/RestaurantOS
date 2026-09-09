import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ItemLibreModal } from "./item-libre-modal";

function renderModal(props: Partial<React.ComponentProps<typeof ItemLibreModal>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ItemLibreModal
      nombreSugerido=""
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose };
}

describe("spec 174 · ItemLibreModal", () => {
  it("arranca con lo que se tipeó en el buscador ya puesto como nombre", () => {
    renderModal({ nombreSugerido: "Torta del cliente" });
    expect(screen.getByLabelText(/nombre/i)).toHaveValue("Torta del cliente");
  });

  it("devuelve nombre, precio en centavos y cantidad", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({ nombreSugerido: "Menú sanatorio" });

    await user.type(screen.getByLabelText(/precio/i), "3500");
    await user.click(screen.getByRole("button", { name: /agregar/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Menú sanatorio",
      unit_price_cents: 350000,
      quantity: 1,
    });
  });

  it("no deja agregar sin nombre", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();
    await user.type(screen.getByLabelText(/precio/i), "1000");
    await user.click(screen.getByRole("button", { name: /agregar/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("acepta $0 — la cortesía que igual se lista en el ticket", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({ nombreSugerido: "Torta del cliente" });
    await user.type(screen.getByLabelText(/precio/i), "0");
    await user.click(screen.getByRole("button", { name: /agregar/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ unit_price_cents: 0 }),
    );
  });

  it("entiende el precio con coma y con punto de miles (issue #269)", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal({ nombreSugerido: "Cubierto" });
    await user.type(screen.getByLabelText(/precio/i), "18.500");
    await user.click(screen.getByRole("button", { name: /agregar/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ unit_price_cents: 1850000 }),
    );
  });

  it("dice que no va a cocina — es la mitad del contrato de la feature", () => {
    renderModal();
    expect(screen.getByText(/no va a cocina/i)).toBeInTheDocument();
  });

  it("Enter en el nombre no cierra nada a medias", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();
    await user.type(screen.getByLabelText(/nombre/i), "Torta{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
