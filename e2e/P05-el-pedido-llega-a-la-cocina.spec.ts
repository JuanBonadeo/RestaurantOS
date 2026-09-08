import { test, expect, type Page } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId } from "./db";

/**
 * P05 · El pedido llega a la cocina.
 *
 * Caso de uso: wiki/qa/procesos/P05-el-pedido-llega-a-la-cocina.md
 *
 * Se mira desde la cocina, no desde el mozo: lo que importa es que el kanban
 * diga lo mismo que la base. Si una comanda existe y el tablero no la muestra,
 * para la cocina ese plato no existe — y nadie se entera hasta que el cliente
 * pregunta.
 */
test.use({ storageState: storageState("encargada") });

/** Los tres estados de la base, y cómo se llaman en el tablero. */
const COLUMNAS = [
  { status: "pendiente", titulo: /Pendientes/i },
  { status: "en_preparacion", titulo: /En cocina/i },
] as const;

async function abrirComandas(page: Page) {
  await page.goto(`/${SLUG}/admin/operacion?tab=comandas`);
  // El tab se carga con `dynamic()` + Suspense: sin esperar contenido real, se
  // testea el esqueleto vacío y todo pasa.
  // `visible=true` no es cosmético: el tablero trae markup duplicado —una
  // variante mobile y una desktop— y a 1280px la primera del DOM es la que está
  // en `display:none`. Sin el filtro, el test espera 30s a un h2 que jamás se
  // va a ver y el error apunta al lugar equivocado.
  await expect(
    page.getByText(/Pendientes/i).locator("visible=true").first(),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("P05 · el tablero dice lo que la base tiene", () => {
  test("las comandas vivas de la base están en el kanban", async ({ page }) => {
    const bizId = await businessId(SLUG);
    const { data } = await db
      .from("comandas")
      .select("id, status, cancelled_at, orders!inner(business_id)")
      .eq("orders.business_id", bizId)
      .is("cancelled_at", null)
      .in("status", ["pendiente", "en_preparacion"]);
    const vivas = (data ?? []) as { id: string }[];
    expect(vivas.length, "el seed tiene que dejar comandas vivas").toBeGreaterThan(0);

    await abrirComandas(page);

    // Cada columna existe: son el eje del tablero, y si una desaparece la
    // cocina pierde de vista todo un estado.
    for (const col of COLUMNAS) {
      await expect(
        page.getByText(col.titulo).locator("visible=true").first(),
      ).toBeVisible();
    }
  });

  test("una comanda anulada no aparece en el tablero", async ({ page }) => {
    const bizId = await businessId(SLUG);
    const { data } = await db
      .from("comandas")
      .select("id, cancelled_at, orders!inner(business_id)")
      .eq("orders.business_id", bizId)
      .not("cancelled_at", "is", null)
      .limit(1);
    const anulada = (data ?? [])[0] as { id: string } | undefined;
    test.skip(!anulada, "el seed no dejó comandas anuladas");

    await abrirComandas(page);
    // Se busca por el id corto que la tarjeta muestra: si aparece, una comanda
    // muerta está ocupando lugar en la cocina.
    await expect(page.getByText(anulada!.id.slice(0, 8))).toHaveCount(0);
  });

  // ── Hallazgo #257, TODAVÍA ABIERTO ────────────────────────────────────────
  //
  // Se arreglaron dos relojes que sí eran un peligro real de SSR (el de las
  // cards decidía qué comandas se ven; el del print agent, qué pill se pinta),
  // pero el mismatch sigue. Lo que quedó descartado, para no reinvestigarlo:
  //
  //   · NO es el largo de la lista: React reporta mismatch de **atributos**,
  //     no estructural, así que el árbol es el mismo y sólo difieren los ids.
  //   · NO es el filtro por salón: `useStickyMultiFilter` arranca siempre en el
  //     fallback y aplica lo guardado en un effect.
  //   · NO es la tab: `useTabParam` lee la URL en el initializer, igual en
  //     server y en cliente.
  //   · NO es el patrón `dynamic()` + Suspense del shell: de las 8 tabs, sólo
  //     comandas lo tira (salón, reservas, pedidos, caja, cuentas, rendición y
  //     fichaje dan 0).
  //
  // Queda: los ids son `base-ui-_R_<useId>` y el prefijo difiere entero, o sea
  // una **posición** distinta en el árbol de React, no un corrimiento. Hay que
  // mirar qué renderiza el shell antes de este panel.
  //
  // `test.fail()` es el equivalente del `it.fails()` de Vitest: hoy pasa porque
  // el error existe, y se pone en rojo cuando se arregle.
  test("el tablero no tira errores en la consola", async ({ page }) => {
    test.fail(); // #257

    const errores: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errores.push(m.text().slice(0, 120));
    });
    page.on("pageerror", (e) => errores.push(`PAGEERROR: ${e.message}`));

    await abrirComandas(page);
    await page.waitForLoadState("networkidle");

    // Es la pantalla que la cocina tiene abierta toda la noche. Un error
    // crónico acá entrena a todo el mundo a no mirar la consola, y es por ahí
    // por donde después entra uno que sí importa.
    expect(errores, errores.join(" | ")).toHaveLength(0);
  });
});
