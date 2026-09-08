import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/admin/welcome-actions", () => ({
  completeWelcome: async () => ({ ok: true, data: {} }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
}));

import { WelcomeForm } from "./welcome-form";

const EMAIL = "ana.perez@golf-jcr.internal";

function pintar(pin: string | null) {
  return render(
    <WelcomeForm
      businessName="Golf"
      businessSlug="golf-jcr"
      businessLogoUrl={null}
      email={EMAIL}
      displayName="Ana"
      destino="/golf-jcr/admin/ayuda/el-turno"
      pin={pin}
    />,
  );
}

describe("WelcomeForm · con qué entra a partir de mañana (spec 171 · D1)", () => {
  it("dice el PIN, y también el mail", () => {
    // Es la única pantalla que la persona mira con toda la atención puesta en
    // "cómo entro mañana". Si acá sólo ve el email sintético de 30 caracteres,
    // la spec 142 no le sirvió de nada.
    pintar("1234");
    expect(screen.getByText("1234")).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  it("sin PIN cargado no inventa nada: queda el mail solo", () => {
    const { container } = pintar(null);
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/PIN/);
  });
});
