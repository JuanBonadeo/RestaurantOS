import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RolePicker } from "./role-picker";

const updateMemberRole = vi.fn();
const refresh = vi.fn();

// Server action "use server": la mockeamos para montar el picker en jsdom.
vi.mock("@/lib/admin/members-actions", () => ({
  updateMemberRole: (...args: unknown[]) => updateMemberRole(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

function renderPicker(editable = true, role: "mozo" | "personal" = "personal") {
  return render(
    <RolePicker
      slug="golf-jcr"
      userId="user-1"
      role={role}
      displayName="Sheila Tonso"
      editable={editable}
    />,
  );
}

describe("<RolePicker />", () => {
  beforeEach(() => {
    updateMemberRole.mockReset();
    refresh.mockReset();
    toastWarning.mockReset();
  });

  it("sin permisos de gestión muestra el rol como badge estático", () => {
    renderPicker(false);
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cambiar rol/i }),
    ).not.toBeInTheDocument();
  });

  it("cambia el rol a Encargado y refresca la vista", async () => {
    const user = userEvent.setup();
    updateMemberRole.mockResolvedValue({
      ok: true,
      data: { role: "encargado", needsCredentials: false },
    });
    renderPicker();

    await user.click(screen.getByRole("button", { name: /cambiar rol/i }));
    await user.click(
      screen.getByText(/Salón, reservas, apertura y cierre de caja/i),
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(updateMemberRole).toHaveBeenCalledWith({
        business_slug: "golf-jcr",
        user_id: "user-1",
        role: "encargado",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("avisa cuando el promovido no tiene credenciales para entrar al sistema", async () => {
    const user = userEvent.setup();
    updateMemberRole.mockResolvedValue({
      ok: true,
      data: { role: "encargado", needsCredentials: true },
    });
    renderPicker();

    await user.click(screen.getByRole("button", { name: /cambiar rol/i }));
    await user.click(
      screen.getByText(/Salón, reservas, apertura y cierre de caja/i),
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(toastWarning).toHaveBeenCalledWith(
        expect.stringMatching(/no va a poder entrar al sistema/i),
        expect.anything(),
      ),
    );
  });

  it("no llama a la action si el rol elegido es el que ya tenía", async () => {
    const user = userEvent.setup();
    renderPicker(true, "mozo");

    await user.click(screen.getByRole("button", { name: /cambiar rol/i }));
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(updateMemberRole).not.toHaveBeenCalled();
  });
});
