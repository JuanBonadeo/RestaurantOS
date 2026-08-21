import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

// Spec 049 — gestión de comandas por el encargado: `cancelarComanda`,
// `editarItemComanda`, `getSwappableProducts`. Probamos gates, scope por
// business y los recálculos, mockeando las dependencias de borde (tenant, auth,
// service client, notifications, cache) para no tocar la DB.

let currentRole: BusinessRole;

type State = {
  // single-row fetches por tabla
  comandas: Record<string, unknown> | null;
  order_items: Record<string, unknown> | null; // fetch del ítem a editar
  orders: Record<string, unknown> | null; // recompute (single)
  products: Record<string, unknown> | null; // producto nuevo (maybeSingle)
  // array fetches por tabla
  comanda_items_arr: Record<string, unknown>[];
  order_items_arr: Record<string, unknown>[]; // recompute (array)
  order_item_modifiers_arr: Record<string, unknown>[];
  products_arr: Record<string, unknown>[]; // swappable
};

let state: State;
let captured: {
  updates: { table: string; vals: Record<string, unknown> }[];
  deletes: { table: string }[];
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) =>
    slug === "nope" ? null : { id: "biz1", slug },
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role: currentRole, isPlatformAdmin: false },
  }),
}));

vi.mock("@/lib/notifications/events", () => ({
  notifyItemCancelled: vi.fn(),
  notifyPrintFailed: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));

// Query builder chainable. Cada `from(table)` arranca un contexto nuevo.
// - `.select().eq().maybeSingle()/.single()` → fila única de `state[table]`.
// - `.select()....` awaited (sin terminal) → array de `state[table + "_arr"]`.
// - `.update()/.delete()....` awaited → captura y resuelve `{ error: null }`.
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from(table: string) {
      const ctx: { op: "select" | "update" | "delete" | null; vals: unknown } = {
        op: null,
        vals: null,
      };
      const single = () =>
        Promise.resolve({
          data: (state as unknown as Record<string, unknown>)[table] ?? null,
        });
      const chain: Record<string, unknown> = {
        select() {
          ctx.op = "select";
          return chain;
        },
        update(vals: Record<string, unknown>) {
          ctx.op = "update";
          ctx.vals = vals;
          return chain;
        },
        delete() {
          ctx.op = "delete";
          return chain;
        },
        eq() {
          return chain;
        },
        in() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        maybeSingle: single,
        single,
        then(resolve: (v: unknown) => unknown) {
          if (ctx.op === "update") {
            captured.updates.push({
              table,
              vals: ctx.vals as Record<string, unknown>,
            });
            return resolve({ error: null });
          }
          if (ctx.op === "delete") {
            captured.deletes.push({ table });
            return resolve({ error: null });
          }
          // select awaited sin terminal → array
          const arr =
            (state as unknown as Record<string, unknown>)[`${table}_arr`] ?? [];
          return resolve({ data: arr });
        },
      };
      return chain;
    },
  }),
}));

const {
  cancelarComanda,
  cancelarItem,
  editarItemComanda,
  enviarComanda,
  getSwappableProducts,
} = await import("./actions");
const { notifyItemCancelled } = await import("@/lib/notifications/events");

beforeEach(() => {
  currentRole = "encargado";
  state = {
    comandas: {
      id: "c1",
      status: "pendiente",
      cancelled_at: null,
      order_id: "o1",
      orders: { business_id: "biz1" },
    },
    order_items: {
      order_id: "o1",
      product_id: "p1",
      product_name: "Milanesa",
      unit_price_cents: 500,
      quantity: 2,
      notes: null,
      station_id: "s1",
      cancelled_at: null,
      is_combo_component: false,
      parent_order_item_id: null,
      daily_menu_id: null,
      // Spec 069 — precio por ítem. Por defecto sin pisar.
      price_original_cents: null,
      orders: {
        business_id: "biz1",
        lifecycle_status: "open",
        payment_status: "pending",
      },
    },
    orders: { tip_cents: 0, discount_cents: 0, delivery_fee_cents: 0 },
    products: {
      id: "p2",
      name: "Napolitana",
      price_cents: 800,
      business_id: "biz1",
      is_active: true,
      is_available: true,
    },
    comanda_items_arr: [{ order_item_id: "i1" }, { order_item_id: "i2" }],
    order_items_arr: [{ subtotal_cents: 0, cancelled_at: "2026-07-17" }],
    order_item_modifiers_arr: [],
    products_arr: [
      { id: "p1", name: "Milanesa", price_cents: 500, station_id: "s1", category: null },
      {
        id: "p9",
        name: "Flan",
        price_cents: 300,
        station_id: null,
        category: { station_id: "s2" },
      },
    ],
  };
  captured = { updates: [], deletes: [] };
  vi.mocked(notifyItemCancelled).mockClear();
});

describe("cancelarComanda (spec 049)", () => {
  it("encargado → anula comanda + ítems, encola reimpresión ANULADA, avisa al mozo", async () => {
    const res = await cancelarComanda("house", "c1", "Mesa se levantó");
    expect(res.ok).toBe(true);
    const comandaUpdate = captured.updates.find((u) => u.table === "comandas");
    expect(comandaUpdate?.vals).toMatchObject({ print_failed_at: null });
    expect(comandaUpdate?.vals.cancelled_at).toBeTruthy();
    expect(comandaUpdate?.vals.reprint_requested_at).toBeTruthy();
    expect(comandaUpdate?.vals.cancelled_reason).toBe("Mesa se levantó");
    // Ítems vivos cancelados.
    const itemsUpdate = captured.updates.find((u) => u.table === "order_items");
    expect(itemsUpdate?.vals.cancelled_at).toBeTruthy();
    // Aviso al mozo.
    expect(notifyItemCancelled).toHaveBeenCalledOnce();
  });

  it("admin → permitido", async () => {
    currentRole = "admin";
    const res = await cancelarComanda("house", "c1", "x");
    expect(res.ok).toBe(true);
  });

  it("mozo → rechazado, no actualiza", async () => {
    currentRole = "mozo";
    const res = await cancelarComanda("house", "c1", "x");
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("motivo vacío → error", async () => {
    const res = await cancelarComanda("house", "c1", "   ");
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("comanda de otro negocio → rechazada por scope", async () => {
    state.comandas = {
      id: "c1",
      status: "pendiente",
      cancelled_at: null,
      order_id: "o1",
      orders: { business_id: "OTRO" },
    };
    const res = await cancelarComanda("house", "c1", "x");
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("comanda ya entregada → no se puede anular", async () => {
    (state.comandas as Record<string, unknown>).status = "entregado";
    const res = await cancelarComanda("house", "c1", "x");
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("comanda ya anulada → idempotente (error, sin doble update)", async () => {
    (state.comandas as Record<string, unknown>).cancelled_at = "2026-07-17";
    const res = await cancelarComanda("house", "c1", "x");
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });
});

describe("editarItemComanda (spec 049)", () => {
  it("cambia la cantidad → recalcula subtotal (unit_price * qty)", async () => {
    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals).toMatchObject({ quantity: 3, subtotal_cents: 1500 });
  });

  it("edita la nota", async () => {
    const res = await editarItemComanda("house", "i1", { notes: "bien cocido" });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals.notes).toBe("bien cocido");
  });

  it("cambia el producto → re-snapshot nombre/precio y limpia modifiers", async () => {
    const res = await editarItemComanda("house", "i1", { productId: "p2" });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals).toMatchObject({
      product_id: "p2",
      product_name: "Napolitana",
      unit_price_cents: 800,
      // subtotal = 800 * quantity(2)
      subtotal_cents: 1600,
    });
    expect(
      captured.deletes.some((d) => d.table === "order_item_modifiers"),
    ).toBe(true);
  });

  it("mozo → rechazado", async () => {
    currentRole = "mozo";
    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("ítem cancelado → rechazado", async () => {
    (state.order_items as Record<string, unknown>).cancelled_at = "2026-07-17";
    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("ítem de combo → rechazado", async () => {
    (state.order_items as Record<string, unknown>).is_combo_component = true;
    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("cantidad inválida (0) → rechazado", async () => {
    const res = await editarItemComanda("house", "i1", { quantity: 0 });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("ítem de otro negocio → rechazado por scope", async () => {
    (state.order_items as Record<string, unknown>).orders = {
      business_id: "OTRO",
    };
    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });
});

describe("editarItemComanda · precio por ítem (spec 069)", () => {
  it("pisa el precio con motivo → cobra el nuevo y guarda el de lista", async () => {
    const res = await editarItemComanda("house", "i1", {
      priceOverrideCents: 300,
      priceOverrideReason: "  cortesía por demora  ",
    });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals).toMatchObject({
      unit_price_cents: 300,
      // El de lista al momento del primer override.
      price_original_cents: 500,
      price_override_reason: "cortesía por demora",
      price_override_by: "u1",
      // subtotal = 300 * quantity(2)
      subtotal_cents: 600,
    });
    expect(upd?.vals.price_override_at).toBeTypeOf("string");
  });

  it("acepta $0 y acepta por encima del de lista — no hay tope", async () => {
    const cero = await editarItemComanda("house", "i1", {
      priceOverrideCents: 0,
      priceOverrideReason: "cortesía",
    });
    expect(cero.ok).toBe(true);
    expect(
      captured.updates.find((u) => u.table === "order_items")?.vals,
    ).toMatchObject({ unit_price_cents: 0, subtotal_cents: 0 });

    captured.updates = [];
    const caro = await editarItemComanda("house", "i1", {
      priceOverrideCents: 9_999,
      priceOverrideReason: "pescado del día",
    });
    expect(caro.ok).toBe(true);
    expect(
      captured.updates.find((u) => u.table === "order_items")?.vals,
    ).toMatchObject({ unit_price_cents: 9_999 });
  });

  it("un SEGUNDO override no pisa el precio de lista original", async () => {
    // La línea ya venía pisada: se cobra 300, la lista era 500.
    const items = state.order_items as Record<string, unknown>;
    items.unit_price_cents = 300;
    items.price_original_cents = 500;

    const res = await editarItemComanda("house", "i1", {
      priceOverrideCents: 100,
      priceOverrideReason: "segundo ajuste",
    });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    // El delta del reporte se mide contra la LISTA (500), no contra el ajuste
    // anterior (300) — si no, el segundo cambio esconde al primero.
    expect(upd?.vals).toMatchObject({
      unit_price_cents: 100,
      price_original_cents: 500,
      price_override_reason: "segundo ajuste",
    });
  });

  it("sin motivo → rechazado y no persiste nada", async () => {
    for (const reason of [undefined, "", "   "]) {
      captured.updates = [];
      const res = await editarItemComanda("house", "i1", {
        priceOverrideCents: 300,
        priceOverrideReason: reason,
      });
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toMatch(/motivo/i);
      expect(captured.updates).toHaveLength(0);
    }
  });

  it("precio negativo o no entero → rechazado", async () => {
    for (const cents of [-1, 10.5]) {
      captured.updates = [];
      const res = await editarItemComanda("house", "i1", {
        priceOverrideCents: cents,
        priceOverrideReason: "x",
      });
      expect(res.ok).toBe(false);
      expect(captured.updates).toHaveLength(0);
    }
  });

  it("mozo → rechazado aunque mande motivo", async () => {
    currentRole = "mozo";
    const res = await editarItemComanda("house", "i1", {
      priceOverrideCents: 0,
      priceOverrideReason: "cortesía",
    });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("null explícito → vuelve al precio de catálogo y limpia las 4 columnas", async () => {
    const items = state.order_items as Record<string, unknown>;
    items.unit_price_cents = 300;
    items.price_original_cents = 500;
    // El producto vivo de la línea (p1) vale 500 en el catálogo de hoy.
    (state.products as Record<string, unknown>) = {
      id: "p1",
      name: "Milanesa",
      price_cents: 500,
      business_id: "biz1",
      is_active: true,
      is_available: true,
    };

    const res = await editarItemComanda("house", "i1", {
      priceOverrideCents: null,
    });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals).toMatchObject({
      unit_price_cents: 500,
      price_original_cents: null,
      price_override_at: null,
      price_override_by: null,
      price_override_reason: null,
      subtotal_cents: 1000,
    });
  });

  it("revertir NO exige motivo — es deshacer, no cambiar", async () => {
    const items = state.order_items as Record<string, unknown>;
    items.unit_price_cents = 300;
    items.price_original_cents = 500;
    const res = await editarItemComanda("house", "i1", {
      priceOverrideCents: null,
    });
    expect(res.ok).toBe(true);
  });

  it("cambiar el producto LIMPIA el override (si no viene uno nuevo)", async () => {
    // Regresión: sin esto, la línea queda con el motivo y el price_original
    // del producto VIEJO, y el reporte lista una fila fantasma.
    const items = state.order_items as Record<string, unknown>;
    items.unit_price_cents = 300;
    items.price_original_cents = 500;
    items.price_override_reason = "pescado del día";

    const res = await editarItemComanda("house", "i1", { productId: "p2" });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals).toMatchObject({
      product_id: "p2",
      product_name: "Napolitana",
      unit_price_cents: 800,
      price_original_cents: null,
      price_override_at: null,
      price_override_by: null,
      price_override_reason: null,
    });
  });

  it("cambiar producto CON override explícito → se pisa contra la lista del nuevo", async () => {
    const res = await editarItemComanda("house", "i1", {
      productId: "p2",
      priceOverrideCents: 400,
      priceOverrideReason: "media porción",
    });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals).toMatchObject({
      product_id: "p2",
      unit_price_cents: 400,
      // La lista del producto NUEVO (800), no la del viejo (500).
      price_original_cents: 800,
      price_override_reason: "media porción",
    });
  });

  it("cambiar sólo la cantidad CONSERVA el precio pisado", async () => {
    const items = state.order_items as Record<string, unknown>;
    items.unit_price_cents = 300;
    items.price_original_cents = 500;

    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    // 300 * 3, no 500 * 3.
    expect(upd?.vals).toMatchObject({ unit_price_cents: 300, subtotal_cents: 900 });
    // Y no toca las columnas de auditoría.
    expect(upd?.vals).not.toHaveProperty("price_override_reason");
  });

  // Spec 125 — «si está pagado, no se debería poder editar». La guarda de
  // `lifecycle_status` no alcanza: un pedido online pagado por MP queda `open`
  // (el webhook acredita el pago y no llama a `closeOrderIfFullyPaid`), así que
  // se podía reescribir una orden ya cobrada desde el kanban.
  it("orden ya pagada → rechazado aunque siga abierta", async () => {
    (state.order_items as Record<string, unknown>).orders = {
      business_id: "biz1",
      lifecycle_status: "open",
      payment_status: "paid",
    };
    const res = await editarItemComanda("house", "i1", { quantity: 3 });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("orden ya cerrada → rechazado (la plata cobrada no se reescribe)", async () => {
    (state.order_items as Record<string, unknown>).orders = {
      business_id: "biz1",
      lifecycle_status: "closed",
    };
    const res = await editarItemComanda("house", "i1", {
      priceOverrideCents: 0,
      priceOverrideReason: "cortesía",
    });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });
});

describe("cancelarItem · frontera de plata (spec 125)", () => {
  it("orden ya pagada → rechazado aunque siga abierta", async () => {
    (state.order_items as Record<string, unknown>).orders = {
      id: "o1",
      business_id: "biz1",
      lifecycle_status: "open",
      payment_status: "paid",
    };
    const res = await cancelarItem("i1", "me equivoqué", "house");
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("orden abierta e impaga → se cancela", async () => {
    const res = await cancelarItem("i1", "me equivoqué", "house");
    expect(res.ok).toBe(true);
    const upd = captured.updates.find((u) => u.table === "order_items");
    expect(upd?.vals.cancelled_at).toBeTruthy();
    expect(upd?.vals.cancelled_reason).toBe("me equivoqué");
  });
});

describe("enviarComanda · agregar a un pedido existente (spec 125)", () => {
  const ITEM = { product_id: "p1", quantity: 1 };

  it("pedido ya cobrado → rechazado, no se inserta nada", async () => {
    state.orders = {
      id: "o1",
      business_id: "biz1",
      lifecycle_status: "open",
      payment_status: "paid",
    };
    const res = await enviarComanda({
      orderId: "o1",
      items: [ITEM],
      slug: "house",
    });
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  it("pedido ya cerrado → rechazado", async () => {
    state.orders = {
      id: "o1",
      business_id: "biz1",
      lifecycle_status: "closed",
      payment_status: "pending",
    };
    const res = await enviarComanda({
      orderId: "o1",
      items: [ITEM],
      slug: "house",
    });
    expect(res.ok).toBe(false);
  });

  it("pedido de otro negocio → rechazado", async () => {
    state.orders = {
      id: "o1",
      business_id: "otro",
      lifecycle_status: "open",
      payment_status: "pending",
    };
    const res = await enviarComanda({
      orderId: "o1",
      items: [ITEM],
      slug: "house",
    });
    expect(res.ok).toBe(false);
  });

  it("mesa y pedido a la vez → rechazado (el destino es uno solo)", async () => {
    const res = await enviarComanda({
      tableId: "t1",
      orderId: "o1",
      items: [ITEM],
      slug: "house",
    });
    expect(res.ok).toBe(false);
  });

  it("sin destino → rechazado", async () => {
    const res = await enviarComanda({ items: [ITEM], slug: "house" });
    expect(res.ok).toBe(false);
  });
});

describe("getSwappableProducts (spec 049)", () => {
  it("devuelve solo productos que rutean al sector pedido", async () => {
    const res = await getSwappableProducts("house", "s1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((p) => p.id)).toEqual(["p1"]);
    expect(res.data[0]).toMatchObject({ name: "Milanesa", price_cents: 500 });
  });

  it("mozo → rechazado", async () => {
    currentRole = "mozo";
    const res = await getSwappableProducts("house", "s1");
    expect(res.ok).toBe(false);
  });
});
