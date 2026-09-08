// P14 · hallazgo 5 — `updateProduct` no miraba si el UPDATE tocó alguna fila.
//
// El id del producto viaja desde el browser. Con un id de OTRO negocio el
// UPDATE lleva `.eq("id").eq("business_id")`, la RLS suma lo suyo y quedan 0
// filas afectadas… pero Supabase devuelve `error = null`. Como no hay error, la
// action seguía y llamaba a `syncModifierGroups`, que inserta los grupos con MI
// `business_id` y el `product_id` ajeno. La policy de `modifier_groups` mira su
// propio negocio, así que el INSERT pasaba: adicionales inventados colgados de
// un producto de otro local, visibles en su carta pública y en su app del mozo,
// invisibles en su admin.
//
// La guarda de verdad está en la base (migración 0091, FK compuesta). Acá se
// prueba la otra mitad: que la action corte ANTES de escribirle nada a nadie y
// que le diga la verdad al que la llamó, en vez de devolver «ok».
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Filas que el UPDATE de products dice haber tocado. Se reasigna por test. */
let filasTocadas: { id: string }[] = [];
/** Todo lo que se intentó escribir en las tablas de adicionales. */
let escriturasDeAdicionales: string[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("./require-catalog-manager", () => ({
  requireCatalogManager: async () => ({
    ok: true as const,
    data: { businessId: "biz-propio" },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (tabla: string) => {
      if (tabla !== "products") {
        escriturasDeAdicionales.push(tabla);
      }
      const chain: Record<string, unknown> = {
        // En products el `.select()` cierra la cadena del UPDATE y devuelve las
        // filas tocadas; en el resto sigue siendo encadenable.
        select: () =>
          tabla === "products"
            ? Promise.resolve({ data: filasTocadas, error: null })
            : chain,
        update: () => chain,
        insert: () => chain,
        delete: () => chain,
        eq: () => chain,
        in: () => chain,
        single: () => Promise.resolve({ data: { id: "g1" }, error: null }),
        then: (resolve: (r: { data: null; error: null }) => void) =>
          resolve({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));

const { updateProduct } = await import("./product-actions");

const input = {
  name: "Asado",
  slug: "asado",
  price_cents: 1_850_000,
  is_available: true,
  is_active: true,
  show_online: true,
  sort_order: 0,
  modifier_groups: [
    {
      name: "Punto",
      min_selection: 1,
      max_selection: 1,
      is_required: true,
      sort_order: 0,
      modifiers: [
        {
          name: "Jugoso",
          price_delta_cents: 0,
          is_available: true,
          sort_order: 0,
        },
      ],
    },
  ],
};

describe("updateProduct · el UPDATE que no tocó nada", () => {
  beforeEach(() => {
    escriturasDeAdicionales = [];
  });

  it("producto de otro negocio → corta y no le escribe adicionales", async () => {
    filasTocadas = [];
    const r = await updateProduct("demo", "id-ajeno", input);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/no encontrado/i);
    expect(escriturasDeAdicionales).toEqual([]);
  });

  it("producto propio → sigue guardando los adicionales", async () => {
    filasTocadas = [{ id: "p1" }];
    const r = await updateProduct("demo", "p1", input);

    expect(r.ok).toBe(true);
    expect(escriturasDeAdicionales).toContain("modifier_groups");
  });
});
