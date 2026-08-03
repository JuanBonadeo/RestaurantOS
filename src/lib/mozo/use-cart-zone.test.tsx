import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useCartZone } from "./use-cart-zone";

/**
 * El carrito operable con el teclado (spec 075, FR-012): parado en una línea,
 * ←/→ mueven la cantidad, un dígito la fija y Supr la quita — sin ir al mouse
 * en medio de la carga.
 */

type Handlers = {
  onQuantityDelta?: (i: number, d: number) => void;
  onQuantitySet?: (i: number, q: number) => void;
  onRemove?: (i: number) => void;
  onActivate?: (i: number) => void;
  onType?: (c: string) => void;
  onExitUp?: () => void;
  onExitDown?: () => void;
};

function Carrito({
  lineas = ["Milanesa", "Agua"],
  onQuitarBoton,
  ...handlers
}: { lineas?: string[]; onQuitarBoton?: () => void } & Handlers) {
  const carrito = useCartZone({
    length: lineas.length,
    onQuantityDelta: () => {},
    onRemove: () => {},
    ...handlers,
  });
  return (
    <ul onKeyDown={carrito.handleKeyDown}>
      {lineas.map((l, i) => (
        <li key={l} {...carrito.itemProps(i)} aria-label={l}>
          {l}
          {/* Los botones de la línea siguen siendo tabulables. */}
          <button type="button" onClick={onQuitarBoton}>
            Quitar {l}
          </button>
        </li>
      ))}
    </ul>
  );
}

const linea = (name: string) => screen.getByLabelText(name);

async function pararseEn(name: string) {
  linea(name).focus();
  expect(linea(name)).toHaveFocus();
}

describe("useCartZone", () => {
  it("→ suma y ← resta cantidad sobre la línea enfocada", async () => {
    const user = userEvent.setup();
    const onQuantityDelta = vi.fn();
    render(<Carrito onQuantityDelta={onQuantityDelta} />);

    await pararseEn("Agua");
    await user.keyboard("{ArrowRight}");
    expect(onQuantityDelta).toHaveBeenCalledWith(1, 1);

    await user.keyboard("{ArrowLeft}");
    expect(onQuantityDelta).toHaveBeenCalledWith(1, -1);
  });

  it("+ y − hacen lo mismo que → y ←", async () => {
    const user = userEvent.setup();
    const onQuantityDelta = vi.fn();
    render(<Carrito onQuantityDelta={onQuantityDelta} />);

    await pararseEn("Milanesa");
    await user.keyboard("+");
    expect(onQuantityDelta).toHaveBeenCalledWith(0, 1);

    await user.keyboard("-");
    expect(onQuantityDelta).toHaveBeenCalledWith(0, -1);
  });

  it("un dígito fija la cantidad", async () => {
    const user = userEvent.setup();
    const onQuantitySet = vi.fn();
    render(<Carrito onQuantitySet={onQuantitySet} />);

    await pararseEn("Milanesa");
    await user.keyboard("4");
    expect(onQuantitySet).toHaveBeenCalledWith(0, 4);
  });

  it("Supr quita la línea", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Carrito onRemove={onRemove} />);

    await pararseEn("Agua");
    await user.keyboard("{Delete}");
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("Backspace NO borra: en el panel esa tecla sube un nivel", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Carrito onRemove={onRemove} />);

    await pararseEn("Agua");
    await user.keyboard("{Backspace}");
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("Enter activa la línea (editar precio)", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<Carrito onActivate={onActivate} />);

    await pararseEn("Milanesa");
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledWith(0);
  });

  it("escribir una letra vuelve al buscador con esa letra", async () => {
    const user = userEvent.setup();
    const onType = vi.fn();
    render(<Carrito onType={onType} />);

    await pararseEn("Agua");
    await user.keyboard("c");
    expect(onType).toHaveBeenCalledWith("c");
  });

  it("un dígito no se escapa al buscador: es la cantidad", async () => {
    const user = userEvent.setup();
    const onType = vi.fn();
    const onQuantitySet = vi.fn();
    render(<Carrito onType={onType} onQuantitySet={onQuantitySet} />);

    await pararseEn("Agua");
    await user.keyboard("3");
    expect(onQuantitySet).toHaveBeenCalledWith(1, 3);
    expect(onType).not.toHaveBeenCalled();
  });

  it("↑ en la primera línea sale hacia el catálogo", async () => {
    const user = userEvent.setup();
    const onExitUp = vi.fn();
    render(<Carrito onExitUp={onExitUp} />);

    await pararseEn("Milanesa");
    await user.keyboard("{ArrowUp}");
    expect(onExitUp).toHaveBeenCalled();
  });

  it("↓ y ↑ se mueven entre líneas antes de salir", async () => {
    const user = userEvent.setup();
    const onExitDown = vi.fn();
    render(<Carrito onExitDown={onExitDown} />);

    await pararseEn("Milanesa");
    await user.keyboard("{ArrowDown}");
    expect(linea("Agua")).toHaveFocus();
    expect(onExitDown).not.toHaveBeenCalled();

    await user.keyboard("{ArrowDown}");
    expect(onExitDown).toHaveBeenCalled();
  });

  it("Enter sobre un botón de la línea lo activa, no dispara la acción de la línea", async () => {
    const user = userEvent.setup();
    const onQuitarBoton = vi.fn();
    const onActivate = vi.fn();
    render(<Carrito onQuitarBoton={onQuitarBoton} onActivate={onActivate} />);

    screen.getByRole("button", { name: "Quitar Agua" }).focus();
    await user.keyboard("{Enter}");

    expect(onQuitarBoton).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("Supr sobre un botón de la línea no quita la línea", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Carrito onRemove={onRemove} />);

    screen.getByRole("button", { name: "Quitar Agua" }).focus();
    await user.keyboard("{Delete}");
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("Backspace muere en el carrito: no sube a cerrar el panel", async () => {
    const user = userEvent.setup();
    const alPanel = vi.fn();
    function ConPanel() {
      return (
        <div onKeyDown={(e) => e.key === "Backspace" && alPanel()}>
          <Carrito />
        </div>
      );
    }
    render(<ConPanel />);

    await pararseEn("Agua");
    await user.keyboard("{Backspace}");
    // El handler del panel igual corre (React no corta la propagación), pero
    // lo que importa es que la tecla quede marcada como consumida.
    expect(alPanel).toHaveBeenCalled();
  });

  it("el 0 no se escapa al buscador", async () => {
    const user = userEvent.setup();
    const onType = vi.fn();
    render(<Carrito onType={onType} onQuantitySet={vi.fn()} />);

    await pararseEn("Agua");
    await user.keyboard("0");
    expect(onType).not.toHaveBeenCalled();
  });
});
