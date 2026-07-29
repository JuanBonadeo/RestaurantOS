import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { cajaStorageKey, useCajaPreferida } from "./use-caja-preferida";

const SALON = { id: "caja-salon" };
const BAR = { id: "caja-bar" };
const CAJAS = [SALON, BAR];

// jsdom no expone `localStorage` en este entorno (Node fuera del rango del
// engine), así que lo stubbeamos: lo que se testea es la política de
// preferencia, no la implementación del storage del browser.
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

describe("useCajaPreferida", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("sin preferencia guardada arranca en la primera caja", () => {
    const { result } = renderHook(() => useCajaPreferida("golf-jcr", CAJAS));
    expect(result.current[0]).toBe("caja-salon");
  });

  it("respeta la caja guardada en esta máquina", () => {
    localStorage.setItem(cajaStorageKey("golf-jcr"), "caja-bar");
    const { result } = renderHook(() => useCajaPreferida("golf-jcr", CAJAS));
    expect(result.current[0]).toBe("caja-bar");
  });

  it("elegir una caja la persiste para la próxima vez", () => {
    const { result, unmount } = renderHook(() =>
      useCajaPreferida("golf-jcr", CAJAS),
    );
    act(() => result.current[1]("caja-bar"));
    expect(result.current[0]).toBe("caja-bar");
    unmount();

    // Nueva visita en la misma máquina: sigue en Caja Bar.
    const segunda = renderHook(() => useCajaPreferida("golf-jcr", CAJAS));
    expect(segunda.result.current[0]).toBe("caja-bar");
  });

  it("cae a la primera si la caja guardada ya no existe", () => {
    localStorage.setItem(cajaStorageKey("golf-jcr"), "caja-borrada");
    const { result } = renderHook(() => useCajaPreferida("golf-jcr", CAJAS));
    expect(result.current[0]).toBe("caja-salon");
  });

  it("aplica la preferencia cuando las cajas llegan async", () => {
    localStorage.setItem(cajaStorageKey("golf-jcr"), "caja-bar");
    // Los paneles que cargan con `iniciarCobro()` montan con la lista vacía.
    const { result, rerender } = renderHook(
      ({ cajas }) => useCajaPreferida("golf-jcr", cajas),
      { initialProps: { cajas: [] as { id: string }[] } },
    );
    expect(result.current[0]).toBe("");

    rerender({ cajas: CAJAS });
    expect(result.current[0]).toBe("caja-bar");
  });

  it("la preferencia es por negocio: House no pisa a Golf", () => {
    localStorage.setItem(cajaStorageKey("golf-jcr"), "caja-bar");
    const golf = renderHook(() => useCajaPreferida("golf-jcr", CAJAS));
    const house = renderHook(() => useCajaPreferida("house", CAJAS));

    expect(golf.result.current[0]).toBe("caja-bar");
    expect(house.result.current[0]).toBe("caja-salon");
  });
});
