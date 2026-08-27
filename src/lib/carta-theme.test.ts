import { describe, expect, it } from "vitest";

import { CARTA_THEME_GOLF, resolveCartaTheme } from "./carta-theme";

describe("resolveCartaTheme", () => {
  it("cae al tema del Golf cuando el negocio no configuró nada", () => {
    expect(resolveCartaTheme(null)).toEqual(CARTA_THEME_GOLF);
    expect(resolveCartaTheme({})).toEqual(CARTA_THEME_GOLF);
    expect(resolveCartaTheme({ carta: null })).toEqual(CARTA_THEME_GOLF);
    // Un `carta` que no es objeto es basura, no configuración.
    expect(resolveCartaTheme({ carta: "terracota" })).toEqual(CARTA_THEME_GOLF);
    expect(resolveCartaTheme({ carta: [] })).toEqual(CARTA_THEME_GOLF);
  });

  it("mergea campo por campo: lo que no está se hereda", () => {
    const t = resolveCartaTheme({ carta: { accent: "#A12D15" } });
    expect(t.accent).toBe("#A12D15");
    expect(t.figure_url).toBe(CARTA_THEME_GOLF.figure_url);
    expect(t.title_style).toBe("script");
  });

  it("distingue null explícito («esta pieza no va») de ausente («heredá»)", () => {
    const sinOrnamento = resolveCartaTheme({ carta: { ornament_url: null } });
    expect(sinOrnamento.ornament_url).toBeNull();

    const ausente = resolveCartaTheme({ carta: {} });
    expect(ausente.ornament_url).toBe(CARTA_THEME_GOLF.ornament_url);
  });

  it("ignora valores del tipo equivocado en vez de romper la carta", () => {
    const t = resolveCartaTheme({
      carta: {
        accent: 42,
        cover_scrim: "no",
        wordmark_ratio: -3,
        title_style: "comic-sans",
        body_style: "monospace",
        paper: "   ",
      },
    });
    expect(t.accent).toBe(CARTA_THEME_GOLF.accent);
    expect(t.cover_scrim).toBe(CARTA_THEME_GOLF.cover_scrim);
    expect(t.wordmark_ratio).toBe(CARTA_THEME_GOLF.wordmark_ratio);
    expect(t.title_style).toBe(CARTA_THEME_GOLF.title_style);
    expect(t.body_style).toBe(CARTA_THEME_GOLF.body_style);
    expect(t.paper).toBe(CARTA_THEME_GOLF.paper);
  });

  it("arma el tema de KCC entero", () => {
    const t = resolveCartaTheme({
      carta: {
        cover_bg: "#A12D15",
        cover_texture_url: null,
        cover_scrim: false,
        figure_url: null,
        wordmark_url: "/carta/kcc/wordmark.svg",
        wordmark_ratio: 325 / 101,
        label: null,
        paper: "#F5F2E9",
        paper_texture_url: "/carta/kcc/papel.png",
        ink: "#363636",
        ink_2: "#6f6a63",
        accent: "#A12D15",
        ornament_url: null,
        title_style: "serif-italic",
        body_style: "serif",
      },
    });
    expect(t.cover_scrim).toBe(false);
    expect(t.figure_url).toBeNull();
    expect(t.label).toBeNull();
    expect(t.ornament_url).toBeNull();
    expect(t.title_style).toBe("serif-italic");
    expect(t.body_style).toBe("serif");
    expect(t.wordmark_ratio).toBeCloseTo(325 / 101, 5);
  });
});
