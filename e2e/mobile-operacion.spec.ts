import { test, expect, type Page } from "@playwright/test";

import { SLUG, storageState } from "./roles";

/**
 * La operación en el teléfono — 375px.
 *
 * No es un proceso del tablero: es una guarda transversal que aplica a P02 y
 * P05. El mozo no trabaja sentado frente a un monitor, trabaja parado, con una
 * mano, apurado y con la pantalla llena de sol. Dos cosas lo rompen y las dos
 * son invisibles desde un desktop de 1280px:
 *
 *   1. **Overflow horizontal.** Una tabla o una fila que se pasa unos píxeles
 *      convierte toda la pantalla en un carrusel lateral, y el botón que
 *      importa queda afuera.
 *   2. **Tap targets chicos.** Debajo de ~44px el dedo falla; abajo de 32 es
 *      lotería. En hora pico un tap fallado es un plato que no salió.
 *
 * Se corre con la sesión del **mozo**, que es el rol que de verdad usa esto.
 */
test.use({
  viewport: { width: 375, height: 812 },
  isMobile: true,
  hasTouch: true,
  storageState: storageState("mozo"),
});

const PANTALLAS = [
  { nombre: "el home del mozo", url: `/${SLUG}/mozo` },
  { nombre: "el plano del salón", url: `/${SLUG}/admin/operacion?tab=salon` },
  { nombre: "el tablero de comandas", url: `/${SLUG}/admin/operacion?tab=comandas` },
];

/** Espera a que la pantalla tenga contenido real, no el esqueleto de Suspense. */
async function cargar(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("button").first()).toBeVisible({ timeout: 30_000 });
}

for (const p of PANTALLAS) {
  test(`375px · ${p.nombre} no se va de ancho`, async ({ page }) => {
    await cargar(page, p.url);

    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));

    // Un par de píxeles de tolerancia: el redondeo subpíxel no es un bug.
    expect(
      scrollW,
      `la página scrollea de costado (${scrollW}px sobre ${clientW}px de pantalla)`,
    ).toBeLessThanOrEqual(clientW + 2);
  });

  test(`375px · ${p.nombre} no tiene botones imposibles de tocar`, async ({
    page,
  }) => {
    await cargar(page, p.url);

    const chicos = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // oculto
        if (r.height < 32 || r.width < 32) {
          const txt = (el.textContent || el.getAttribute("aria-label") || "?")
            .trim()
            .slice(0, 24);
          out.push(`«${txt}» ${Math.round(r.width)}×${Math.round(r.height)}px`);
        }
      }
      return out;
    });

    // 32px es el piso, no el objetivo: la guía de Apple pide 44. Se afirma
    // sobre el piso para que el test hable sólo de lo que es directamente un
    // problema de uso, y no de preferencias de diseño.
    expect(chicos, chicos.join(" · ")).toEqual([]);
  });
}
