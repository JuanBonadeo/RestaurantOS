import { describe, expect, it } from "vitest";

import type { Notification } from "./queries";
import { viewForNotification } from "./view";

function noti(type: string, payload: Record<string, unknown> = {}): Notification {
  return {
    id: "n1",
    business_id: "b1",
    user_id: null,
    target_role: "encargado",
    type,
    payload,
    read_at: null,
    created_at: new Date().toISOString(),
  };
}

describe("viewForNotification (spec 27)", () => {
  const nuevos = [
    "reserva.nueva",
    "reserva.cancelada_cliente",
    "order.cancelled_by_customer",
    "mesa.pidio_cuenta",
    "item.cancelado",
  ];

  it("cada tipo nuevo tiene una view específica (no el fallback genérico)", () => {
    for (const type of nuevos) {
      const v = viewForNotification(noti(type));
      // El fallback usa `title === n.type`; una view específica nunca.
      expect(v.title).not.toBe(type);
      expect(v.body).not.toBe("Notificación.");
    }
  });

  it("rellena el payload cuando está disponible", () => {
    const v = viewForNotification(
      noti("item.cancelado", { tableLabel: "7", itemName: "Milanesa", reason: "86" }),
    );
    expect(v.title).toContain("Mesa 7");
    expect(v.body).toContain("Milanesa");
    expect(v.tone).toBe("warning");
  });

  it("un tipo desconocido sí cae al fallback", () => {
    const v = viewForNotification(noti("tipo.inexistente"));
    expect(v.title).toBe("tipo.inexistente");
  });

  // `deliveryType` viene crudo de `orders.delivery_type` (events.ts), donde el
  // retiro en el local es `pickup`. `take_away` nunca se persiste.
  it("order.pending nombra el canal: delivery y retiro se distinguen", () => {
    const del = viewForNotification(
      noti("order.pending", { orderNumber: 12, deliveryType: "delivery" }),
    );
    expect(del.title).toContain("Delivery");

    const pick = viewForNotification(
      noti("order.pending", { orderNumber: 13, deliveryType: "pickup" }),
    );
    expect(pick.title).toContain("Take-away");
  });
});
