import { test, expect } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db } from "./db";

/**
 * Aislamiento entre negocios, probado con el **rol real**.
 *
 * No es un proceso del tablero: es la guarda que sostiene a todos. Un solo
 * deploy sirve a muchos restaurantes —`demo` comparte base con `golf-jcr` y
 * `kcc`— y la única razón por la que el encargado de uno no ve la plata del
 * otro es el scoping por `business_id` más RLS.
 *
 * Se prueba desde el browser, con la sesión de la encargada de `demo`, porque
 * es la única forma de ejercitar la cadena entera: middleware que resuelve el
 * slug, layout que valida la pertenencia, y la query con su policy. Con
 * `service_role` esto no probaría nada — el service key pasa por encima de RLS
 * por definición, así que un test que lo use da verde siempre.
 *
 * La respuesta correcta a pedir algo de otro negocio es **404 o 403**, nunca
 * datos y nunca un 500 (un 500 filtra que el recurso existe).
 */
test.use({ storageState: storageState("encargada") });

test.describe("aislamiento multi-tenant", () => {
  test("el slug de otro negocio no se abre con la sesión de demo", async ({
    page,
  }) => {
    const { data } = await db
      .from("businesses")
      .select("slug")
      .neq("slug", SLUG)
      .limit(1);
    const otro = (data ?? [])[0] as { slug: string } | undefined;
    test.skip(!otro, "no hay otro negocio en el stack local");

    await page.goto(`/${otro!.slug}/admin/operacion?tab=caja`);

    // Se afirma sobre el DESENLACE, no sobre el texto ni sobre el status.
    // La app manda al login del otro negocio y eso devuelve 200 —el login
    // renderiza bien—, así que un assert sobre el código o sobre una frase de
    // rechazo da un falso positivo de fuga. Lo único que importa: que la caja
    // del otro local no se vea.
    const cuerpo = await page.locator("body").innerText();
    const entroALaOperacion =
      /Mesas\s*\d/.test(cuerpo) && /Cobrado en el per[ií]odo|Sangr[ií]a/i.test(cuerpo);
    expect(
      entroALaOperacion,
      `abrió la operación de «${otro!.slug}» con sesión de «${SLUG}»`,
    ).toBe(false);
  });

  test("una mesa de otro negocio no se cobra desde demo", async ({ page }) => {
    const { data: bizOtro } = await db
      .from("businesses")
      .select("id, slug")
      .neq("slug", SLUG)
      .limit(20);
    const conOrden = [];
    for (const b of (bizOtro ?? []) as { id: string; slug: string }[]) {
      const { data: o } = await db
        .from("orders")
        .select("id")
        .eq("business_id", b.id)
        .limit(1);
      if ((o ?? []).length) conOrden.push({ ...b, orderId: (o as any)[0].id });
    }
    test.skip(conOrden.length === 0, "ningún otro negocio tiene órdenes");
    const ajeno = conOrden[0];

    // El ataque real: el slug es el mío (así paso el chequeo de pertenencia) y
    // el id es del otro. Es el caso que un scoping hecho sólo por slug no ve.
    const res = await page.goto(`/${SLUG}/admin/mesa/${ajeno.orderId}/cobrar`);
    const status = res?.status() ?? 0;
    const cuerpo = await page.locator("body").innerText();

    expect(
      status,
      "un 500 ya filtra que el recurso existe en otro negocio",
    ).not.toBe(500);
    expect(
      /\$\s?\d/.test(cuerpo) && !/no encontrad|no ten[eé]s/i.test(cuerpo),
      `mostró importes de una orden de «${ajeno.slug}»`,
    ).toBe(false);
  });
});
