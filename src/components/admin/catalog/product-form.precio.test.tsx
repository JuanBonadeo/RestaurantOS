// P14 · hallazgo 3 — el precio que se guarda es el que se tipeó.
//
// El campo «Precio base ($)» era un `<input type="number">` cuyo `onChange`
// hacía `parseInt(e.target.value) || 0`. Dos caminos, los dos silenciosos:
// pegando «18.500» el parseInt cortaba en el punto y guardaba 1800 centavos
// ($18); tipeándolo, el navegador devuelve "" mientras el número está
// incompleto y el `|| 0` lo mandaba a $0. El asado salía a la carta a $18 y el
// mozo lo cobraba a $18: para él el sistema no falló.
//
// El test mira el efecto —el `price_cents` que viaja a la server action—, no
// que el input tenga tal o cual tipo.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateProduct = vi.fn(async () => ({
  ok: true as const,
  data: { id: "p1", warnings: [] as string[] },
}));
const createProduct = vi.fn(async () => ({
  ok: true as const,
  data: { id: "p2", warnings: [] as string[] },
}));

vi.mock("@/lib/catalog/product-actions", () => ({
  updateProduct: (...args: unknown[]) => updateProduct(...(args as [])),
  createProduct: (...args: unknown[]) => createProduct(...(args as [])),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));
vi.mock("@/components/admin/catalog/image-uploader", () => ({
  ImageUploader: () => null,
}));

import { ProductForm } from "./product-form";
import type { AdminProduct } from "@/lib/admin/catalog-query";

const producto = {
  id: "p1",
  name: "Asado",
  slug: "asado",
  description: null,
  price_cents: 1_000_000,
  image_url: null,
  category_id: null,
  station_id: null,
  is_available: true,
  is_active: true,
  show_online: true,
  sort_order: 0,
  prep_time_minutes: null,
  modifier_groups: [],
} as unknown as AdminProduct;

const montar = () =>
  render(
    <ProductForm
      slug="demo"
      businessId="biz1"
      categories={[]}
      stations={[]}
      product={producto}
    />,
  );

const precioEnviado = () => {
  const [, , payload] = updateProduct.mock.calls.at(-1) as unknown as [
    string,
    string,
    { price_cents: number },
  ];
  return payload.price_cents;
};

describe("ProductForm · precio base", () => {
  beforeEach(() => {
    updateProduct.mockClear();
    createProduct.mockClear();
  });

  it("«18.500» se guarda como $18.500, no como $18", async () => {
    const user = userEvent.setup();
    montar();
    const campo = screen.getByLabelText(/Precio base/i);
    await user.clear(campo);
    await user.type(campo, "18.500");
    await user.click(screen.getByRole("button", { name: /Guardar/i }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(precioEnviado()).toBe(1_850_000);
  });

  it("los centavos siguen entrando: «12,75» son 1275 centavos", async () => {
    const user = userEvent.setup();
    montar();
    const campo = screen.getByLabelText(/Precio base/i);
    await user.clear(campo);
    await user.type(campo, "12,75");
    await user.click(screen.getByRole("button", { name: /Guardar/i }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(precioEnviado()).toBe(1275);
  });

  it("el campo vacío no guarda $0: se planta y avisa", async () => {
    const user = userEvent.setup();
    montar();
    const campo = screen.getByLabelText(/Precio base/i);
    await user.clear(campo);
    await user.click(screen.getByRole("button", { name: /Guardar/i }));

    expect(await screen.findByText(/Ingresá un precio/i)).toBeInTheDocument();
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("el cero de más no pasa derecho", async () => {
    const user = userEvent.setup();
    montar();
    const campo = screen.getByLabelText(/Precio base/i);
    await user.clear(campo);
    await user.type(campo, "185.000.000");
    await user.click(screen.getByRole("button", { name: /Guardar/i }));

    expect(await screen.findByText(/sobró un cero/i)).toBeInTheDocument();
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it("editar sin tocar el precio lo deja como estaba", async () => {
    // El valor que trae la base se muestra formateado («10.000»), así que el
    // parser tiene que saber releer lo que el propio campo escribe.
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: /Guardar/i }));

    await waitFor(() => expect(updateProduct).toHaveBeenCalled());
    expect(precioEnviado()).toBe(1_000_000);
  });
});

describe("ProductForm · alta", () => {
  it("crear sin poner precio no guarda un producto en $0", async () => {
    const user = userEvent.setup();
    render(
      <ProductForm
        slug="demo"
        businessId="biz1"
        categories={[]}
        stations={[]}
      />,
    );
    await user.type(screen.getByLabelText(/^Nombre$/i), "Agua");
    await user.type(screen.getByLabelText(/^Slug$/i), "agua");
    await user.click(screen.getByRole("button", { name: /Crear/i }));

    expect(await screen.findByText(/Ingresá un precio/i)).toBeInTheDocument();
    expect(createProduct).not.toHaveBeenCalled();
  });
});
