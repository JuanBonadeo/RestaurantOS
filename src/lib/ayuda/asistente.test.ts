import { describe, expect, it } from "vitest";

import {
  guiaComoTexto,
  respuestaLimpia,
  systemPrompt,
  temasCitados,
} from "./asistente";
import { TEMAS } from "./contenido";

// Lo que se testea acá NO es el modelo —eso no se puede testear— sino lo que
// nosotros le damos y lo que hacemos con lo que devuelve. Que es donde están
// los errores que le costarían plata al local.

describe("asistente · el contexto", () => {
  it("mete los diecinueve temas, con su identificador", () => {
    const texto = guiaComoTexto("estricto");
    for (const tema of TEMAS) {
      expect(texto, `falta ${tema.slug}`).toContain(`[${tema.slug}]`);
      expect(texto, `falta el título de ${tema.slug}`).toContain(tema.titulo);
    }
  });

  // Es la razón de mandar la guía entera en vez de recuperar fragmentos: el
  // aviso en rojo tiene que viajar SIEMPRE con su paso. Un recuperador que trae
  // "los tres pasos más parecidos" es justo el que se lo deja afuera.
  it("los avisos viajan con su paso, marcados", () => {
    const texto = guiaComoTexto("estricto");
    const peligros = TEMAS.flatMap((t) => t.pasos).filter(
      (p) => p.aviso?.tono === "peligro",
    );
    expect(peligros.length).toBeGreaterThan(0);
    for (const paso of peligros) {
      expect(texto).toContain(`[PELIGRO] ${paso.aviso!.texto}`);
    }
  });

  it("incluye «lo importante» de cada tema", () => {
    const texto = guiaComoTexto("estricto");
    for (const tema of TEMAS) {
      for (const clave of tema.claves) expect(texto).toContain(clave);
    }
  });

  // Mismo criterio que la guía en pantalla (D12): el encargado tiene que ver un
  // solo modo. Si el contexto trae los dos, el asistente le va a explicar el
  // que no usa, que es peor que no contestar.
  it("el contexto trae sólo el modo del negocio", () => {
    const estricto = guiaComoTexto("estricto");
    const flexible = guiaComoTexto("flexible");
    expect(estricto).toContain("no escribís la hora a mano");
    expect(estricto).not.toContain("Confirmá para reservar igual");
    expect(flexible).toContain("Confirmá para reservar igual");
    expect(flexible).not.toContain("no escribís la hora a mano");
  });

  it("entra cómodo en un prompt: por eso no hace falta recuperación", () => {
    // Si esto se dispara, la guía creció mucho y toca revisar la decisión de
    // mandarla entera (ver el comentario de cabecera de `asistente.ts`).
    expect(guiaComoTexto("estricto").length).toBeLessThan(150_000);
  });
});

describe("asistente · el prompt", () => {
  it("prohíbe inventar y obliga a decir que no sabe", () => {
    const p = systemPrompt("estricto");
    expect(p).toContain("TU ÚNICA FUENTE ES LA GUÍA");
    expect(p).toContain("Eso no está en la guía");
    expect(p).toContain("NUNCA inventes una frase de la pantalla");
  });

  it("le dice el modo del negocio y le prohíbe mencionar el otro", () => {
    expect(systemPrompt("flexible")).toContain('modo de reservas de este negocio es "flexible"');
    expect(systemPrompt("estricto")).toContain("No menciones que existe otro modo");
  });
});

describe("asistente · lo que devuelve el modelo", () => {
  it("saca los temas citados", () => {
    expect(temasCitados("Mirá el tema [caja] y también [cobrar].")).toEqual([
      "caja",
      "cobrar",
    ]);
  });

  // El modelo puede inventar un identificador. Si se pintara igual, el link
  // llevaría a un 404 desde adentro de la propia ayuda.
  it("descarta identificadores que no existen", () => {
    expect(temasCitados("Está en [inventado] y en [caja].")).toEqual(["caja"]);
  });

  it("no repite un tema citado dos veces", () => {
    expect(temasCitados("[caja] y de nuevo [caja]")).toEqual(["caja"]);
  });

  it("limpia los identificadores del texto que se lee", () => {
    expect(respuestaLimpia("Cerrá la caja [caja] y listo.")).toBe(
      "Cerrá la caja y listo.",
    );
  });

  it("no deja dobles espacios al limpiar", () => {
    expect(respuestaLimpia("Uno [caja] dos [cobrar] tres")).toBe("Uno dos tres");
  });
});
