import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ObservacionDeLaTanda } from "./observacion-de-la-tanda";
import { OBSERVACION_MAX } from "@/lib/comandas/observacion";

/** Envoltorio controlado: el campo real lo maneja el padre (que es el que
 *  manda la observación al enviar y la limpia después). */
function Campo({ inicial = "" }: { inicial?: string }) {
  const [v, setV] = useState(inicial);
  return <ObservacionDeLaTanda value={v} onChange={setV} />;
}

describe("ObservacionDeLaTanda (spec 128)", () => {
  it("arranca plegada: el camino feliz no pasa por acá", () => {
    // En hora pico el envío es un tap. Esto es la puerta para cuando hay algo
    // que decir, no un paso más del formulario.
    render(<Campo />);
    expect(
      screen.getByRole("button", { name: /Observación para cocina/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("se abre al tocarla", async () => {
    render(<Campo />);
    await userEvent.click(
      screen.getByRole("button", { name: /Observación para cocina/ }),
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("con texto cargado no se pliega: se envía lo que se ve", async () => {
    // Un campo que esconde lo que escribiste hace diez minutos manda «la mesa
    // tiene apuro» a una tanda de postres.
    render(<Campo inicial="va todo junto" />);
    expect(screen.getByRole("textbox")).toHaveValue("va todo junto");
    expect(
      screen.queryByRole("button", { name: /^Observación para cocina$/ }),
    ).toBeNull();
  });

  it("la X la borra y vuelve a plegar", async () => {
    render(<Campo inicial="apuro" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Quitar la observación" }),
    );
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("no deja pasar el tope: el contador dice la verdad", async () => {
    const onChange = vi.fn();
    render(<ObservacionDeLaTanda value={"x".repeat(10)} onChange={onChange} />);
    expect(screen.getByText(`10/${OBSERVACION_MAX}`)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "maxlength",
      String(OBSERVACION_MAX),
    );
  });
});
