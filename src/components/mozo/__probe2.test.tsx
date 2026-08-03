import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/customers-actions", () => ({
  buscarClientes: async () => ({
    ok: true,
    data: [
      { id: "c1", name: "Perez Ana", phone: "111" },
      { id: "c2", name: "Perez Beto", phone: "222" },
      { id: "c3", name: "Perez Caro", phone: "333" },
    ],
  }),
}));
vi.mock("@/lib/mozo/walk-in", () => ({
  sentarWalkIn: async () => ({ ok: true, data: {} }),
}));

import { WalkInPanel } from "./walk-in-modal";

describe("probe walk-in + buscador de cliente", () => {
  it("↓ sobre las sugerencias", async () => {
    const user = userEvent.setup();
    render(
      <WalkInPanel
        tableId="t1"
        tableLabel="Mesa 5"
        businessSlug="golf-jcr"
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );
    const nombre = screen.getByPlaceholderText(/buscar cliente/i);
    await user.click(nombre);
    await user.keyboard("per");
    await waitFor(
      () => expect(screen.getByText("Perez Ana")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    console.log("foco antes de ↓:", (document.activeElement as HTMLElement)?.tagName, (document.activeElement as HTMLElement)?.id);
    await user.keyboard("{ArrowDown}");
    console.log(
      "foco tras ↓:",
      (document.activeElement as HTMLElement)?.tagName,
      (document.activeElement as HTMLElement)?.textContent?.slice(0, 30),
      (document.activeElement as HTMLElement)?.id,
    );
    await user.keyboard("{ArrowDown}");
    console.log(
      "foco tras ↓↓:",
      (document.activeElement as HTMLElement)?.tagName,
      (document.activeElement as HTMLElement)?.textContent?.slice(0, 30),
      (document.activeElement as HTMLElement)?.id,
    );
    // ¿Cuál está resaltado (cursor visual)?
    const marcado = document.querySelectorAll("li button.bg-zinc-100");
    console.log(
      "resaltados:",
      Array.from(marcado).map((b) => b.textContent?.slice(0, 12)),
    );
  });
});
