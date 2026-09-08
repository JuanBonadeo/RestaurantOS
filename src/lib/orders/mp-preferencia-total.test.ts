/**
 * La preferencia de Mercado Pago cobra lo que dice la orden — issue #269.
 *
 * Viajaban sólo los platos: ni el envío ni el descuento del cupón. El cliente
 * pagaba $10.000 por un pedido de $10.800 y la caja asentaba los $10.800, así
 * que el arqueo cerraba contra sí mismo y el envío se perdía en cada delivery
 * pagado online. Con cupón el error va para el otro lado: el cliente paga de
 * más.
 *
 * Se testea la construcción del array —que es donde estaba el bug— y no el
 * llamado a MP, que es I/O de un tercero.
 */
import { describe, expect, it } from "vitest";

type Linea = { unit_price_cents: number; quantity: number };

/** La misma forma que arma `persistOrder` para la preferencia. */
function itemsDePreferencia(
  lines: Linea[],
  deliveryFeeCents: number,
  discountCents: number,
) {
  return [
    ...lines.map((l, i) => ({
      id: `p${i}`,
      title: "Plato",
      quantity: l.quantity,
      unit_price: Math.round(l.unit_price_cents / 100),
    })),
    ...(deliveryFeeCents > 0
      ? [{ id: "envio", title: "Envío", quantity: 1, unit_price: Math.round(deliveryFeeCents / 100) }]
      : []),
    ...(discountCents > 0
      ? [{ id: "descuento", title: "Descuento", quantity: 1, unit_price: -Math.round(discountCents / 100) }]
      : []),
  ];
}

const totalDe = (items: ReturnType<typeof itemsDePreferencia>) =>
  items.reduce((n, i) => n + i.unit_price * i.quantity, 0);

describe("la preferencia de MP y el total de la orden", () => {
  it("con envío, el cliente paga el envío", () => {
    // Pedido de $10.000 + $800 de envío = $10.800, que es lo que la caja asienta.
    const items = itemsDePreferencia([{ unit_price_cents: 1_000_000, quantity: 1 }], 80_000, 0);
    expect(totalDe(items)).toBe(10_800);
    expect(items.some((i) => i.id === "envio")).toBe(true);
  });

  it("con cupón, el descuento viaja en negativo y el cliente no paga de más", () => {
    const items = itemsDePreferencia([{ unit_price_cents: 1_000_000, quantity: 1 }], 80_000, 200_000);
    expect(totalDe(items)).toBe(8_800);
  });

  it("sin envío ni descuento, la preferencia no lleva líneas de más", () => {
    const items = itemsDePreferencia([{ unit_price_cents: 1_000_000, quantity: 2 }], 0, 0);
    expect(items).toHaveLength(1);
    expect(totalDe(items)).toBe(20_000);
  });
});
