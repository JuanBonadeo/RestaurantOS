import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PersonasChips } from "./datos-mesa";
import { guardarDatosMesa } from "@/lib/mozo/datos-mesa";

vi.mock("@/lib/mozo/datos-mesa", () => ({
  guardarDatosMesa: vi.fn(async () => ({ ok: true as const, data: {} })),
}));

/**
 * Personas no es plata: el tap se ve al instante y el guardado va por atrás.
 *
 * Lo que estos tests cuidan es el reporte de Juan —«se bloquea todo al cambiar
 * el número»—: los ocho controles quedaban `disabled` esperando al server.
 */

function renderChips(persistir = true) {
  const onChange = vi.fn();
  const utils = render(
    <PersonasChips
      slug="golf"
      tableId="00000000-0000-0000-0000-000000000001"
      value={2}
      onChange={onChange}
      persistir={persistir}
    />,
  );
  return { ...utils, onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PersonasChips (spec 111)", () => {
  it("ningún control queda deshabilitado al tocar", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderChips();

    await user.click(screen.getByRole("button", { name: "4 personas" }));

    // Antes, este tap deshabilitaba los ocho botones hasta que volvía el
    // server: si eran 6, había que esperar para corregir.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(
        screen.getByRole("button", { name: `${n} personas` }),
      ).toBeEnabled();
    }
    expect(
      screen.getByRole("button", { name: "Una persona más" }),
    ).toBeEnabled();
  });

  it("avisa el cambio al toque, sin esperar al server", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onChange } = renderChips();

    await user.click(screen.getByRole("button", { name: "5 personas" }));

    expect(onChange).toHaveBeenCalledWith(5);
    // Todavía no se escribió nada: el guardado espera a que deje de tocar.
    expect(guardarDatosMesa).not.toHaveBeenCalled();
  });

  it("cuatro taps seguidos son UNA sola escritura, con el último valor", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderChips();

    for (const n of [3, 4, 5, 6]) {
      await user.click(screen.getByRole("button", { name: `${n} personas` }));
    }
    await vi.advanceTimersByTimeAsync(800);

    expect(guardarDatosMesa).toHaveBeenCalledTimes(1);
    expect(guardarDatosMesa).toHaveBeenCalledWith(
      expect.objectContaining({ partySize: 6 }),
    );
  });

  it("sin orden abierta no escribe: el dato viaja con el primer envío", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { onChange } = renderChips(false);

    await user.click(screen.getByRole("button", { name: "4 personas" }));
    await vi.advanceTimersByTimeAsync(800);

    expect(onChange).toHaveBeenCalledWith(4);
    expect(guardarDatosMesa).not.toHaveBeenCalled();
  });

  it("si el panel se cierra con el guardado en el aire, se manda igual", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderChips();

    await user.click(screen.getByRole("button", { name: "6 personas" }));
    unmount();

    expect(guardarDatosMesa).toHaveBeenCalledWith(
      expect.objectContaining({ partySize: 6 }),
    );
  });
});
