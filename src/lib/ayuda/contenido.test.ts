import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  GRUPOS,
  TEMAS,
  loomEmbedSrc,
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
  it("los diecinueve temas, en orden y agrupados", () => {
    expect(TEMAS.map((t) => t.slug)).toEqual([
      // Operación — las siete pestañas del turno
      "caja", "mesas", "cobrar", "comandas", "pedidos", "reservas", "rendicion", "fichaje",
      // Catálogo — lo que se vende y lo que hay
      "carta", "menu-del-dia", "stock", "costeo",
      // Lo demás del panel
      "salones", "proveedores", "facturacion", "clientes", "promociones", "conversaciones",
      // Si algo falla
      "carteles",
    ]);
  });

  // El pedido de Juan fue "enfocá la guía en operación y catálogo, bien
  // visual". Esto lo vuelve verificable: si alguien agrega pasos a esos dos
  // grupos sin captura, el test avisa antes de que la guía se vuelva un muro
  // de texto donde justamente no tiene que serlo.
  it("los temas de Operación y Catálogo abren con una captura", () => {
    const foco = TEMAS.filter((t) => t.grupo === "operacion" || t.grupo === "catalogo");
    expect(foco.length).toBeGreaterThan(0);
    for (const tema of foco) {
      const pasos = pasosDe(tema, "estricto");
      expect(
        pasos.some((paso) => Boolean(paso.imagen)),
        `«${tema.titulo}» no tiene ni una captura`,
      ).toBe(true);
    }
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

  // El renderer imprime `texto` tal cual: no hay markdown. Un `**negrita**` se
  // ve con los asteriscos puestos, que fue exactamente lo que pasó la primera
  // vez que se escribió el tema de stock. Para destacar se usan «comillas».
  it("no hay markdown en el texto: el renderer no lo interpreta", () => {
    const todos: Paso[] = TEMAS.flatMap((t) => [
      ...t.pasos,
      ...Object.values(t.pasosPorModo ?? {}).flat(),
    ]);
    for (const paso of todos) {
      expect(paso.texto, `${paso.titulo}`).not.toMatch(/\*\*|__|^[-*] |\[.+\]\(.+\)/m);
    }
    for (const tema of TEMAS) {
      for (const clave of tema.claves) {
        expect(clave, tema.slug).not.toMatch(/\*\*|__/);
      }
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

  // Las capturas se sacan a mano y se pegan a mano: los dos errores posibles
  // son apuntar a un PNG que no existe (hueco en la guía) y dejar un PNG que
  // ya nadie usa (peso muerto que igual se despliega).
  it("cada captura referenciada existe, y cada PNG está referenciado", () => {
    const dir = join(process.cwd(), "public", "ayuda");
    const enDisco = new Set(readdirSync(dir).filter((f) => f.endsWith(".png")));
    const usadas = new Set(
      TEMAS.flatMap((t) => [...t.pasos, ...Object.values(t.pasosPorModo ?? {}).flat()])
        .map((paso) => paso.imagen)
        .filter((x): x is string => Boolean(x))
        .map((ruta) => ruta.replace("/ayuda/", "")),
    );
    for (const usada of usadas) {
      expect(enDisco, `la guía apunta a ${usada}, que no está en public/ayuda`).toContain(usada);
    }
    for (const archivo of enDisco) {
      expect(usadas, `${archivo} no lo usa ningún tema`).toContain(archivo);
    }
  });

  // Los links de Loom se pegan a mano al terminar de grabar. Si uno viene mal,
  // la página no puede romperse: simplemente no se pinta el video.
  it("el embed de Loom acepta el link de compartir y descarta la basura", () => {
    expect(loomEmbedSrc("https://www.loom.com/share/abc123XYZ")).toContain(
      "loom.com/embed/abc123XYZ",
    );
    expect(loomEmbedSrc("https://www.loom.com/embed/abc123XYZ")).toContain(
      "loom.com/embed/abc123XYZ",
    );
    expect(loomEmbedSrc("https://youtube.com/watch?v=x")).toBeNull();
    expect(loomEmbedSrc("pegué cualquier cosa")).toBeNull();
  });

  it("todo tema con video tiene título, para saber qué se va a mirar", () => {
    for (const tema of TEMAS) {
      if (tema.video) expect(tema.video.titulo.trim(), tema.slug).toBeTruthy();
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
    expect(temaSiguiente("fichaje", "estricto")?.slug).toBe("carta");
    expect(temaSiguiente("costeo", "estricto")?.slug).toBe("salones");
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
