import { describe, it, expect } from "vitest";
import { isOnlinePendingAdvance, isValidTransition } from "./status";

describe("isValidTransition", () => {
  it("allows the happy delivery path", () => {
    expect(isValidTransition("pending", "confirmed")).toBe(true);
    expect(isValidTransition("confirmed", "preparing")).toBe(true);
    expect(isValidTransition("preparing", "ready")).toBe(true);
    expect(isValidTransition("ready", "on_the_way")).toBe(true);
    expect(isValidTransition("on_the_way", "delivered")).toBe(true);
  });

  it("allows the happy pickup path (ready → delivered)", () => {
    expect(isValidTransition("ready", "delivered")).toBe(true);
  });

  it("allows cancelling from any active status", () => {
    expect(isValidTransition("pending", "cancelled")).toBe(true);
    expect(isValidTransition("preparing", "cancelled")).toBe(true);
    expect(isValidTransition("on_the_way", "cancelled")).toBe(true);
  });

  it("rejects going backward", () => {
    expect(isValidTransition("preparing", "pending")).toBe(false);
    expect(isValidTransition("delivered", "pending")).toBe(false);
    expect(isValidTransition("ready", "confirmed")).toBe(false);
  });

  it("rejects transitions from terminal statuses", () => {
    expect(isValidTransition("delivered", "cancelled")).toBe(false);
    expect(isValidTransition("cancelled", "pending")).toBe(false);
    expect(isValidTransition("delivered", "on_the_way")).toBe(false);
  });

  it("rejects skipping intermediate steps", () => {
    expect(isValidTransition("pending", "delivered")).toBe(false);
    expect(isValidTransition("confirmed", "ready")).toBe(false);
  });

  it("allows pending → preparing (skip confirmed)", () => {
    expect(isValidTransition("pending", "preparing")).toBe(true);
  });

  it("allows salon skip-ready: preparing → delivered", () => {
    expect(isValidTransition("preparing", "delivered")).toBe(true);
  });
});

// spec 047 — guard server: un pedido online en `pending` solo se manda a cocina
// con "Confirmar" (routeOrderToCocina). updateOrderStatus lo rechaza para no
// dejarlo en `preparing` sin comandas ni impresión (pérdida silenciosa).
describe("isOnlinePendingAdvance", () => {
  it("blocks advancing an online pending order (pickup/delivery)", () => {
    expect(isOnlinePendingAdvance("pending", "pickup", "confirmed")).toBe(true);
    expect(isOnlinePendingAdvance("pending", "pickup", "preparing")).toBe(true);
    expect(isOnlinePendingAdvance("pending", "delivery", "confirmed")).toBe(true);
  });

  it("allows cancelling an online pending order", () => {
    expect(isOnlinePendingAdvance("pending", "pickup", "cancelled")).toBe(false);
    expect(isOnlinePendingAdvance("pending", "delivery", "cancelled")).toBe(false);
  });

  it("does not apply to dine-in (marcha por el mozo)", () => {
    expect(isOnlinePendingAdvance("pending", "dine_in", "preparing")).toBe(false);
    expect(isOnlinePendingAdvance("pending", "dine_in", "confirmed")).toBe(false);
  });

  // spec 093 — la guarda se extiende a `confirmed`. Un programado aceptado que
  // vence cae de «Próximos» a «Nuevos» con un botón «Preparar»; como
  // `confirmed → preparing` es FORWARD válido, el avance pasaba y dejaba el
  // pedido en `preparing` SIN comandas: descartado por el cron e inaceptable
  // para «Marchar ahora», o sea irrecuperable. El botón obvio rompía el pedido.
  it("tampoco deja avanzar un online desde confirmed (spec 093)", () => {
    expect(isOnlinePendingAdvance("confirmed", "pickup", "preparing")).toBe(true);
    expect(isOnlinePendingAdvance("confirmed", "delivery", "preparing")).toBe(true);
  });

  it("cancelar desde confirmed sigue permitido", () => {
    expect(isOnlinePendingAdvance("confirmed", "pickup", "cancelled")).toBe(false);
  });

  it("dine-in sigue afuera también en confirmed", () => {
    expect(isOnlinePendingAdvance("confirmed", "dine_in", "preparing")).toBe(false);
  });

  it("does not apply once past confirmed", () => {
    // De `preparing` en adelante el pedido ya pasó por `routeOrderToCocina`:
    // tiene comandas y el avance por columna es exactamente lo que corresponde.
    expect(isOnlinePendingAdvance("preparing", "pickup", "ready")).toBe(false);
    expect(isOnlinePendingAdvance("ready", "delivery", "on_the_way")).toBe(false);
    expect(isOnlinePendingAdvance("on_the_way", "delivery", "delivered")).toBe(
      false,
    );
  });
});
