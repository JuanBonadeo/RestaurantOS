import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useRovingList } from "./use-roving-list";

/**
 * Dos zonas encadenadas, como en el panel de la operación: los "resultados" de
 * arriba y el "carrito" de abajo. Es el escenario que importa — que ↓ pasado el
 * último resultado entre al carrito y ↑ en la primera línea vuelva al último
 * resultado.
 */
function DosZonas({
  arriba = ["A1", "A2"],
  abajo = ["B1", "B2"],
  columns = 1,
}: {
  arriba?: string[];
  abajo?: string[];
  columns?: number;
}) {
  const zonaB = useRovingList<HTMLButtonElement>({
    length: abajo.length,
    onExitUp: () => zonaA.focusLast(),
  });
  const zonaA = useRovingList<HTMLButtonElement>({
    length: arriba.length,
    columns,
    onExitDown: () => zonaB.focusFirst(),
  });

  return (
    <>
      <ul onKeyDown={zonaA.handleKeyDown}>
        {arriba.map((label, i) => (
          <li key={label}>
            <button type="button" {...zonaA.itemProps(i)}>
              {label}
            </button>
          </li>
        ))}
      </ul>
      <ul onKeyDown={zonaB.handleKeyDown}>
        {abajo.map((label, i) => (
          <li key={label}>
            <button type="button" {...zonaB.itemProps(i)}>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

describe("useRovingList", () => {
  it("↓ y ↑ mueven el foco dentro de la zona", async () => {
    const user = userEvent.setup();
    render(<DosZonas />);

    await user.click(screen.getByRole("button", { name: "A1" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "A2" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "A1" })).toHaveFocus();
  });

  it("↓ pasado el último entra a la zona de abajo", async () => {
    const user = userEvent.setup();
    render(<DosZonas />);

    await user.click(screen.getByRole("button", { name: "A2" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "B1" })).toHaveFocus();
  });

  it("↑ en el primero de abajo vuelve al último de arriba", async () => {
    const user = userEvent.setup();
    render(<DosZonas />);

    await user.click(screen.getByRole("button", { name: "B1" }));
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "A2" })).toHaveFocus();
  });

  it("sin zona vecina, el borde no mueve el foco", async () => {
    const user = userEvent.setup();
    render(<DosZonas />);

    await user.click(screen.getByRole("button", { name: "A1" }));
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "A1" })).toHaveFocus();
  });

  it("una zona vacía es transparente: el foco la atraviesa", async () => {
    const user = userEvent.setup();
    render(<DosZonas abajo={[]} />);

    // Sin líneas en el carrito, ↓ en el último resultado no tiene a dónde ir:
    // el foco se queda en vez de perderse.
    await user.click(screen.getByRole("button", { name: "A2" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "A2" })).toHaveFocus();
  });

  it("Home y End van a los extremos de la zona", async () => {
    const user = userEvent.setup();
    render(<DosZonas arriba={["A1", "A2", "A3"]} />);

    await user.click(screen.getByRole("button", { name: "A2" }));
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "A3" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "A1" })).toHaveFocus();
  });

  it("en grilla, ↓ baja una fila y → se mueve de a uno", async () => {
    const user = userEvent.setup();
    render(<DosZonas arriba={["A1", "A2", "A3", "A4"]} columns={2} />);

    await user.click(screen.getByRole("button", { name: "A1" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "A3" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "A4" })).toHaveFocus();
  });

  it("solo el elemento activo queda en el orden de tabulación", async () => {
    const user = userEvent.setup();
    render(<DosZonas />);

    await user.click(screen.getByRole("button", { name: "A2" }));
    expect(screen.getByRole("button", { name: "A2" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("button", { name: "A1" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("el elemento activo se anuncia con aria-current", async () => {
    const user = userEvent.setup();
    render(<DosZonas />);

    await user.click(screen.getByRole("button", { name: "A2" }));
    expect(screen.getByRole("button", { name: "A2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "A1" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("no consume las teclas que no son de navegación", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    function Zona() {
      const zona = useRovingList<HTMLButtonElement>({ length: 1 });
      return (
        <ul
          onKeyDown={(e) => {
            if (!zona.handleKeyDown(e)) onKeyDown(e.key);
          }}
        >
          <button type="button" {...zona.itemProps(0)}>
            X
          </button>
        </ul>
      );
    }
    render(<Zona />);

    await user.click(screen.getByRole("button", { name: "X" }));
    await user.keyboard("a");
    expect(onKeyDown).toHaveBeenCalledWith("a");
  });
});
