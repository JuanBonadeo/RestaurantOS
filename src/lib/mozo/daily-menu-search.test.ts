import { describe, expect, it } from "vitest";

import { filterDailyMenus } from "./daily-menu-search";
import type { DailyMenuForMozo } from "./daily-menus-query";

const menu = (name: string): DailyMenuForMozo => ({
  id: name,
  name,
  description: null,
  price_cents: 3500000,
  image_url: null,
  components: [],
  choice_groups: [],
  has_choices: false,
});

const menus = [menu("Menú Ejecutivo"), menu("Almuerzo del mediodía")];

describe("filterDailyMenus", () => {
  it("sin búsqueda no devuelve nada: el reposo del panel es el buscador", () => {
    expect(filterDailyMenus(menus, "")).toEqual([]);
    expect(filterDailyMenus(menus, "   ")).toEqual([]);
  });

  it("matchea por nombre sin importar acentos ni mayúsculas", () => {
    expect(filterDailyMenus(menus, "ejecutivo")).toEqual([menus[0]]);
    expect(filterDailyMenus(menus, "EJECUTIVO")).toEqual([menus[0]]);
    expect(filterDailyMenus(menus, "mediodia")).toEqual([menus[1]]);
  });

  it("matchea prefijos: se tipean tres letras, no el nombre entero", () => {
    expect(filterDailyMenus(menus, "ejec")).toEqual([menus[0]]);
  });

  it("los tokens van en cualquier orden", () => {
    expect(filterDailyMenus(menus, "ejecutivo menu")).toEqual([menus[0]]);
  });

  it("«menú del día» los encuentra a todos, se llamen como se llamen", () => {
    expect(filterDailyMenus(menus, "menu del dia")).toEqual(menus);
    // Y «menú» solo también, que es lo que uno tipea.
    expect(filterDailyMenus(menus, "menú")).toEqual(menus);
  });

  it("no devuelve cualquier cosa", () => {
    expect(filterDailyMenus(menus, "coca")).toEqual([]);
  });
});
