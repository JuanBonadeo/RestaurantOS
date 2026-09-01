import { describe, expect, it } from "vitest";

import {
  GRUPOS,
  TEMAS,
  estaEscrito,
  pasosDe,
  temaPorSlug,
  temaSiguiente,
  type Paso,
  type Tema,
} from "./contenido";

const RESERVAS = temaPorSlug("reservas")!;

// Todo el valor de esta guía está en que diga la verdad (D4 de la spec 134).
// Estos tests no prueban React: cuidan las tres formas en que el contenido se
// puede pudrir sin que nadie se entere.

describe("contenido de la guía · estructura", () => {
  it("los dieciséis temas, en orden y agrupados", () => {
    expect(TEMAS.map((t) => t.slug)).toEqual([
      // Tu turno
      "caja", "mesas", "cobrar", "comandas", "pedidos", "reservas", "rendicion", "fichaje",
      // El local
      "catalogo", "salones", "proveedores", "facturacion",
      // Los clientes
      "clientes", "promociones", "conversaciones",
      // Si algo falla
      "carteles",
    ]);
  });

  it("todo tema cae en un grupo que el índice pinta", () => {
    const ids = new Set(GRUPOS.map((g) => g.id));
    for (const tema of TEMAS) {
      expect(ids, `${tema.slug} tiene un grupo que no existe`).toContain(tema.grupo);
    }
  });

  it("no hay grupos vacíos: uno sin temas no se pinta y sobra", () => {
    for (const grupo of GRUPOS) {
      expect(
        TEMAS.some((t) => t.grupo === grupo.id),
        `el grupo «${grupo.titulo}» quedó sin temas`,
      ).toBe(true);
    }
  });

  // «Lo importante» es lo único que se lee cuando se entra apurado. Un tema sin
  // claves deja esa caja vacía; con seis, deja de ser un destaque y pasa a ser
  // otro párrafo más.
  it("cada tema tiene entre una y tres claves", () => {
    for (const tema of TEMAS) {
      expect(tema.claves.length, `${tema.slug}`).toBeGreaterThan(0);
      expect(tema.claves.length, `${tema.slug}`).toBeLessThanOrEqual(3);
    }
  });

  it("las claves son una línea, no un párrafo", () => {
    for (const tema of TEMAS) {
      for (const clave of tema.claves) {
        expect(clave.length, `${tema.slug}: «${clave}»`).toBeLessThanOrEqual(160);
      }
    }
  });

  it("ningún tema quedó vacío en ninguno de los dos modos", () => {
    for (const tema of TEMAS) {
      expect(estaEscrito(tema, "estricto"), `${tema.slug} en estricto`).toBe(true);
      expect(estaEscrito(tema, "flexible"), `${tema.slug} en flexible`).toBe(true);
    }
  });

  it("cada `verTambien` apunta a un tema que existe", () => {
    const slugs = new Set(TEMAS.map((t) => t.slug));
    const todos: Paso[] = TEMAS.flatMap((t) => [
      ...t.pasos,
      ...Object.values(t.pasosPorModo ?? {}).flat(),
    ]);
    for (const paso of todos) {
      if (paso.verTambien) {
        expect(slugs, `«${paso.titulo}» manda a un tema inexistente`).toContain(
          paso.verTambien.tema,
        );
      }
    }
  });

  it("una imagen sin `alt` no pasa: la guía la lee gente que agranda la letra", () => {
    const todos: Paso[] = TEMAS.flatMap((t) => [
      ...t.pasos,
      ...Object.values(t.pasosPorModo ?? {}).flat(),
    ]);
    for (const paso of todos) {
      if (paso.imagen) expect(paso.alt?.trim(), paso.titulo).toBeTruthy();
    }
  });
});

// D12 — el modo de reservas es por negocio y el tema tiene que seguirlo. Si
// alguien escribe un paso nuevo en un modo y se olvida del otro, o peor, hace
// que los dos devuelvan lo mismo, esto lo agarra acá y no en el salón.
describe("contenido de la guía · reservas mode-aware", () => {
  it("cada modo trae sus propios pasos", () => {
    const estricto = pasosDe(RESERVAS, "estricto");
    const flexible = pasosDe(RESERVAS, "flexible");
    expect(estricto.length).toBeGreaterThan(0);
    expect(flexible.length).toBeGreaterThan(0);
    expect(estricto).not.toEqual(flexible);
  });

  it("cada modo explica cómo se elige la hora en ESE modo", () => {
    // Ojo con asertar sobre la palabra "grilla" a secas: el texto flexible la
    // nombra para negarla («no hay grilla de turnos»), que es justo lo que
    // tiene que decir. Se compara contra la frase que sólo puede ser de uno.
    const texto = (ps: Paso[]) => ps.map((p) => `${p.titulo} ${p.texto}`).join(" ");
    expect(texto(pasosDe(RESERVAS, "estricto"))).toContain(
      "no escribís la hora a mano",
    );
    expect(texto(pasosDe(RESERVAS, "flexible"))).toContain(
      "Acá la hora se escribe",
    );
  });

  it("el sobre-cupo del encargado sólo se explica en flexible", () => {
    const texto = (ps: Paso[]) => ps.map((p) => p.texto).join(" ");
    expect(texto(pasosDe(RESERVAS, "flexible"))).toContain(
      "Confirmá para reservar igual",
    );
    expect(texto(pasosDe(RESERVAS, "estricto"))).not.toContain(
      "Confirmá para reservar igual",
    );
  });

  it("un tema sin `pasosPorModo` devuelve lo mismo para los dos", () => {
    const caja = temaPorSlug("caja")!;
    expect(pasosDe(caja, "estricto")).toEqual(pasosDe(caja, "flexible"));
  });
});

describe("contenido de la guía · navegación", () => {
  it("`temaSiguiente` encadena y termina en el último", () => {
    expect(temaSiguiente("caja", "estricto")?.slug).toBe("mesas");
    expect(temaSiguiente("carteles", "estricto")).toBeUndefined();
  });

  it("encadena a través de los grupos, no sólo dentro de uno", () => {
    // «fichaje» cierra Tu turno: el siguiente tiene que ser el primero de El
    // local. Si el encadenado se cortara por grupo, la guía se leería entera
    // sólo hasta el final del primer bloque.
    expect(temaSiguiente("fichaje", "estricto")?.slug).toBe("catalogo");
    expect(temaSiguiente("facturacion", "estricto")?.slug).toBe("clientes");
  });

  it("saltea los temas que todavía no están escritos", () => {
    // No se usa `TEMAS`: se arma el caso, porque hoy están todos escritos y
    // el salteo se rompería sin que ningún test se queje.
    const vacio: Tema = { ...temaPorSlug("mesas")!, pasos: [] };
    const lista = [temaPorSlug("caja")!, vacio, temaPorSlug("cobrar")!];
    const siguienteEscrito = lista
      .slice(1)
      .find((t) => estaEscrito(t, "estricto"));
    expect(siguienteEscrito?.slug).toBe("cobrar");
  });

  it("un slug que no existe no devuelve nada", () => {
    // Ojo al elegir el ejemplo: acá decía «rendicion», que era inexistente
    // hasta que la guía creció y pasó a ser un tema — el test lo agarró.
    // «reportes» y «configuracion» son secciones que el encargado NO ve, así
    // que difícilmente lleguen a ser temas de SU guía.
    expect(temaPorSlug("reportes")).toBeUndefined();
    expect(temaPorSlug("configuracion")).toBeUndefined();
  });
});
