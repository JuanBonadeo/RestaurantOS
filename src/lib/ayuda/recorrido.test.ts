import { describe, expect, it } from "vitest";

import { GRUPOS, TEMAS } from "./contenido";
import {
  posicionEnRecorrido,
  progresoDelRecorrido,
  recorrido,
  temasDeRol,
} from "./recorrido";

// Spec 169 · el recorrido de primer ingreso y el progreso de lectura.
//
// Todo lo de acá es lógica pura sobre TEMAS: qué temas le tocan a un rol, en
// qué orden se leen la primera vez, y cuánto falta. La tabla `ayuda_lecturas`
// entra sólo como un Set de slugs, así que esto se testea sin base.

void GRUPOS;

describe("temasDeRol", () => {
  it("el encargado y el admin ven todo lo que hay escrito hoy", () => {
    expect(temasDeRol("encargado")).toHaveLength(TEMAS.length);
    expect(temasDeRol("admin")).toHaveLength(TEMAS.length);
  });

  it("el mozo NO ve la guía del encargado", () => {
    // Hoy no hay un solo tema escrito para él (D9: es su propia spec). Lo que
    // importa es que no herede ésta: le imprime topes de autorización —el 25 %
    // de descuento, los $5.000 de caja— que no son suyos.
    const suyos = temasDeRol("mozo");
    expect(suyos).toHaveLength(0);
    expect(suyos.map((t) => t.slug)).not.toContain("caja");
  });

  it("la terminal tampoco: es el puesto del salón, no un encargado", () => {
    expect(temasDeRol("terminal")).toHaveLength(0);
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
