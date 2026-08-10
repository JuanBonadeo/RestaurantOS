import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Spec 105 — el catálogo del mozo cacheado en el dispositivo. Lo que se testea
// es la POLÍTICA: qué se sirve, cuándo se revalida y qué pasa cuando el server
// falla. El bundle son ~195 kB que antes viajaban en cada apertura de mesa.

const loadPedirCatalog = vi.fn();
vi.mock("@/lib/mozo/pedir-panel-data", () => ({
  loadPedirCatalog: (slug: string) => loadPedirCatalog(slug),
}));

import { useCatalogBundle } from "./use-catalog-bundle";

/** Mismo stub que `use-sticky-filter.test.ts`: jsdom no expone localStorage. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } satisfies Storage;
}

const bundle = (nombre: string) =>
  ({
    businessName: nombre,
    catalog: { superCategories: [], categories: [] },
    stationNameById: {},
    topProductIds: [],
    dailyMenus: [],
  }) as never;

/** Un slug distinto por test: el cache de módulo es global y persiste. */
let n = 0;
const nuevoSlug = () => `golf-${++n}`;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  vi.clearAllMocks();
  loadPedirCatalog.mockResolvedValue({ ok: true, data: bundle("Golf") });
});

describe("useCatalogBundle", () => {
  it("sin nada cacheado lo pide al server", async () => {
    const slug = nuevoSlug();
    const { result } = renderHook(() => useCatalogBundle(slug));

    expect(result.current.bundle).toBeNull();

    await waitFor(() => expect(result.current.bundle).not.toBeNull());
    expect(loadPedirCatalog).toHaveBeenCalledWith(slug);
  });

  it("con cache RECIENTE pinta al instante y no le pide nada al server", async () => {
    // Es el caso de la mesa 12 del turno: el catálogo ya está, no baja de nuevo.
    const slug = nuevoSlug();
    localStorage.setItem(
      `pedir-catalog:${slug}`,
      JSON.stringify({ guardadoEn: Date.now(), bundle: bundle("cacheado") }),
    );

    const { result } = renderHook(() => useCatalogBundle(slug));

    await waitFor(() =>
      expect(result.current.bundle?.businessName).toBe("cacheado"),
    );
    await act(async () => {});
    expect(loadPedirCatalog).not.toHaveBeenCalled();
  });

  it("con cache VIEJO pinta al instante igual, y revalida en background", async () => {
    const slug = nuevoSlug();
    localStorage.setItem(
      `pedir-catalog:${slug}`,
      JSON.stringify({
        guardadoEn: Date.now() - 6 * 60 * 1000,
        bundle: bundle("viejo"),
      }),
    );
    loadPedirCatalog.mockResolvedValue({ ok: true, data: bundle("nuevo") });

    const { result } = renderHook(() => useCatalogBundle(slug));

    // Pinta con lo cacheado sin esperar al server…
    await waitFor(() =>
      expect(result.current.bundle?.businessName).toBe("viejo"),
    );
    // …y se re-hidrata con lo que trae la revalidación.
    await waitFor(() =>
      expect(result.current.bundle?.businessName).toBe("nuevo"),
    );
  });

  it("lo guardado hace medio día no se usa", async () => {
    const slug = nuevoSlug();
    localStorage.setItem(
      `pedir-catalog:${slug}`,
      JSON.stringify({
        guardadoEn: Date.now() - 13 * 60 * 60 * 1000,
        bundle: bundle("de ayer"),
      }),
    );
    loadPedirCatalog.mockResolvedValue({ ok: true, data: bundle("de hoy") });

    const { result } = renderHook(() => useCatalogBundle(slug));
    await waitFor(() => expect(result.current.bundle).not.toBeNull());
    expect(result.current.bundle?.businessName).toBe("de hoy");
  });

  it("si el server falla pero hay cache, no se le muestra un error al mozo", async () => {
    const slug = nuevoSlug();
    localStorage.setItem(
      `pedir-catalog:${slug}`,
      JSON.stringify({
        guardadoEn: Date.now() - 6 * 60 * 1000,
        bundle: bundle("cacheado"),
      }),
    );
    loadPedirCatalog.mockRejectedValue(new Error("wifi del club"));

    const { result } = renderHook(() => useCatalogBundle(slug));
    await waitFor(() =>
      expect(result.current.bundle?.businessName).toBe("cacheado"),
    );
    await act(async () => {});
    expect(result.current.error).toBeNull();
  });

  it("si falla y no hay nada cacheado, el error se ve", async () => {
    const slug = nuevoSlug();
    loadPedirCatalog.mockResolvedValue({ ok: false, error: "Sin permisos." });

    const { result } = renderHook(() => useCatalogBundle(slug));
    await waitFor(() => expect(result.current.error).toBe("Sin permisos."));
    expect(result.current.bundle).toBeNull();
  });

  it("el storage roto no rompe la pantalla", async () => {
    const slug = nuevoSlug();
    localStorage.setItem(`pedir-catalog:${slug}`, "{no es json");

    const { result } = renderHook(() => useCatalogBundle(slug));
    await waitFor(() => expect(result.current.bundle).not.toBeNull());
  });
});
