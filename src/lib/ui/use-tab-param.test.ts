import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useOnActivate, useTabParam } from "./use-tab-param";

// `useSearchParams` sale del mock: lo único que le pedimos es el valor inicial
// de la URL. El resto del contrato (que NO navegue) se verifica mirando que
// nunca se llame a `useRouter`.
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

const TABS = ["salon", "caja", "reservas"] as const;
type Tab = (typeof TABS)[number];

function setUrl(qs: string) {
  search = qs;
  window.history.replaceState(null, "", qs ? `/x/admin/operacion?${qs}` : "/x/admin/operacion");
}

describe("useTabParam", () => {
  beforeEach(() => {
    setUrl("");
  });

  it("sin parámetro arranca en el fallback", () => {
    const { result } = renderHook(() => useTabParam<Tab>("tab", "salon", TABS));
    expect(result.current[0]).toBe("salon");
  });

  it("respeta el deep-link ?tab=caja", () => {
    setUrl("tab=caja");
    const { result } = renderHook(() => useTabParam<Tab>("tab", "salon", TABS));
    expect(result.current[0]).toBe("caja");
  });

  it("una tab inexistente cae al fallback en vez de romper", () => {
    setUrl("tab=inventada");
    const { result } = renderHook(() => useTabParam<Tab>("tab", "salon", TABS));
    expect(result.current[0]).toBe("salon");
  });

  it("cambiar de tab escribe la URL sin navegar", () => {
    const { result } = renderHook(() => useTabParam<Tab>("tab", "salon", TABS));
    act(() => result.current[1]("caja"));
    expect(result.current[0]).toBe("caja");
    expect(window.location.search).toBe("?tab=caja");
  });

  it("volver al fallback borra el parámetro (URL canónica limpia)", () => {
    setUrl("tab=caja");
    const { result } = renderHook(() => useTabParam<Tab>("tab", "salon", TABS));
    act(() => result.current[1]("salon"));
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/x/admin/operacion");
  });

  it("adopta la tab cuando la URL cambia desde afuera (link a ?tab=caja)", () => {
    const { result, rerender } = renderHook(() =>
      useTabParam<Tab>("tab", "salon", TABS),
    );
    expect(result.current[0]).toBe("salon");

    // Navegación externa —redirect de /admin/cajas, campana de notificaciones,
    // link de vuelta del cobro— con el shell ya montado: sólo cambia la URL.
    act(() => {
      setUrl("tab=caja");
    });
    rerender();
    expect(result.current[0]).toBe("caja");
  });

  it("no pisa otros parámetros de la ruta (el ?date= de Reservas)", () => {
    setUrl("date=2026-08-06");
    const { result } = renderHook(() => useTabParam<Tab>("tab", "salon", TABS));
    act(() => result.current[1]("reservas"));
    expect(new URLSearchParams(window.location.search).get("date")).toBe(
      "2026-08-06",
    );
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "reservas",
    );

    // Y al volver al fallback se va sólo `tab`.
    act(() => result.current[1]("salon"));
    expect(new URLSearchParams(window.location.search).get("date")).toBe(
      "2026-08-06",
    );
    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();
  });
});

describe("useOnActivate", () => {
  it("no corre en el montaje, ni con la tab ya activa", () => {
    const fn = vi.fn();
    renderHook(({ active }) => useOnActivate(active, fn), {
      initialProps: { active: true },
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("corre al pasar de oculta a visible", () => {
    const fn = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useOnActivate(active, fn),
      { initialProps: { active: false } },
    );
    expect(fn).not.toHaveBeenCalled();
    rerender({ active: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a correr mientras siga visible, y sí en cada re-entrada", () => {
    const fn = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useOnActivate(active, fn),
      { initialProps: { active: false } },
    );
    rerender({ active: true });
    rerender({ active: true });
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    rerender({ active: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
