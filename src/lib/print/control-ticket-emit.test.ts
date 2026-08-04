import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitControlTicket } from "./control-ticket-emit";

/**
 * Spec 063 — emisión del control de pedido. Lo que importa: sale para lo que
 * se lleva del local, NO sale para mesa, y no se duplica por más veces que se
 * marche el mismo pedido.
 */

type OrderRow = { business_id: string; delivery_type: string } | null;

let orderRow: OrderRow;
let upserts: { row: Record<string, unknown>; opts: unknown }[];
let upsertError: { message: string } | null;

/** Fake del service client: solo `orders.select` y `control_tickets.upsert`. */
function fakeService() {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: orderRow }) }),
        }),
        upsert: async (row: Record<string, unknown>, opts: unknown) => {
          if (table === "print_jobs") upserts.push({ row, opts });
          return { error: upsertError };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  orderRow = { business_id: "biz1", delivery_type: "delivery" };
  upserts = [];
  upsertError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("emitControlTicket", () => {
  it("emite para delivery", async () => {
    const res = await emitControlTicket(fakeService(), "o1", "biz1");
    expect(res).toEqual({ emitted: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row).toEqual({
      order_id: "o1",
      business_id: "biz1",
      kind: "control",
    });
  });

  it("emite para retiro", async () => {
    orderRow = { business_id: "biz1", delivery_type: "pickup" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: true,
    });
  });

  it("NO emite para un pedido de mesa / venta de mostrador", async () => {
    orderRow = { business_id: "biz1", delivery_type: "dine_in" };
    const res = await emitControlTicket(fakeService(), "o1", "biz1");
    expect(res).toEqual({ emitted: false });
    expect(upserts).toEqual([]);
  });

  it("es idempotente: el upsert va con ignoreDuplicates sobre order_id", async () => {
    // La unicidad la garantiza el índice parcial `print_jobs_control_uniq`; lo que
    // se prueba acá es que el insert no explote ni duplique cuando se marcha
    // dos veces (reintento del cron, "marchar ahora" sobre algo ya tomado).
    await emitControlTicket(fakeService(), "o1", "biz1");
    await emitControlTicket(fakeService(), "o1", "biz1");
    expect(upserts).toHaveLength(2);
    for (const u of upserts) {
      expect(u.opts).toEqual({ onConflict: "order_id", ignoreDuplicates: true });
    }
  });

  it("no emite si el pedido no existe", async () => {
    orderRow = null;
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
    });
    expect(upserts).toEqual([]);
  });

  it("no emite si el pedido es de otro negocio (defensa cross-tenant)", async () => {
    orderRow = { business_id: "biz2", delivery_type: "delivery" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
    });
    expect(upserts).toEqual([]);
  });

  it("un error de la DB se reporta como no-emitido, sin tirar", async () => {
    upsertError = { message: "boom" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
    });
  });
});
