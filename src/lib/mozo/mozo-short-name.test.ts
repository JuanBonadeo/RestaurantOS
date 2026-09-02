import { describe, expect, it } from "vitest";

import { buildMozoShortNames } from "./mozo-short-name";

const m = (user_id: string, full_name: string | null) => ({
  user_id,
  full_name,
});

describe("buildMozoShortNames", () => {
  it("con un solo Juan la mesa dice «Juan», aunque haya apellido", () => {
    const out = buildMozoShortNames([
      m("u1", "Juan Bonadeo"),
      m("u2", "Sofía Ruiz"),
    ]);
    expect(out.get("u1")).toBe("Juan");
    expect(out.get("u2")).toBe("Sofía");
  });

  it("dos Juanes se separan con la inicial del apellido, mayúscula y punto", () => {
    const out = buildMozoShortNames([
      m("u1", "Juan Bonadeo"),
      m("u2", "juan carrizo"),
      m("u3", "Pedro Gómez"),
    ]);
    expect(out.get("u1")).toBe("Juan B.");
    expect(out.get("u2")).toBe("Juan C.");
    // El tercero no está empatado: no paga el desempate de los otros.
    expect(out.get("u3")).toBe("Pedro");
  });

  it("si además comparten la inicial, suma las iniciales que faltan", () => {
    const out = buildMozoShortNames([
      m("u1", "Juan Pérez Luna"),
      m("u2", "Juan Paz Roldán"),
    ]);
    expect(out.get("u1")).toBe("Juan P. L.");
    expect(out.get("u2")).toBe("Juan P. R.");
  });

  it("último recurso: el nombre completo", () => {
    const out = buildMozoShortNames([
      m("u1", "Juan Pérez"),
      m("u2", "Juan Páez"),
    ]);
    expect(out.get("u1")).toBe("Juan Pérez");
    expect(out.get("u2")).toBe("Juan Páez");
  });

  it("dos nombres idénticos no inventan nada: quedan iguales", () => {
    const out = buildMozoShortNames([
      m("u1", "Juan Pérez"),
      m("u2", "Juan Pérez"),
    ]);
    expect(out.get("u1")).toBe("Juan Pérez");
    expect(out.get("u2")).toBe("Juan Pérez");
  });

  it("el que no tiene apellido se queda con el nombre pelado", () => {
    const out = buildMozoShortNames([m("u1", "Juan"), m("u2", "Juan Bonadeo")]);
    expect(out.get("u1")).toBe("Juan");
    expect(out.get("u2")).toBe("Juan B.");
  });

  it("arregla el grito del alta apurada sin tocar el apellido mixto", () => {
    const out = buildMozoShortNames([
      m("u1", "MARÍA LÓPEZ"),
      m("u2", "maría DiPaolo"),
    ]);
    expect(out.get("u1")).toBe("María L.");
    expect(out.get("u2")).toBe("María D.");
  });

  it("sin nombre cargado no hay rótulo (la mesa queda sin nada)", () => {
    const out = buildMozoShortNames([
      m("u1", null),
      m("u2", "   "),
      m("u3", "Ana"),
    ]);
    expect(out.has("u1")).toBe(false);
    expect(out.has("u2")).toBe(false);
    expect(out.get("u3")).toBe("Ana");
  });

  it("un mozo repetido en la lista no se desempata contra sí mismo", () => {
    const out = buildMozoShortNames([
      m("u1", "Juan Bonadeo"),
      m("u1", "Juan Bonadeo"),
    ]);
    expect(out.get("u1")).toBe("Juan");
  });
});
