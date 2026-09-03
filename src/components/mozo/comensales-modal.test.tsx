import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ComensalesModal } from "./comensales-modal";

/**
 * El segundo paso de la apertura de la mesa (spec 146, fast-follow 2).
 *
 * Lo que fija este archivo es el pedido textual de Juan: *"si pone 4, que pase
 * a la parte de adicionar productos, no que tenga que poner 4 más Enter, son
 * pasos extras que no queremos"*.
 */
function renderModal({
  valor = 2,
  onConfirmar = () => {},
  onCerrar = () => {},
} = {}) {
  return render(
    <ComensalesModal
      tableLabel="R02"
      valorInicial={valor}
      onConfirmar={onConfirmar}
      onCerrar={onCerrar}
    />,
  );
}

describe("modal de comensales · teclado (spec 146)", () => {
  it("un dígito confirma y cierra: sin Enter de más", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    const onCerrar = vi.fn();
    renderModal({ onConfirmar, onCerrar });

    await user.keyboard("4");

    expect(onConfirmar).toHaveBeenCalledWith(4);
    expect(onCerrar).toHaveBeenCalled();
  });

  it("+ y − ajustan sin cerrar: así se carga una mesa de 12", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    const onCerrar = vi.fn();
    renderModal({ valor: 9, onConfirmar, onCerrar });

    await user.keyboard("+++");
    expect(onCerrar).not.toHaveBeenCalled();
    expect(screen.getByText("12")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(onConfirmar).toHaveBeenCalledWith(12);
    expect(onCerrar).toHaveBeenCalled();
  });

  it("las flechas también mueven el número", async () => {
    const user = userEvent.setup();
    renderModal({ valor: 4 });
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("Esc cierra sin tocar la mesa", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    const onCerrar = vi.fn();
    renderModal({ onConfirmar, onCerrar });

    await user.keyboard("{Escape}");

    expect(onCerrar).toHaveBeenCalled();
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("con el dedo: tocar un chip confirma igual que el dígito", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    const onCerrar = vi.fn();
    renderModal({ onConfirmar, onCerrar });

    await user.click(screen.getByRole("button", { name: "6 personas" }));

    expect(onConfirmar).toHaveBeenCalledWith(6);
    expect(onCerrar).toHaveBeenCalled();
  });

  it("los atajos del navegador no le mueven el número", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();
    renderModal({ valor: 4, onConfirmar });

    // Ctrl+− / Ctrl+= son el zoom del navegador, no comensales.
    await user.keyboard("{Control>}-{/Control}{Control>}={/Control}");
    expect(screen.getByRole("button", { name: "4 personas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Y ⌘Enter tampoco confirma: es «enviar la comanda» del panel de abajo.
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("el Tab no se escapa del modal: las teclas siguen siendo suyas", async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = screen.getByRole("dialog");

    for (let i = 0; i < 12; i++) await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("es un diálogo de verdad: las teclas son suyas, no del panel de abajo", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // El foco arranca adentro, o los dígitos no llegarían.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
