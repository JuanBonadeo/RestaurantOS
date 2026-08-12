import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MesaColumn, type MesaColumnCartItem } from "./mesa-column";
import type { LoPedido } from "@/lib/mozo/lo-pedido";

const enviado: LoPedido = {
  order_id: "o1",
  order_number: 25,
  party_size: 2,
  subtotal_cents: 700000,
  discount_cents: 0,
  tip_cents: 0,
  total_cents: 700000,
  items: [
    {
      order_item_id: "i1",
      product_name: "Milanesa napolitana",
      quantity: 1,
      notes: "sin sal",
      modifiers: ["Papas fritas", "A punto"],
      unit_price_cents: 700000,
      subtotal_cents: 700000,
      seat_number: null,
      station_id: "cocina",
      kitchen_status: "preparing",
      cancelled_at: null,
      cancelled_reason: null,
      comanda_id: "c1",
      batch: 1,
      emitted_at: "2026-08-12T21:00:00Z",
    },
  ],
};

const sinEnviar: MesaColumnCartItem[] = [
  {
    _key: "k1",
    product_name: "Coca-Cola",
    quantity: 2,
    notes: null,
    line_subtotal_cents: 200000,
    modifiers: [],
    esMenuDelDia: false,
    price_override_cents: null,
    price_override_reason: null,
    unit_price_cents: 100000,
  },
];

function renderColumna(over: Partial<Parameters<typeof MesaColumn>[0]> = {}) {
  return render(
    <MesaColumn
      tableLabel="VITRINA"
      loPedido={enviado}
      comandas={[]}
      stationNameById={{ cocina: "Cocina" }}
      cart={[]}
      cartTotalCents={0}
      userCanCancel
      userCanEditPrice
      pending={false}
      onCancelItem={vi.fn()}
      onAdvance={vi.fn()}
      onChangeQty={vi.fn()}
      onRemoveCartItem={vi.fn()}
      onEditPrice={vi.fn()}
      onEnviar={vi.fn()}
      {...over}
    />,
  );
}

describe("MesaColumn (spec 111)", () => {
  it("es la región de la mesa, sin repetir su título", () => {
    renderColumna();
    // El nombre y el estado los pone el header del panel: tenerlos también acá
    // era decir dos veces lo mismo en dos franjas seguidas.
    expect(
      screen.getByRole("region", { name: "Mesa VITRINA" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("VITRINA")).toBeNull();
    expect(screen.queryByText("Ocupada")).toBeNull();
  });

  it("de lo enviado muestra los modificadores elegidos y el estado de cocina", () => {
    renderColumna();
    expect(screen.getByText("Papas fritas · A punto")).toBeInTheDocument();
    expect(screen.getByText("En preparación")).toBeInTheDocument();
    expect(screen.getByText("Cocina")).toBeInTheDocument();
  });

  it("separa lo que todavía no se mandó, en su propio bloque", () => {
    renderColumna({ cart: sinEnviar, cartTotalCents: 200000 });

    // El bloque existe y tiene adentro sólo lo pendiente: confundirlo con lo
    // enviado es servir de menos o mandar dos veces.
    const titulo = screen.getByText("Sin enviar");
    const bloque = titulo.closest("article")!;
    expect(within(bloque).getByText("Coca-Cola")).toBeInTheDocument();
    expect(within(bloque).queryByText("Milanesa napolitana")).toBeNull();
  });

  it("con algo sin enviar, la acción primaria es enviarlo", async () => {
    const onEnviar = vi.fn();
    renderColumna({ cart: sinEnviar, cartTotalCents: 200000, onEnviar });

    const enviar = screen.getByRole("button", { name: /Enviar/ });
    await userEvent.click(enviar);
    expect(onEnviar).toHaveBeenCalledTimes(1);
  });

  it("sin nada pendiente, la primaria es cobrar", () => {
    renderColumna({ acciones: { onCobrar: vi.fn() } });
    expect(screen.getByRole("button", { name: "Cobrar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar/ })).toBeNull();
  });

  it("con líneas sin enviar, cobrar se va al ⋯ (no se cobra de un tap una mesa a medio cargar)", () => {
    renderColumna({
      cart: sinEnviar,
      cartTotalCents: 200000,
      acciones: { onCobrar: vi.fn() },
    });
    expect(screen.getByRole("button", { name: /Enviar/ })).toBeInTheDocument();
    // Ya no como botón grande; queda adentro del menú.
    expect(screen.queryByRole("button", { name: "Cobrar" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Más acciones de la mesa" }),
    ).toBeInTheDocument();
  });

  it("un ítem anulado se sigue viendo, tachado y con el motivo", () => {
    renderColumna({
      loPedido: {
        ...enviado,
        items: [
          {
            ...enviado.items[0],
            cancelled_at: "2026-08-12T21:30:00Z",
            cancelled_reason: "se equivocó el mozo",
          },
        ],
      },
    });
    expect(
      screen.getByText(/Anulado: se equivocó el mozo/),
    ).toBeInTheDocument();
  });

  it("mesa sin nada: lo dice y manda al buscador", () => {
    renderColumna({ loPedido: null });
    expect(
      screen.getByText(/La mesa todavía no tiene nada cargado/),
    ).toBeInTheDocument();
  });
});
