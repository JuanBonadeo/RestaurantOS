import { test, expect, type Page } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId } from "./db";

/**
 * P02 · Se sientan, comen y se van — la columna vertebral.
 *
 * Caso de uso: wiki/qa/procesos/P02-se-sientan-comen-y-se-van.md
 *
 * Esto NO prueba pantallas: prueba la **costura** entre el plano, la mesa y el
 * cobro. Que cada una de las tres ande por separado no dice nada — el bug que
 * importa es que muestren números distintos del mismo consumo, y ése sólo
 * aparece cruzándolas.
 *
 * Lo esperado se deriva de la base, no se hardcodea: el seed arma la operación
 * del día con `Math.random()`.
 */
test.use({ storageState: storageState("encargada") });


/**
 * Abre el plano y espera a que el salón esté **vivo**, no sólo pintado.
 *
 * Sin esto los tests son flakies por hidratación: el server manda el HTML, el
 * botón de la mesa ya está visible y habilitado —o sea «accionable» para
 * Playwright— pero React todavía no le colgó el handler, así que el click se
 * pierde en el vacío y el panel nunca abre. El fallo sale como «no encuentro
 * Total de la mesa», que apunta al lugar equivocado.
 *
 * El contador de la pestaña sirve de señal porque lo calcula el cliente.
 */
async function abrirSalon(page: Page) {
  await page.goto(`/${SLUG}/admin/operacion?tab=salon`);
  await expect(page.getByRole("button", { name: /^Mesas \d+$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.describe("P02 · el plano, la mesa y el cobro dicen lo mismo", () => {
  test("el plano muestra las mesas que la base dice que están ocupadas", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: abiertas } = await db
      .from("orders")
      .select("id, table_id")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null);
    const ocupadas = (abiertas ?? []).length;
    expect(ocupadas, "el seed tiene que dejar mesas vivas").toBeGreaterThan(0);

    await abrirSalon(page);
    // La pestaña lleva el contador: «Mesas 12». Es el número que el encargado
    // mira de reojo toda la noche, y el que tiene que coincidir con la base.
    // El nombre accesible normaliza el salto de línea del markup a un espacio.
    await expect(
      page.getByRole("button", { name: `Mesas ${ocupadas}`, exact: true }),
    ).toBeVisible();
  });

  test("abrir una mesa muestra el total que la base tiene para esa mesa", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: orders } = await db
      .from("orders")
      .select("id, customer_name, total_cents, table_id")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .order("total_cents", { ascending: false })
      .limit(1);
    const orden = (orders ?? [])[0] as {
      customer_name: string;
      total_cents: number;
    };
    expect(orden).toBeTruthy();

    await abrirSalon(page);
    await page
      .getByRole("button", { name: new RegExp(escapeRe(orden.customer_name)) })
      .first()
      .click();

    // «Total de la mesa» es lo que el encargado le va a decir al cliente.
    await expect(page.getByText(/Total de la mesa/i).first()).toBeVisible();
    await expect(
      page.getByText(montoAR(orden.total_cents), { exact: false }).first(),
    ).toBeVisible();
  });

  test("«Cobrar» abre el cobro por el mismo total, sin recalcular nada", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: orders } = await db
      .from("orders")
      .select("customer_name, total_cents, total_paid_cents")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .order("total_cents", { ascending: false })
      .limit(1);
    const orden = (orders ?? [])[0] as {
      customer_name: string;
      total_cents: number;
      total_paid_cents: number;
    };
    const falta = orden.total_cents - orden.total_paid_cents;

    await abrirSalon(page);
    await page
      .getByRole("button", { name: new RegExp(escapeRe(orden.customer_name)) })
      .first()
      .click();
    await page.getByRole("button", { name: /^Cobrar/ }).first().click();

    // El salto de pantalla es donde un total se puede perder. Acá se verifica
    // que lo que se va a cobrar es lo que la mesa debía.
    await expect(page.getByText(montoAR(falta)).first()).toBeVisible();
  });
});

/** El monto como lo escribe la app: 127.500 (sin decimales, punto de miles). */
function montoAR(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
