import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { landingPath } from "./section-gate";
import { canSee, type AdminSection } from "./sections";

/**
 * Spec 167 · D4 — el test recorre las carpetas, no busca un string.
 *
 * Un test que grepeara `canSee` reproduciría el error que cometí al abrir la
 * issue #250: contaba `operacion/movimientos` como agujero (rebota perfecto:
 * es un `permanentRedirect` a una página que sí gatea) y a `stock/configurar`
 * como defendida (llamaba a la guarda con `void` y tiraba el resultado).
 *
 * Lo que se chequea es la propiedad que importa: **toda carpeta de sección
 * tiene su puerta**. El que falla no es "faltó una llamada" sino "apareció una
 * sección sin gate", que es el modo de falla real — `reservas/configuracion`
 * se agregó después de la spec 140 y nadie se acordó de gatearla.
 */

const AUTHED = join(process.cwd(), "src/app/[business_slug]/admin/(authed)");

// Carpetas que NO son secciones del panel. Chica y justificada a propósito: si
// crece, es señal de que algo se está escondiendo acá en vez de tener puerta.
const NO_SON_SECCIONES = new Set<string>([]);

function carpetasDeSeccion(): string[] {
  return readdirSync(AUTHED, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // Los route groups `(…)` y las rutas dinámicas `[…]` no son secciones.
    .filter((n) => !n.startsWith("(") && !n.startsWith("["))
    .filter((n) => !NO_SON_SECCIONES.has(n))
    .sort();
}

describe("cada sección del panel tiene su puerta (spec 167)", () => {
  it("toda carpeta bajo (authed) tiene layout.tsx", () => {
    const sinLayout = carpetasDeSeccion().filter(
      (c) => !existsSync(join(AUTHED, c, "layout.tsx")),
    );

    expect(
      sinLayout,
      `estas carpetas no tienen layout.tsx, así que sus páginas quedan libradas a ` +
        `su propio gate — y la próxima página que se agregue adentro nace abierta: ` +
        `${sinLayout.join(", ")}`,
    ).toEqual([]);
  });

  it("todo layout de sección gatea, y con una sección de verdad", () => {
    const problemas: string[] = [];

    for (const carpeta of carpetasDeSeccion()) {
      const ruta = join(AUTHED, carpeta, "layout.tsx");
      if (!existsSync(ruta)) continue; // ya lo reporta el test de arriba
      const fuente = readFileSync(ruta, "utf8");

      // Los tres mecanismos válidos. `configuracion/` usa `canManageBusiness`
      // (admin-only, más restrictivo que su celda) y `conversaciones/` usa
      // `sectionAccess(...) === "none"` desde la spec 32; los dos son puertas
      // legítimas y anteriores a esta spec.
      const gatea =
        /gateSection\(\s*"([a-z]+)"/.test(fuente) ||
        /sectionAccess\(\s*"([a-z]+)"/.test(fuente) ||
        /canManageBusiness\(/.test(fuente);

      if (!gatea) {
        problemas.push(`${carpeta}/layout.tsx no gatea nada`);
        continue;
      }

      // Si nombra una sección, tiene que existir en la matriz. Un typo dejaría
      // `canSee` devolviendo "none" para todos y la sección muerta para el
      // admin — un fallo cerrado, silencioso y difícil de rastrear.
      const m =
        fuente.match(/gateSection\(\s*"([a-z-]+)"/) ??
        fuente.match(/sectionAccess\(\s*"([a-z-]+)"/);
      if (m) {
        const seccion = m[1] as AdminSection;
        if (!canSee(seccion, "admin")) {
          problemas.push(
            `${carpeta}/layout.tsx nombra la sección "${seccion}", que no existe en la matriz`,
          );
        }
      }
    }

    expect(problemas, problemas.join(" · ")).toEqual([]);
  });

  // Las nueve que un mozo abría tipeando la URL, medidas en vivo antes de esta
  // spec. Acá se fija la intención: si alguna vuelve a `mozo: "full"` en la
  // matriz, que sea una decisión y no un descuido.
  it("las secciones que estaban abiertas siguen cerradas para mozo y terminal", () => {
    const cerradas: AdminSection[] = [
      "clientes",
      "catalogo",
      "promociones",
      "campanas",
      "salones",
      "reservas",
      "pedidos",
    ];
    for (const s of cerradas) {
      expect(canSee(s, "mozo"), `${s} abierta al mozo`).toBe(false);
      expect(canSee(s, "terminal"), `${s} abierta al terminal`).toBe(false);
      expect(canSee(s, "personal"), `${s} abierta al personal`).toBe(false);
    }
  });

  it("y las que son suyas siguen abiertas", () => {
    // La Ayuda es del mozo desde la spec 142 y del terminal desde la 140.
    expect(canSee("ayuda", "mozo")).toBe(true);
    expect(canSee("ayuda", "terminal")).toBe(true);
    // Operación es del terminal — es el puesto del salón.
    expect(canSee("operacion", "terminal")).toBe(true);
    expect(canSee("operacion", "mozo")).toBe(false);
  });
});

/**
 * Este bloque existe por un bug que introdujo esta misma spec y que apareció en
 * el verify: el gate redirigía siempre a `/{slug}/admin`, y con un mozo el
 * navegador se colgó en `/demo/admin → /demo/admin/operacion → /demo/admin → …`
 * infinito. El dashboard rebota a Operación a quien no lo ve, y el layout de
 * Operación rebotaba de vuelta al dashboard.
 *
 * Antes no podía pasar porque quien cortaba la cadena era `operacion/page.tsx`
 * mandando a `/mozo` — y un layout corre ANTES que su página. Mover el gate al
 * layout borró ese corte.
 */
describe("a dónde rebota el que no puede ver la sección", () => {
  const NO_PA = { isPlatformAdmin: false };

  it("cada rol cae donde efectivamente puede estar", () => {
    expect(landingPath("demo", "admin", NO_PA)).toBe("/demo/admin");
    // El encargado no ve el dashboard desde 2026-07-25: su turno es Operación.
    expect(landingPath("demo", "encargado", NO_PA)).toBe("/demo/admin/operacion");
    expect(landingPath("demo", "terminal", NO_PA)).toBe("/demo/admin/operacion");
    // El mozo no ve ninguna de las dos: su superficie es /mozo.
    expect(landingPath("demo", "mozo", NO_PA)).toBe("/demo/mozo");
    expect(landingPath("demo", "personal", NO_PA)).toBe("/demo/mozo");
  });

  it("el platform admin sin rol en el negocio cae en el dashboard", () => {
    expect(landingPath("demo", null, { isPlatformAdmin: true })).toBe("/demo/admin");
  });

  // La invariante que impide el ciclo, escrita como invariante y no como lista
  // de casos: si el destino es una sección del panel, el rol tiene que verla.
  it("nunca manda a un lugar del panel que el rol no vea", () => {
    const roles = ["admin", "encargado", "mozo", "terminal", "personal"] as const;
    for (const role of roles) {
      const destino = landingPath("demo", role, NO_PA);
      if (destino === "/demo/admin") {
        expect(canSee("dashboard", role), `${role} → dashboard que no ve`).toBe(true);
      } else if (destino === "/demo/admin/operacion") {
        expect(canSee("operacion", role), `${role} → operación que no ve`).toBe(true);
      } else {
        expect(destino, `${role} cayó fuera del panel a un lugar raro`).toBe("/demo/mozo");
      }
    }
  });
});
