import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// El buscador de cliente pega a una server action; acá sólo nos importa el
// foco y el teclado, así que lo neutralizamos.
vi.mock("@/lib/admin/customers-actions", () => ({
  buscarClientes: async () => ({ ok: true, data: [] }),
}));
vi.mock("@/lib/mozo/walk-in", () => ({
  sentarWalkIn: async () => ({ ok: true, data: {} }),
}));

import { WalkInPanel } from "./walk-in-modal";

/**
 * Regresión de foco en «abrir mesa» (pedido de Juan, 2026-07-30).
 *
 * La spec 066 hizo este formulario keyboard-first: el foco arranca en «Abrir
 * mesa» y las teclas 1-9/+/− mueven Personas, así el caso común —mesa para 2—
 * es Enter y listo. La spec 068 movió el foco al buscador de cliente y eso
 * mató el atajo **en silencio**: `handleKeyDown` sale por el early return de
 * `INPUT`, así que el código del atajo seguía ahí pero era inalcanzable.
 *
 * Estos tests fallan si alguien saca el `useEffect` que pone el foco en el
 * submit (verificado rompiéndolo: 3 de 4 en rojo).
 *
 * OJO con lo que NO cubren: poner `autoFocus` de nuevo en `CustomerFields`,
 * **por sí solo**, no los rompe — los efectos del hijo corren antes que los
 * del padre, así que el `useEffect` de acá gana igual. Por eso el arreglo son
 * las dos cosas: el foco explícito Y no pedir `autoFocus`. Depender del orden
 * de efectos sería implícito y frágil.
 */
function renderPanel() {
  return render(
    <WalkInPanel
      tableId="t1"
      tableLabel="Mesa 5"
      businessSlug="golf-jcr"
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
}

describe("abrir mesa · foco y teclado (specs 066 / 068)", () => {
  it("el foco arranca en «Abrir mesa», no en un input", () => {
    renderPanel();
    const submit = screen.getByRole("button", { name: /abrir mesa 5/i });
    expect(document.activeElement).toBe(submit);
    // Lo que importa de verdad: el cursor NO está en un campo de texto, que es
    // lo que desactiva los atajos numéricos.
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("con el foco inicial, las teclas numéricas mueven Personas", () => {
    renderPanel();
    // Default 2 → tecla 4 → 4.
    fireEvent.keyDown(document.activeElement!, { key: "4" });
    expect(screen.getByRole("button", { name: "4 personas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("«+» y «−» ajustan Personas desde el foco inicial", () => {
    renderPanel();
    fireEvent.keyDown(document.activeElement!, { key: "+" });
    expect(screen.getByRole("button", { name: "3 personas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.keyDown(document.activeElement!, { key: "-" });
    expect(screen.getByRole("button", { name: "2 personas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("escribiendo en un campo de texto, un «4» es un cuatro y no cambia Personas", () => {
    renderPanel();
    const nombre = screen.getByLabelText(/cliente|nombre/i);
    fireEvent.keyDown(nombre, { key: "4" });
    // Sigue en el default.
    expect(screen.getByRole("button", { name: "2 personas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
