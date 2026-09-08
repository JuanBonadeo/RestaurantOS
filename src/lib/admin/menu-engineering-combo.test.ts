// P14 · hallazgo 1 — la ingeniería de menú contaba las guarniciones del menú
// del día como si se hubieran vendido a $0.
//
// Los hijos de un menú del día se persisten como `order_items` propios con
// `is_combo_component = true` y `unit_price_cents = subtotal_cents = 0` (la
// plata la lleva la línea padre del combo). Las otras CINCO superficies que
// leen `order_items` los filtran; `getMenuEngineering` no. Resultado: las
// unidades del plato se inflaban, el facturado no se movía, y como el costo de
// insumos se multiplica por unidades SERVIDAS, el margen efectivo se desplomaba
// y `classify()` mandaba el plato al cuadrante equivocado. De paso ensuciaba
// `avgUnits` y `avgMarginPct`, que son la vara contra la que se miden TODOS los
// platos: el error no se quedaba en una tarjeta.
//
// El fake de abajo no es un mock que devuelve lo que le pidan: aplica de verdad
// los filtros que la query declara. Si el filtro no está, las filas del combo
// entran — que es exactamente lo que pasaba.
import { describe, expect, it, vi } from "vitest";

type Fila = {
  product_id: string | null;
  quantity: number;
  subtotal_cents: number;
  cancelled_at: string | null;
  is_combo_component: boolean;
};

const FILAS: Fila[] = [
  // Asado a la carta: 5 unidades, $110.000 facturados.
  ...Array.from({ length: 5 }, () => ({
    product_id: "asado",
    quantity: 1,
    subtotal_cents: 2_200_000,
    cancelled_at: null,
    is_combo_component: false,
  })),
  // Asado adentro del menú del día: 10 unidades servidas, $0 facturados.
  ...Array.from({ length: 10 }, () => ({
    product_id: "asado",
    quantity: 1,
    subtotal_cents: 0,
    cancelled_at: null,
    is_combo_component: true,
  })),
  // Flan a la carta, para que los promedios del tablero signifiquen algo.
  ...Array.from({ length: 20 }, () => ({
    product_id: "flan",
    quantity: 1,
    subtotal_cents: 200_000,
    cancelled_at: null,
    is_combo_component: false,
  })),
];

/** Mini-PostgREST: sólo entiende los filtros sobre columnas de `order_items`. */
function fakeQuery(filas: Fila[]) {
  const predicados: ((f: Fila) => boolean)[] = [];
  const propia = (col: string) => !col.includes(".") && col !== "orders";
  const q: Record<string, unknown> = {
    select: () => q,
    gte: () => q,
    lt: () => q,
    eq: (col: string, val: unknown) => {
      if (propia(col)) predicados.push((f) => (f as never)[col] === val);
      return q;
    },
    neq: (col: string, val: unknown) => {
      if (propia(col)) predicados.push((f) => (f as never)[col] !== val);
      return q;
    },
    is: (col: string, val: unknown) => {
      if (propia(col))
        predicados.push((f) =>
          val === null ? (f as never)[col] == null : (f as never)[col] === val,
        );
      return q;
    },
    not: (col: string, _op: string, val: unknown) => {
      if (propia(col)) predicados.push((f) => (f as never)[col] !== val);
      return q;
    },
    order: () => q,
    // `fetchAll` pagina con `.range()`; cada página arma la query de nuevo.
    range: (desde: number, hasta: number) =>
      Promise.resolve({
        data: filas
          .filter((f) => predicados.every((p) => p(f)))
          .slice(desde, hasta + 1),
        error: null,
      }),
    then: (resolve: (r: { data: Fila[]; error: null }) => void) =>
      resolve({
        data: filas.filter((f) => predicados.every((p) => p(f))),
        error: null,
      }),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: () => fakeQuery(FILAS) }),
}));

vi.mock("@/lib/ingredients/queries", () => ({
  getCosteoOverview: async () => [
    {
      productId: "asado",
      productName: "Asado",
      categoryName: "Parrilla",
      priceCents: 2_200_000,
      foodCostCents: 800_000,
      hasRecipe: true,
    },
    {
      productId: "flan",
      productName: "Flan",
      categoryName: "Postres",
      priceCents: 200_000,
      foodCostCents: 100_000,
      hasRecipe: true,
    },
  ],
}));

const { getMenuEngineering } = await import("./profit-query");

describe("getMenuEngineering · el menú del día no infla al plato", () => {
  it("cuenta sólo las unidades vendidas por su cuenta", async () => {
    const r = await getMenuEngineering("biz1", "2026-09-01", "2026-09-30");
    const asado = r.items.find((i) => i.productId === "asado")!;
    expect(asado.unitsSold).toBe(5);
    expect(asado.revenueCents).toBe(11_000_000);
  });

  it("el margen deja de desplomarse por un costo que no vendió nada", async () => {
    const r = await getMenuEngineering("biz1", "2026-09-01", "2026-09-30");
    const asado = r.items.find((i) => i.productId === "asado")!;
    // 11.000.000 − 5×800.000 = 7.000.000 sobre 11.000.000.
    expect(asado.marginPercent).toBeCloseTo(63.64, 1);
    expect(asado.quadrant).not.toBe("perro");
  });

  it("los promedios del tablero quedan limpios", async () => {
    // avgUnits es la vara de «popular»: con las 10 unidades fantasma daba 17,5
    // y empujaba a TODOS los demás platos hacia el lado impopular.
    const r = await getMenuEngineering("biz1", "2026-09-01", "2026-09-30");
    expect(r.avgUnits).toBe(12.5);
  });
});
