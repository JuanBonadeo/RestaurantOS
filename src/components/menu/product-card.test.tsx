import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductCard } from "./product-card";
import type { MenuProduct } from "@/lib/menu";

const product: MenuProduct = {
  id: "prod-1",
  category_id: "cat-1",
  name: "Pizza Muzzarella",
  slug: "muzzarella",
  description: "Con salsa.",
  price_cents: 1000000,
  image_url: null,
  is_available: true,
  sort_order: 0,
  modifier_groups: [],
};

describe("<ProductCard />", () => {
  it("renders name, description and formatted price", () => {
    render(<ProductCard product={product} cartQty={0} onSelect={() => {}} />);
    expect(screen.getByText("Pizza Muzzarella")).toBeInTheDocument();
    expect(screen.getByText("Con salsa.")).toBeInTheDocument();
    expect(screen.getByText(/\$\s?10\.000/)).toBeInTheDocument();
  });

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn();
    render(<ProductCard product={product} cartQty={0} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Pizza Muzzarella"));
    expect(onSelect).toHaveBeenCalledWith(product);
  });

  it("shows sold-out badge and disables click when not available", async () => {
    const onSelect = vi.fn();
    render(
      <ProductCard
        product={{ ...product, is_available: false }}
        cartQty={0}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("No disponible")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Pizza Muzzarella"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
