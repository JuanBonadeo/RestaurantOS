import { describe, expect, it } from "vitest";

import {
  buildControlTicketLines,
  type ControlTicketData,
} from "./control-ticket";

// Spec 063 — el control de pedido. Lo que se prueba acá es el contenido, no el
// estilo: qué dice el papel que se lleva el repartidor y, sobre todo, cuánta
// plata dice que tiene que cobrar.

function base(over: Partial<ControlTicketData> = {}): ControlTicketData {
  return {
    control_ticket_id: "ct1",
    business_name: "Restaurant del Golf",
    business_address: "Bv. Wilde y Eva Perón",
    business_phone: "0341-153276804",
    order_number: 123,
    delivery_type: "delivery",
    emitted_at: "2026-07-28T19:16:00-03:00",
    scheduled_at: null,
    customer_name: "Juan Pérez",
    customer_phone: "341 555 1234",
    delivery_address: "Calle 123",
    delivery_notes: null,
    subtotal_cents: 11050000,
    delivery_fee_cents: 150000,
    discount_cents: 0,
    total_cents: 11200000,
    payment_method: "cash",
    payment_status: "pending",
    items: [
      {
        product_name: "Brochette de lomo",
        quantity: 2,
        line_total_cents: 6600000,
      },
    ],
    ...over,
  };
}

/** El ticket como texto plano, para asertar sobre el contenido. */
function text(data: ControlTicketData): string {
  return buildControlTicketLines(data)
    .map((l) => l.text)
    .join("\n");
}

describe("buildControlTicketLines", () => {
  it("dice cuánto cobrar cuando el pedido está impago", () => {
    const t = text(base());
    expect(t).toContain("A COBRAR:");
    expect(t).toContain("112000.00");
    expect(t).toContain("Metodo: Efectivo");
    expect(t).not.toContain("NO COBRAR");
  });

  it("dice PAGADO / NO COBRAR cuando ya está pagado", () => {
    const t = text(base({ payment_status: "paid", payment_method: "mp" }));
    expect(t).toContain("PAGADO");
    expect(t).toContain("NO COBRAR");
    expect(t).not.toContain("A COBRAR:");
  });

  it("el aviso de cobro va en el tamaño más grande del ticket", () => {
    // Si «A COBRAR» sale en cuerpo chico, el repartidor lo puede pasar por alto
    // y ahí se pierde plata. Es la razón de ser del papel.
    const lines = buildControlTicketLines(base());
    const cobro = lines.find((l) => l.text.startsWith("A COBRAR:"));
    expect(cobro?.size).toBe("xl");
    expect(cobro?.bold).toBe(true);
    // El monto va abajo, en el mismo tamaño (a doble ancho no entran juntos).
    expect(lines[lines.indexOf(cobro!) + 1]).toMatchObject({
      text: "112000.00",
      size: "xl",
    });
  });

  it("nada sale en cuerpo normal salvo las líneas separadoras", () => {
    for (const l of buildControlTicketLines(base()))
      if ((l.size ?? "sm") === "sm") expect(l.text).toMatch(/^-*$/);
  });

  it("desglosa subtotal, envío y descuento; omite los que son cero", () => {
    const t = text(base({ discount_cents: 100000 }));
    expect(t).toContain("Subtotal:");
    expect(t).toContain("110500.00");
    expect(t).toContain("Envio:");
    expect(t).toContain("-1000.00");

    const sinEnvio = text(base({ delivery_fee_cents: 0 }));
    expect(sinEnvio).not.toContain("Envio:");
    expect(sinEnvio).not.toContain("Descuento:");
  });

  it("un delivery lleva dirección y línea de repartidor; un retiro no", () => {
    const del = text(base());
    expect(del).toContain("DELIVERY\n#123"); // a doble ancho entra en dos renglones
    expect(del).toContain("Repartidor:");
    expect(del).toContain("Direccion: Calle 123");

    const ret = text(base({ delivery_type: "pickup" }));
    expect(ret).toContain("RETIRO #123"); // 11 col justas: no se parte
    expect(ret).not.toContain("Repartidor:");
    expect(ret).not.toContain("Direccion:");
  });

  it("muestra la hora de entrega de un programado, y si no «lo antes posible»", () => {
    expect(text(base())).toContain("ENTREGA: lo antes\nposible");
    const prog = text(base({ scheduled_at: "2026-07-28T20:30:00-03:00" }));
    expect(prog).toContain("ENTREGA: 28/07 20:30");
  });

  it("sale 100% en ASCII imprimible (la térmica no recibe codepage)", () => {
    const t = text(
      base({
        business_name: "Ñandú Café — «Sabor»",
        customer_name: "Juan Pérez",
        delivery_address: "Güemes 1234 · 3° B",
        delivery_notes: "tocar timbre 🙂",
      }),
    );
    // eslint-disable-next-line no-control-regex
    expect(t.replace(/\n/g, "")).toMatch(/^[\x20-\x7e]*$/);
    expect(t).toContain("NANDU CAFE");
    expect(t).toContain("Juan Perez");
  });

  it("no imprime ítems anulados aguas arriba y aguanta un pedido sin ítems", () => {
    expect(text(base({ items: [] }))).toContain("(sin items)");
  });

  it("marca la reimpresión", () => {
    expect(text(base({ reprint: true }))).toContain("REIMPRESION");
  });

  it("cierra con el pie de no-factura (no es un comprobante fiscal)", () => {
    const t = text(base());
    expect(t).toContain("DOCUMENTO NO VALIDO");
    expect(t).toContain("COMO FACTURA");
  });
});
