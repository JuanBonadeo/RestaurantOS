import { describe, expect, it } from "vitest";

import {
  DEFAULT_DELIVERY_TEMPLATES,
  isDeliveryNotifyStatus,
  renderDeliveryBody,
  renderDeliveryMessage,
  shouldNotifyDeliveryStatus,
} from "./delivery-templates";

const baseOrder = {
  customerName: "Ana",
  customerPhone: "+5491122334455",
  orderNumber: 42,
};

function render(over: Partial<Parameters<typeof renderDeliveryMessage>[0]> = {}) {
  return renderDeliveryMessage({
    status: "preparing",
    deliveryType: "delivery",
    businessName: "House",
    timezone: "America/Argentina/Buenos_Aires",
    ...baseOrder,
    ...over,
  });
}

describe("renderDeliveryMessage", () => {
  it("renderiza el mensaje del estado con los placeholders resueltos", () => {
    const preparing = render({ status: "preparing" });
    expect(preparing).toContain("Ana"); // {cliente}
    expect(preparing).toContain("42"); // {numero}
    const delivered = render({ status: "delivered" });
    expect(delivered).toContain("House"); // {negocio}
  });

  it("usa la plantilla custom del dueño cuando se pasa", () => {
    const msg = render({
      status: "ready",
      template: { body: "Pedido {numero} listo para {cliente}", enabled: true },
    });
    expect(msg).toBe("Pedido 42 listo para Ana");
  });

  it("take-away (pickup) no recibe 'en camino'", () => {
    expect(render({ status: "on_the_way", deliveryType: "pickup" })).toBeNull();
    // pero sí los otros estados:
    expect(render({ status: "ready", deliveryType: "pickup" })).not.toBeNull();
  });

  it("delivery sí recibe 'en camino'", () => {
    expect(render({ status: "on_the_way", deliveryType: "delivery" })).not.toBeNull();
  });

  it("dine_in (salón) no recibe avisos de delivery", () => {
    expect(render({ status: "ready", deliveryType: "dine_in" })).toBeNull();
  });

  it("sin teléfono válido no produce mensaje", () => {
    expect(render({ customerPhone: null })).toBeNull();
    expect(render({ customerPhone: "  " })).toBeNull();
  });

  // Spec 139 — `pending` pasó a notificar: es el acuse de que el pedido entró.
  // `confirmed` sigue sin avisar (el cliente ya sabe que el local lo tomó
  // cuando cambia el seguimiento, y el aviso útil es el de «preparando»).
  it("el acuse de `pending` sí produce mensaje", () => {
    expect(render({ status: "pending" })).toContain("Recibimos tu pedido");
  });

  it("un estado no notificable (confirmed) no produce mensaje", () => {
    expect(render({ status: "confirmed" })).toBeNull();
  });

  it("una plantilla deshabilitada no produce mensaje", () => {
    expect(
      render({
        status: "ready",
        template: { body: "x", enabled: false },
      }),
    ).toBeNull();
  });

  it("resuelve {hora} en timezone AR de forma determinista", () => {
    // 2026-06-08 23:30 UTC = 20:30 en Buenos Aires (UTC-3).
    const msg = render({
      status: "ready",
      template: { body: "Listo a las {hora}", enabled: true },
      now: new Date("2026-06-08T23:30:00Z"),
    });
    expect(msg).toBe("Listo a las 20:30");
  });
});

describe("shouldNotifyDeliveryStatus (agnóstico de canal)", () => {
  it("delivery notificable → true; dine_in → false", () => {
    expect(shouldNotifyDeliveryStatus({ status: "ready", deliveryType: "delivery" })).toBe(true);
    expect(shouldNotifyDeliveryStatus({ status: "ready", deliveryType: "dine_in" })).toBe(false);
  });

  it("'en camino' solo para delivery", () => {
    expect(shouldNotifyDeliveryStatus({ status: "on_the_way", deliveryType: "pickup" })).toBe(false);
    expect(shouldNotifyDeliveryStatus({ status: "on_the_way", deliveryType: "delivery" })).toBe(true);
  });

  it("estado no notificable → false", () => {
    expect(shouldNotifyDeliveryStatus({ status: "confirmed", deliveryType: "delivery" })).toBe(false);
  });

  // Spec 139 — el acuse es para lo online: en el salón el mozo está ahí.
  it("el acuse sale en delivery y retiro, no en salón", () => {
    expect(shouldNotifyDeliveryStatus({ status: "pending", deliveryType: "delivery" })).toBe(true);
    expect(shouldNotifyDeliveryStatus({ status: "pending", deliveryType: "pickup" })).toBe(true);
    expect(shouldNotifyDeliveryStatus({ status: "pending", deliveryType: "dine_in" })).toBe(false);
  });
});

describe("renderDeliveryBody (sin exigir teléfono, para email)", () => {
  it("renderiza aunque no haya teléfono (a diferencia de renderDeliveryMessage)", () => {
    const body = renderDeliveryBody({
      status: "ready",
      deliveryType: "delivery",
      customerName: "Ana",
      orderNumber: 42,
      businessName: "Golf",
      timezone: "America/Argentina/Buenos_Aires",
    });
    expect(body).toContain("42");
  });

  it("plantilla apagada → null", () => {
    expect(
      renderDeliveryBody({
        status: "ready",
        deliveryType: "delivery",
        customerName: "Ana",
        orderNumber: 42,
        businessName: "Golf",
        template: { body: "x", enabled: false },
      }),
    ).toBeNull();
  });
});

describe("isDeliveryNotifyStatus / defaults", () => {
  it("reconoce los 7 estados notificables", () => {
    for (const s of [
      "pending",
      "preparing",
      "ready",
      "on_the_way",
      "delivered",
      "cancelled",
      "rejected",
    ]) {
      expect(isDeliveryNotifyStatus(s)).toBe(true);
      expect(DEFAULT_DELIVERY_TEMPLATES[s as keyof typeof DEFAULT_DELIVERY_TEMPLATES]).toBeTruthy();
    }
    expect(isDeliveryNotifyStatus("confirmed")).toBe(false);
  });

  // Spec 139 — el rechazo lleva el motivo, y sin motivo no queda una frase
  // colgada. Es un aviso, no un estado del pedido.
  it("el rechazo incluye el motivo cuando lo hay", () => {
    const conMotivo = renderDeliveryBody({
      status: "rejected",
      deliveryType: "delivery",
      customerName: "Ana",
      orderNumber: 42,
      businessName: "Golf",
      motivo: "ya estamos cerrando la cocina",
    });
    expect(conMotivo).toContain("Motivo: ya estamos cerrando la cocina.");

    const sinMotivo = renderDeliveryBody({
      status: "rejected",
      deliveryType: "delivery",
      customerName: "Ana",
      orderNumber: 42,
      businessName: "Golf",
    })!;
    expect(sinMotivo).not.toContain("Motivo:");
    expect(sinMotivo).not.toContain("  ");
  });
});
