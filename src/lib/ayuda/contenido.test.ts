import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DESCUENTO_MEDIO_PCT,
  DIFERENCIA_CAJA_OK_CENTS,
} from "@/lib/permissions/can";

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
import { temasDeRol } from "./recorrido";

const RESERVAS = temaPorSlug("reservas")!;

// Todo el valor de esta guía está en que diga la verdad (D4 de la spec 134).
// Estos tests no prueban React: cuidan las tres formas en que el contenido se
// puede pudrir sin que nadie se entere.

describe("contenido de la guía · estructura", () => {
  it("los veinte temas, en orden y agrupados", () => {
    expect(TEMAS.map((t) => t.slug)).toEqual([
      // Operación — las ocho pestañas del turno
      "caja", "mesas", "cobrar", "comandas", "pedidos", "reservas",
      "cuentas-corrientes", "rendicion", "fichaje",
      // Catálogo — lo que se vende y lo que hay
      "carta", "menu-del-dia", "stock", "costeo",
      // Lo demás del panel
      "salones", "proveedores", "facturacion", "clientes", "promociones", "conversaciones",
      // Si algo falla
      "carteles",
      // La guía de la terminal (spec 170) — otro rol, otras pantallas. Va al
      // final del array y NO se mezcla: `temasDeRol` es lo que las separa.
      "terminal-la-compu", "terminal-salon", "terminal-comandas",
      "terminal-reservas", "terminal-fichaje", "terminal-limites",
    ]);
  });

  // El pedido de Juan fue "enfocá la guía en operación y catálogo, bien
  // visual". Esto lo vuelve verificable: si alguien agrega pasos a esos dos
  // grupos sin captura, el test avisa antes de que la guía se vuelva un muro
  // de texto donde justamente no tiene que serlo.
  it("los temas de Operación y Catálogo abren con una captura", () => {
    // Dos excepciones, las dos porque NO documentan una pantalla y no habría
    // qué capturar (spec 170): «Esta compu es de todos» explica de quién es la
    // plata de una mesa, y «Lo que desde acá no se puede» es la lista de lo
    // que está ausente. Cualquier tema que sí muestre una pantalla entra igual.
    const SIN_PANTALLA = ["terminal-la-compu", "terminal-limites"];
    const foco = TEMAS.filter(
      (t) =>
        (t.grupo === "operacion" || t.grupo === "catalogo") &&
        !SIN_PANTALLA.includes(t.slug),
    );
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

  /**
   * El «?» de cada pestaña de Operación linkea a `/admin/ayuda/<slug>` con el
   * valor que `TEMA_POR_TAB` tiene para esa tab, y la página hace `notFound()`
   * con un slug que no existe. `Record<Tab, string>` obliga a poner una entrada
   * por tab, pero **no** obliga a que apunte a un tema escrito: la spec 141 sumó
   * «Cuentas corrientes» al mapa sin el tema, y el «?» de esa tab fue un 404 en
   * producción hasta la issue #236.
   *
   * Se lee del fuente en vez de importar el módulo a propósito: `local-shell`
   * es un componente cliente enorme y traerlo entero a un test de contenido
   * costaría más que el chequeo.
   */
  it("el «?» de cada pestaña apunta a un tema que existe", () => {
    const fuente = readFileSync(
      join(process.cwd(), "src/components/admin/local/local-shell.tsx"),
      "utf8",
    );
    const bloque = fuente.match(
      /const TEMA_POR_TAB: Record<Tab, string> = \{([^}]*)\}/,
    );
    expect(bloque, "no se encontró TEMA_POR_TAB en local-shell.tsx").not.toBeNull();

    const slugs = [...bloque![1].matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map(
      ([, tab, slug]) => ({ tab, slug }),
    );
    expect(slugs.length, "TEMA_POR_TAB quedó vacío o cambió de forma").toBeGreaterThan(0);

    for (const { tab, slug } of slugs) {
      expect(
        temaPorSlug(slug),
        `la tab «${tab}» manda a «${slug}», que no es un tema de la guía`,
      ).toBeDefined();
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
  // El día que el cliente devuelva la matriz con otros topes, se cambian en
  // `can.ts` y la guía tiene que seguirlos sola. Este test es lo que evita que
  // alguien vuelva a tipear "25%" a mano en un paso nuevo.
  it("los topes salen de `can.ts`, no están tipeados en el texto", () => {
    const todo = TEMAS.flatMap((t) => [
      ...t.claves,
      ...[...t.pasos, ...Object.values(t.pasosPorModo ?? {}).flat()].flatMap((p) => [
        p.titulo,
        p.texto,
        p.aviso?.texto ?? "",
      ]),
    ]).join(" ");

    // Los valores actuales SÍ tienen que aparecer — vienen de la constante.
    expect(todo).toContain(`${DESCUENTO_MEDIO_PCT}%`);
    expect(todo).toContain(
      new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
      }).format(DIFERENCIA_CAJA_OK_CENTS / 100),
    );

    // Y no pueden estar tipeados en el fuente. Se mira el ARCHIVO, no el valor
    // resuelto: en runtime `${TOPE_DESCUENTO}` y "25%" son idénticos, y lo que
    // se quiere prohibir es justamente la forma de escribirlo.
    const fuente = readFileSync(
      join(process.cwd(), "src", "lib", "ayuda", "contenido.ts"),
      "utf8",
    );
    // Sólo el cuerpo de los temas: la cabecera y las constantes sí los nombran.
    const cuerpo = fuente.slice(fuente.indexOf("export const TEMAS"));
    expect(cuerpo, "hay un «25%» tipeado a mano: usá TOPE_DESCUENTO").not.toMatch(/\b25\s?%/);
    expect(cuerpo, "hay un «$5.000» tipeado a mano: usá TOPE_DIFERENCIA_CAJA").not.toMatch(
      /\$\s?5\.000/,
    );
  });

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
    // Se le pasan los temas del rol (spec 170): sin eso, el encargado que
    // termina «Me apareció un cartel» seguiría hacia la guía de la terminal,
    // que es de otras pantallas y de otros permisos.
    const delEncargado = temasDeRol("encargado");
    expect(temaSiguiente("caja", "estricto", delEncargado)?.slug).toBe("mesas");
    expect(temaSiguiente("carteles", "estricto", delEncargado)).toBeUndefined();
  });

  it("el encadenado de la terminal no se sale de su guía", () => {
    const suyos = temasDeRol("terminal");
    expect(temaSiguiente("terminal-la-compu", "estricto", suyos)?.slug).toBe(
      "terminal-salon",
    );
    expect(temaSiguiente("terminal-limites", "estricto", suyos)).toBeUndefined();
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
