import { describe, expect, it } from "vitest";

import { GRUPOS, TEMAS } from "./contenido";
import {
  equivalenciasDeRol,
  posicionEnRecorrido,
  progresoDelRecorrido,
  recorrido,
  rolesDe,
  temaDeRol,
  temasDeRol,
} from "./recorrido";

// Spec 169 · el recorrido de primer ingreso y el progreso de lectura.
//
// Todo lo de acá es lógica pura sobre TEMAS: qué temas le tocan a un rol, en
// qué orden se leen la primera vez, y cuánto falta. La tabla `ayuda_lecturas`
// entra sólo como un Set de slugs, así que esto se testea sin base.

void GRUPOS;

describe("temasDeRol", () => {
  it("el encargado y el admin ven los mismos temas: los del panel", () => {
    // No son TODOS los de TEMAS desde la spec 170: ahí abajo del array están
    // los de la terminal, que son de otro rol y de otras pantallas.
    const delPanel = TEMAS.filter((t) => !t.roles);
    expect(temasDeRol("encargado")).toHaveLength(delPanel.length);
    expect(temasDeRol("admin")).toHaveLength(delPanel.length);
  });

  it("el mozo NO ve la guía del encargado", () => {
    // Hoy no hay un solo tema escrito para él (D9: es su propia spec). Lo que
    // importa es que no herede ésta: le imprime topes de autorización —el 25 %
    // de descuento, los $5.000 de caja— que no son suyos.
    const suyos = temasDeRol("mozo");
    expect(suyos).toHaveLength(0);
    expect(suyos.map((t) => t.slug)).not.toContain("caja");
  });

  it("la terminal tampoco hereda la del encargado: tiene la suya (spec 170)", () => {
    const suyos = temasDeRol("terminal");
    expect(suyos.length).toBeGreaterThan(0);
    expect(suyos.map((t) => t.slug)).not.toContain("caja");
  });

  it("sin rol no se asume nada", () => {
    expect(temasDeRol(null)).toHaveLength(0);
  });
});

describe("recorrido", () => {
  it("son los nueve trabajos del turno, y nada más", () => {
    const r = recorrido("encargado", "estricto");
    expect(r).toHaveLength(9);
    expect(r.every((t) => t.grupo === "operacion")).toBe(true);
  });

  it("arranca donde arranca el turno: la caja", () => {
    expect(recorrido("encargado", "estricto")[0]?.slug).toBe("caja");
  });

  it("no mete el catálogo ni los carteles de error", () => {
    const slugs = recorrido("encargado", "estricto").map((t) => t.slug);
    expect(slugs).not.toContain("carta");
    expect(slugs).not.toContain("carteles");
  });

  it("es el mismo en los dos modos de reservas: los dos están escritos", () => {
    expect(recorrido("encargado", "flexible")).toHaveLength(
      recorrido("encargado", "estricto").length,
    );
  });

  it("para el mozo está vacío mientras no tenga contenido propio", () => {
    expect(recorrido("mozo", "estricto")).toHaveLength(0);
  });
});

describe("progresoDelRecorrido", () => {
  const modo = "estricto" as const;

  it("recién llegado: nada leído, el próximo es el primero", () => {
    const p = progresoDelRecorrido("encargado", modo, new Set());
    expect(p).toMatchObject({ total: 9, leidos: 0, pendientes: 9, completo: false });
    expect(p.proximo?.slug).toBe("caja");
  });

  it("el próximo es el primero SIN leer, no el que sigue al último leído", () => {
    // Se salteó «mesas» y leyó «cobrar»: lo que le falta sigue siendo mesas.
    const p = progresoDelRecorrido(
      "encargado",
      modo,
      new Set(["caja", "cobrar"]),
    );
    expect(p.leidos).toBe(2);
    expect(p.proximo?.slug).toBe("mesas");
  });

  it("leído todo: completo, y sin próximo", () => {
    const todos = new Set(recorrido("encargado", modo).map((t) => t.slug));
    const p = progresoDelRecorrido("encargado", modo, todos);
    expect(p).toMatchObject({ leidos: 9, pendientes: 0, completo: true });
    expect(p.proximo).toBeUndefined();
  });

  it("un tema leído que ya no está en el recorrido no infla la cuenta", () => {
    // Pasa solo: se borra o se renombra un tema y quedan filas viejas en
    // `ayuda_lecturas`. Si contaran, el recorrido se daría por terminado sin
    // que nadie lo haya leído.
    const p = progresoDelRecorrido(
      "encargado",
      modo,
      new Set(["caja", "un-tema-que-ya-no-existe", "carta"]),
    );
    expect(p.leidos).toBe(1);
    expect(p.completo).toBe(false);
  });

  it("sin recorrido no hay pendiente: al mozo no se le enciende ningún badge", () => {
    const p = progresoDelRecorrido("mozo", modo, new Set());
    expect(p).toMatchObject({ total: 0, pendientes: 0, completo: true });
    expect(p.proximo).toBeUndefined();
  });
});

describe("posicionEnRecorrido", () => {
  const modo = "estricto" as const;

  it("ubica el tema y dice cuál sigue", () => {
    const pos = posicionEnRecorrido("cobrar", "encargado", modo);
    expect(pos).toMatchObject({ indice: 3, total: 9 });
    expect(pos?.siguiente?.slug).toBe("comandas");
  });

  it("el primero es 1 de 9, no 0", () => {
    expect(posicionEnRecorrido("caja", "encargado", modo)?.indice).toBe(1);
  });

  it("el último no tiene siguiente: ahí se termina", () => {
    const r = recorrido("encargado", modo);
    const ultimo = r[r.length - 1]!;
    const pos = posicionEnRecorrido(ultimo.slug, "encargado", modo);
    expect(pos?.indice).toBe(9);
    expect(pos?.siguiente).toBeUndefined();
  });

  it("un tema fuera del recorrido no tiene posición", () => {
    expect(posicionEnRecorrido("carta", "encargado", modo)).toBeNull();
  });
});

// ─── Spec 170 · la guía de la terminal ──────────────────────────────────────

describe("temasDeRol · la terminal (spec 170)", () => {
  it("tiene los seis temas suyos, y ninguno del encargado", () => {
    const suyos = temasDeRol("terminal");
    expect(suyos).toHaveLength(6);
    expect(suyos.every((t) => t.slug.startsWith("terminal-"))).toBe(true);
  });

  it("no ve la caja, la rendición ni cobrar: no son pantallas suyas", () => {
    const slugs = temasDeRol("terminal").map((t) => t.slug);
    for (const ajeno of ["caja", "rendicion", "cobrar", "pedidos"]) {
      expect(slugs).not.toContain(ajeno);
    }
  });

  it("arranca por la cuenta compartida, que es lo que no se deduce mirando", () => {
    expect(temasDeRol("terminal")[0]?.slug).toBe("terminal-la-compu");
  });

  it("el mozo sigue sin guía: la suya es otra spec", () => {
    expect(temasDeRol("mozo")).toHaveLength(0);
  });

  it("el encargado no se entera de nada: sigue con los suyos", () => {
    expect(temasDeRol("encargado").some((t) => t.slug.startsWith("terminal-"))).toBe(
      false,
    );
    expect(recorrido("encargado", "estricto")).toHaveLength(9);
  });
});

describe("recorrido de la terminal", () => {
  it("son seis y son todos suyos", () => {
    const r = recorrido("terminal", "estricto");
    expect(r).toHaveLength(6);
    expect(r.every((t) => rolesDe(t).includes("terminal"))).toBe(true);
  });

  it("termina en lo que NO se puede desde acá", () => {
    const r = recorrido("terminal", "estricto");
    expect(r[r.length - 1]?.slug).toBe("terminal-limites");
  });

  it("el pendiente de la terminal no se mezcla con el del encargado", () => {
    // Marcar leídos los nueve del encargado no le adelanta un solo tema.
    const delEncargado = new Set(
      recorrido("encargado", "estricto").map((t) => t.slug),
    );
    const p = progresoDelRecorrido("terminal", "estricto", delEncargado);
    expect(p).toMatchObject({ total: 6, leidos: 0, completo: false });
  });
});

describe("temaDeRol · el chip `?` abre el tema de quien mira", () => {
  it("la misma pantalla, dos temas: el chip pasa el slug de la tab", () => {
    // `TEMA_POR_TAB.salon === "mesas"` para los dos roles.
    expect(temaDeRol("mesas", "encargado")?.slug).toBe("mesas");
    expect(temaDeRol("mesas", "terminal")?.slug).toBe("terminal-salon");
  });

  it("las cuatro pestañas de la terminal resuelven a un tema suyo", () => {
    for (const tab of ["mesas", "comandas", "reservas", "fichaje"]) {
      const tema = temaDeRol(tab, "terminal");
      expect(tema, `la tab ${tab} no resuelve`).toBeDefined();
      expect(rolesDe(tema!)).toContain("terminal");
    }
  });

  it("un tema propio se encuentra por su slug, no sólo por equivalencia", () => {
    expect(temaDeRol("terminal-limites", "terminal")?.slug).toBe("terminal-limites");
  });

  it("un tema ajeno no se resuelve: la URL deja de estar abierta (D6)", () => {
    expect(temaDeRol("caja", "terminal")).toBeUndefined();
    expect(temaDeRol("terminal-salon", "encargado")).toBeUndefined();
  });
});

describe("equivalenciasDeRol", () => {
  it("mapea el slug de la tab al tema del rol, para el chip", () => {
    expect(equivalenciasDeRol("terminal")).toMatchObject({
      mesas: "terminal-salon",
    });
  });

  it("para el encargado no hay nada que traducir", () => {
    expect(equivalenciasDeRol("encargado")).toEqual({});
  });
});
