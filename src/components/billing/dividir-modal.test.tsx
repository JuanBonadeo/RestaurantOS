import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DividirModal } from "./dividir-modal";

// Las server actions de división son "use server"; las mockeamos para poder
// montar el modal en jsdom sin tocar Supabase.
vi.mock("@/lib/billing/cuenta-actions", () => ({
  dividirPorPersonas: vi.fn(),
  dividirPorItems: vi.fn(),
  dividirPorComensal: vi.fn(),
  dividirPorMonto: vi.fn(),
}));

function renderModal(isPending: boolean) {
  return render(
    <DividirModal
      open
      onOpenChange={() => {}}
      items={[]}
      orderId="ord-1"
      slug="demo"
      totalCents={30_000}
      parentStartTransition={(cb) => void cb()}
      isPending={isPending}
      onDone={() => {}}
    />,
  );
}

describe("<DividirModal /> — no re-enviar mientras procesa", () => {
  // Regresión del bug 2026-06-19: si la división seguía en vuelo (y el refresh
  // que trae los splits no terminó), el flujo permitía avanzar al cobro y se
  // armaba un pago único. El botón debe bloquearse mientras `isPending`.
  it("deshabilita 'Confirmar división' mientras hay una operación en vuelo", () => {
    renderModal(true);
    expect(
      screen.getByRole("button", { name: /dividiendo|confirmar división/i }),
    ).toBeDisabled();
  });

  it("habilita 'Confirmar división' cuando no hay operación en vuelo", () => {
    renderModal(false);
    expect(
      screen.getByRole("button", { name: /dividiendo|confirmar división/i }),
    ).toBeEnabled();
  });
});
