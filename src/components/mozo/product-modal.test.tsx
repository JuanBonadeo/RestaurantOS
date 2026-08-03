import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductModal } from "./product-modal";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";

/**
 * Los atajos del modal de alta de ítem: `/` marca «Como entrada» (spec 050,
 * atajo agregado en la 075) y `+`/`−` mueven la cantidad (spec 055 fast-follow).
 * En Observaciones ninguno aplica — ahí una barra es una barra.
 */

const MILANESA = {
  id: "p1",
  name: "Milanesa",
  description: null,
  price_cents: 100000,
  image_url: null,
  category_id: "c1",
  station_id: null,
  show_online: true,
  modifier_groups: [],
} as unknown as CatalogProduct;

function abrir(onAdd = vi.fn()) {
  render(
    <ProductModal
      open
      product={MILANESA}
      onClose={vi.fn()}
      onAdd={onAdd}
    />,
  );
  return { onAdd };
}

const comoEntrada = () => screen.getByRole("button", { name: /Como entrada/ });
const agregar = () => screen.getByRole("button", { name: /Agregar/i });

describe("<ProductModal /> — atajos de teclado", () => {
  it("`/` marca el ítem como entrada", async () => {
    const user = userEvent.setup();
    abrir();

    expect(comoEntrada()).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("/");
    expect(comoEntrada()).toHaveAttribute("aria-pressed", "true");
  });

  it("`/` de nuevo lo desmarca", async () => {
    const user = userEvent.setup();
    abrir();

    await user.keyboard("/");
    await user.keyboard("/");
    expect(comoEntrada()).toHaveAttribute("aria-pressed", "false");
  });

  it("la observación sale con el marcador antepuesto", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir();

    await user.keyboard("/");
    await user.type(screen.getByPlaceholderText(/sin jamón/i), "sin sal");
    await user.click(agregar());

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].notes).toBe("Como entrada · sin sal");
  });

  it("escribiendo en Observaciones, `/` es una barra", async () => {
    const user = userEvent.setup();
    abrir();

    const obs = screen.getByPlaceholderText(/sin jamón/i);
    await user.click(obs);
    await user.keyboard("1/2");

    expect(obs).toHaveValue("1/2");
    expect(comoEntrada()).toHaveAttribute("aria-pressed", "false");
  });

  it("`+` y `−` mueven la cantidad, y en Observaciones no", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir();

    await user.keyboard("+++");
    await user.click(agregar());
    expect(onAdd.mock.calls[0][0].quantity).toBe(4);
  });
});
