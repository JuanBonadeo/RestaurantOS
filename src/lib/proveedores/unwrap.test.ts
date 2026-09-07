import { describe, expect, it, vi } from "vitest";

import { unwrap, fetchAll, enLotes, PAGE_SIZE, LOTE_IN } from "./unwrap";

describe("unwrap (spec 161 · D1)", () => {
  it("devuelve las filas cuando la consulta anduvo", () => {
    expect(unwrap({ data: [{ id: "a" }], error: null })).toEqual([{ id: "a" }]);
  });

  it("una tabla vacía es un array vacío, no un error", () => {
    expect(unwrap({ data: [], error: null })).toEqual([]);
  });

  // El bug entero de esta spec en un caso: postgrest-js NO lanza ante un fallo
  // de red, devuelve {data: null, error}. Con `?? []` eso se volvía "no hay
  // filas" y la pantalla decía que el proveedor debía todo.
  it("LANZA cuando hay error — no devuelve [] en silencio", () => {
    expect(() =>
      unwrap({ data: null, error: { message: "fetch failed" } }),
    ).toThrow(/fetch failed/);
  });

  it("lanza aunque venga data y error a la vez", () => {
    expect(() => unwrap({ data: [], error: { message: "boom" } })).toThrow(/boom/);
  });

  // `data: null` sin error no debería pasar, pero si pasa es una lectura que no
  // trajo lo que dijo que traía: tampoco puede volverse [] callado.
  it("lanza si no hay ni data ni error", () => {
    expect(() => unwrap({ data: null, error: null })).toThrow();
  });

  it("el mensaje nombra la tabla cuando se le pasa", () => {
    expect(() =>
      unwrap({ data: null, error: { message: "timeout" } }, "supplier_payments"),
    ).toThrow(/supplier_payments/);
  });
});

/** Cliente mínimo que imita el encadenado de postgrest-js para `.range()`. */
function clienteFalso(filas: unknown[], opts: { falla?: boolean } = {}) {
  const rangos: Array<[number, number]> = [];
  const q = {
    range(desde: number, hasta: number) {
      rangos.push([desde, hasta]);
      if (opts.falla) {
        return Promise.resolve({ data: null, error: { message: "fetch failed" } });
      }
      return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
    },
  };
  return { q, rangos };
}

describe("fetchAll (spec 161 · D2)", () => {
  it("una sola página cuando entra todo", async () => {
    const { q, rangos } = clienteFalso([{ id: 1 }, { id: 2 }]);
    await expect(fetchAll(() => q)).resolves.toHaveLength(2);
    expect(rangos).toEqual([[0, PAGE_SIZE - 1]]);
  });

  // El corte de PostgREST: `products` tiene 1.326 en el cloud y devuelve 1.000.
  // Sin paginar, el saldo del Golf iba a empezar a mentir en ~2 meses.
  it("trae TODO lo que hay más allá del corte de 1.000", async () => {
    const filas = Array.from({ length: 2_350 }, (_, i) => ({ id: i }));
    const { q, rangos } = clienteFalso(filas);

    const out = await fetchAll(() => q);

    expect(out).toHaveLength(2_350);
    expect(rangos.length).toBe(3);
    expect(out[0]).toEqual({ id: 0 });
    expect(out[2_349]).toEqual({ id: 2_349 });
  });

  it("no pide una página de más cuando el total es múltiplo exacto", async () => {
    const filas = Array.from({ length: PAGE_SIZE * 2 }, (_, i) => ({ id: i }));
    const { q, rangos } = clienteFalso(filas);

    await fetchAll(() => q);

    // La última página vuelve incompleta o vacía; con múltiplo exacto hace
    // falta una vuelta más para saberlo, pero ni una más que esa.
    expect(rangos.length).toBe(3);
  });

  it("propaga el error de cualquier página, no devuelve lo que ya juntó", async () => {
    const { q } = clienteFalso([], { falla: true });
    await expect(fetchAll(() => q)).rejects.toThrow(/fetch failed/);
  });
});

describe("enLotes (spec 161 · D2)", () => {
  // El `.in()` de la ficha revienta a ~650 UUIDs (600 pasan, 680 dan Bad
  // Request). 300 deja margen.
  it("parte una lista larga en lotes que PostgREST aguanta", async () => {
    const ids = Array.from({ length: 700 }, (_, i) => `id-${i}`);
    const lotes: string[][] = [];

    const out = await enLotes(ids, async (lote) => {
      lotes.push(lote);
      return lote.map((id) => ({ id }));
    });

    expect(lotes.map((l) => l.length)).toEqual([LOTE_IN, LOTE_IN, 100]);
    expect(out).toHaveLength(700);
  });

  it("no llama al fetcher con una lista vacía", async () => {
    const fetcher = vi.fn();
    await expect(enLotes([], fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("una lista corta es un solo lote", async () => {
    const lotes: string[][] = [];
    await enLotes(["a", "b"], async (l) => {
      lotes.push(l);
      return [];
    });
    expect(lotes).toEqual([["a", "b"]]);
  });
});
