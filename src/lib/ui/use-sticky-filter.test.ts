import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useStickyFilter } from "./use-sticky-filter";

// Mismo stub que `use-caja-preferida.test.ts`: jsdom no expone `localStorage`
// en este entorno. Lo que se testea es la política de persistencia, no la
// implementación del storage del browser.
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

const KEY = "operacion_salon_biz-1";
const SALONES = ["terraza", "comedor"];

describe("useStickyFilter", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("sin preferencia guardada arranca en el fallback", () => {
    const { result } = renderHook(() => useStickyFilter(KEY, "all", SALONES));
    expect(result.current[0]).toBe("all");
  });

  it("respeta el valor guardado en esta máquina", () => {
    localStorage.setItem(KEY, "comedor");
    const { result } = renderHook(() => useStickyFilter(KEY, "all", SALONES));
    expect(result.current[0]).toBe("comedor");
  });

  it("un valor guardado que ya no existe cae al fallback", () => {
    // Salón borrado: la preferencia apunta a un plano que no existe más.
    localStorage.setItem(KEY, "salon-borrado");
    const { result } = renderHook(() => useStickyFilter(KEY, "all", SALONES));
    expect(result.current[0]).toBe("all");
  });

  it("elegir un valor lo persiste", () => {
    const { result } = renderHook(() => useStickyFilter(KEY, "all", SALONES));
    act(() => result.current[1]("terraza"));
    expect(result.current[0]).toBe("terraza");
    expect(localStorage.getItem(KEY)).toBe("terraza");
  });

  it("volver al fallback borra la preferencia (no queda basura)", () => {
    localStorage.setItem(KEY, "terraza");
    const { result } = renderHook(() => useStickyFilter(KEY, "all", SALONES));
    act(() => result.current[1]("all"));
    expect(result.current[0]).toBe("all");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("si el salón elegido desaparece de la lista, vuelve al fallback", () => {
    localStorage.setItem(KEY, "terraza");
    const { result, rerender } = renderHook(
      ({ opts }: { opts: string[] }) => useStickyFilter(KEY, "all", opts),
      { initialProps: { opts: SALONES } },
    );
    expect(result.current[0]).toBe("terraza");

    rerender({ opts: ["comedor"] });
    expect(result.current[0]).toBe("all");
  });

  it("la lista vacía no rompe: queda en el fallback", () => {
    const { result } = renderHook(() => useStickyFilter(KEY, "all", []));
    expect(result.current[0]).toBe("all");
  });

  it("si el storage explota (incógnito) la elección igual vale en la sesión", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {
        throw new Error("nope");
      },
      removeItem: () => {
        throw new Error("nope");
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } satisfies Storage);

    const { result } = renderHook(() => useStickyFilter(KEY, "all", SALONES));
    act(() => result.current[1]("terraza"));
    expect(result.current[0]).toBe("terraza");
  });
});
