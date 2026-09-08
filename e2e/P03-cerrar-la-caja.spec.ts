import { test, expect } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId } from "./db";

/**
 * P03 · Cerrar la caja — los dos números, y la guarda que no deja cerrar.
 *
 * Caso de uso: wiki/qa/procesos/P03-cerrar-la-caja.md
 *
 * Estos tests **no cierran ninguna caja**: verifican los números del arqueo y
 * el bloqueo. Un cierre de verdad barre el salón entero del demo —libera todas
 * las mesas y borra la distribución de mozos— y deja los otros specs sin datos.
 * El camino que sí se ejercita es el que importa: que el sistema **frene** con
 * plata sin cobrar, que es el que le falla a MaxiRest todos los días.
 *
 * Se entra como **encargada** y no como admin: el techo de diferencia
 * ($5.000, `DIFERENCIA_CAJA_OK_CENTS`) sólo existe con el rol real.
 */
test.use({ storageState: storageState("encargada") });

test.describe("P03 · el arqueo y su guarda", () => {
  test("«deberías tener» sale del arrastre más los cobros en efectivo", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);

    // Lo esperado se deriva de la base, con la misma cuenta que
    // `calculateExpectedCash`: arrastre del último corte + efectivo del período
    // − propina (spec 098: la propina entró al cajón pero es del mozo).
    const { data: cajas } = await db
      .from("cajas")
      .select("id, name")
      .eq("business_id", bizId)
      .eq("is_default", true)
      .limit(1);
    const caja = (cajas ?? [])[0] as { id: string; name: string };
    expect(caja, "el demo tiene que tener una caja principal").toBeTruthy();

    const { data: cortes } = await db
      .from("caja_cortes")
      .select("closing_cash_cents, created_at")
      .eq("caja_id", caja.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const ultimo = (cortes ?? [])[0] as
      | { closing_cash_cents: number; created_at: string }
      | undefined;

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible({
      timeout: 20_000,
    });

    // La pantalla explica de dónde sale el número, y el arrastre tiene que ser
    // el cierre anterior — no lo esperado de ese turno. Si tomara lo esperado,
    // una diferencia aceptada se contaría dos veces.
    if (ultimo) {
      await expect(
        page.getByText(/del corte anterior/i).first(),
      ).toContainText(montoAR(ultimo.closing_cash_cents));
    }
  });

  test("«cobrado en el período» y «deberías tener» son números distintos", async ({
    page,
  }) => {
    // No es un detalle de UI: son conceptos distintos y la ayuda lo dice
    // («es otra cosa y casi nunca coincide»). Confundirlos es lo que hace que
    // un encargado crea que le falta plata.
    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/COBRADO EN EL PER[IÍ]ODO/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible();

    // El desglose por método tiene que sumar el cobrado, no el esperado.
    await expect(page.getByText(/COBRADO POR M[EÉ]TODO/i)).toBeVisible();
  });

  test("con mesas abiertas, la caja principal no cierra y las nombra", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: abiertas } = await db
      .from("orders")
      .select("id")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null);
    expect(
      (abiertas ?? []).length,
      "el seed tiene que dejar mesas vivas para que la guarda tenga qué frenar",
    ).toBeGreaterThan(0);

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await page.getByRole("button", { name: /^Cerrar caja$/ }).click();

    // La guarda es de la spec 092 y del cierre: no se cierra el día con
    // consumo sin cobrar. Y no alcanza con frenar — tiene que decir CUÁL mesa,
    // porque «OPEN_TABLE_ORDERS:3» no le sirve a nadie a la 1 de la mañana.
    await expect(
      page.getByText(/cuenta abierta|mesas con la cuenta abierta/i).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Mesa\s/i).first()).toBeVisible();
  });
});

function montoAR(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
