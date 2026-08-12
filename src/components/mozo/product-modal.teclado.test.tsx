import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductModal } from "./product-modal";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";

/**
 * Spec 110 — los modificadores se navegan con flechas, como el resto del panel.
 *
 * Era la única superficie de carga sin teclado: para llegar a la tercera salsa
 * había que tabular tres veces, mientras que resultados, carrito, filas de mesa
 * y el propio wizard del menú del día se recorren con ↑/↓ desde la spec 075.
 * Se cortaba justo en el paso que más se repite al cargar un pedido.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const producto = {
  id: "p1",
  category_id: "c1",
  name: "Bife de chorizo",
  description: null,
  price_cents: 1000,
  image_url: null,
  sort_order: 0,
  show_online: true,
  modifier_groups: [
    {
      id: "g1",
      name: "Punto de cocción",
      is_required: true,
      min_selection: 1,
      max_selection: 1,
      sort_order: 0,
      modifiers: [
        { id: "m1", group_id: "g1", name: "Jugoso", price_delta_cents: 0, is_available: true, sort_order: 0 },
        { id: "m2", group_id: "g1", name: "A punto", price_delta_cents: 0, is_available: true, sort_order: 1 },
        { id: "m3", group_id: "g1", name: "Cocido", price_delta_cents: 0, is_available: true, sort_order: 2 },
      ],
    },
    {
      id: "g2",
      name: "Guarnición",
      is_required: false,
      min_selection: 0,
      max_selection: 2,
      sort_order: 1,
      modifiers: [
        { id: "m4", group_id: "g2", name: "Papas", price_delta_cents: 500, is_available: true, sort_order: 0 },
        { id: "m5", group_id: "g2", name: "Ensalada", price_delta_cents: 500, is_available: true, sort_order: 1 },
      ],
    },
  ],
} as unknown as CatalogProduct;

function abrir(onAdd = vi.fn()) {
  render(
    <ProductModal
      product={producto}
      open
      onClose={vi.fn()}
      onAdd={onAdd}
      embedded
    />,
  );
  return onAdd;
}

// Las opciones son `radio` o `checkbox` según el grupo, así que se buscan por
// su texto y se sube al botón: el mismo helper sirve para los dos.
const opcion = (nombre: string) =>
  screen.getByText(nombre).closest("button") as HTMLButtonElement;

describe("ProductModal · teclado de los modificadores (spec 110)", () => {
  it("abre con el foco en la primera opción", async () => {
    abrir();
    await new Promise((r) => setTimeout(r, 0));
    expect(opcion("Jugoso")).toHaveFocus();
  });

  it("↓ y ↑ mueven entre opciones, y cruzan de grupo sin escalón", async () => {
    const user = userEvent.setup();
    abrir();
    await new Promise((r) => setTimeout(r, 0));

    await user.keyboard("{ArrowDown}");
    expect(opcion("A punto")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(opcion("Cocido")).toHaveFocus();

    // De "Punto de cocción" a "Guarnición" con la misma tecla: al que carga no
    // le importa dónde termina un grupo y empieza el otro.
    await user.keyboard("{ArrowDown}");
    expect(opcion("Papas")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(opcion("Cocido")).toHaveFocus();
  });

  it("↓ en la última opción entrega el foco a «Agregar»", async () => {
    const user = userEvent.setup();
    abrir();
    await new Promise((r) => setTimeout(r, 0));

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("button", { name: /Agregar/i })).toHaveFocus();
  });

  it("Enter elige la opción enfocada, no manda el formulario", async () => {
    const user = userEvent.setup();
    const onAdd = abrir();
    await new Promise((r) => setTimeout(r, 0));

    await user.keyboard("{ArrowDown}{Enter}");
    expect(opcion("A punto")).toHaveAttribute("aria-checked", "true");
    // La elección no puede disparar el alta: falta decidir la guarnición.
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("los dígitos eligen directo, como en el wizard del menú del día", async () => {
    const user = userEvent.setup();
    abrir();
    await new Promise((r) => setTimeout(r, 0));

    await user.keyboard("4");
    expect(opcion("Papas")).toHaveAttribute("aria-checked", "true");
    expect(opcion("Papas")).toHaveFocus();
  });

  it("un grupo de una sola opción se comporta como radio; uno múltiple, como checkbox", async () => {
    abrir();
    expect(opcion("Jugoso")).toHaveAttribute("role", "radio");
    expect(opcion("Papas")).toHaveAttribute("role", "checkbox");
  });
});
