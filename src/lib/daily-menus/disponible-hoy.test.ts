import { describe, expect, it } from "vitest";

import { currentDayOfWeek } from "@/lib/day-of-week";
import { menuDisponibleHoy } from "./disponible-hoy";

/**
 * Spec 109 — el día del menú del día se valida al CREAR el pedido, no sólo al
 * listarlo. El caso real: el combo de los domingos entrando un martes.
 */
describe("menuDisponibleHoy", () => {
  it("se ofrece el día configurado", () => {
    expect(menuDisponibleHoy([0, 6], 0)).toBe(true);
  });

  it("no se ofrece los otros días", () => {
    expect(menuDisponibleHoy([0, 6], 2)).toBe(false);
  });

  it("sin días configurados no se ofrece nunca", () => {
    // La columna arranca en `'{}'` y el listado filtra con `contains`, que
    // sobre un array vacío no matchea: si acá dijéramos "sin restricción", el
    // server aceptaría un menú que la pantalla nunca mostró.
    expect(menuDisponibleHoy([], 3)).toBe(false);
    expect(menuDisponibleHoy(null, 3)).toBe(false);
    expect(menuDisponibleHoy(undefined, 3)).toBe(false);
  });
});

describe("el día se decide en la TZ del negocio, no en la del server", () => {
  // El bug concreto: las funciones corren en Virginia (UTC) y el local está en
  // Argentina. Un sábado a las 21:00 en el local ya es domingo en UTC.
  const sabadoALas21EnArgentina = new Date("2026-08-08T21:00:00-03:00");

  it("en el local sigue siendo sábado", () => {
    expect(
      currentDayOfWeek("America/Argentina/Buenos_Aires", sabadoALas21EnArgentina),
    ).toBe(6);
  });

  it("mientras que en UTC ya es domingo", () => {
    expect(currentDayOfWeek("UTC", sabadoALas21EnArgentina)).toBe(0);
  });

  it("así que el menú del domingo NO entra un sábado a la noche", () => {
    const menuDeDomingo = [0];
    const dowLocal = currentDayOfWeek(
      "America/Argentina/Buenos_Aires",
      sabadoALas21EnArgentina,
    );
    expect(menuDisponibleHoy(menuDeDomingo, dowLocal)).toBe(false);
  });

  it("y el del sábado sí, aunque el server crea que es domingo", () => {
    const menuDeSabado = [6];
    const dowLocal = currentDayOfWeek(
      "America/Argentina/Buenos_Aires",
      sabadoALas21EnArgentina,
    );
    expect(menuDisponibleHoy(menuDeSabado, dowLocal)).toBe(true);
  });
});
