import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  ComprobanteFields,
  comprobanteInicial,
  comprobanteToInvoiceInput,
  type ComprobanteState,
} from "./comprobante-fields";

// spec 150 — el buscador de entidades fiscales, en el componente que comparten
// los puntos de cobro. Lo que se fija acá es el D2 (aparece sólo en A) y que el
// `fiscalEntityId` elegido llegue a `emitInvoice`.

const buscarEntidadesFiscales = vi.fn();
const crearEntidadFiscal = vi.fn();
vi.mock("@/lib/afip/fiscal-entities-actions", () => ({
  buscarEntidadesFiscales: (...args: unknown[]) =>
    buscarEntidadesFiscales(...args),
  crearEntidadFiscal: (...args: unknown[]) => crearEntidadFiscal(...args),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

const SANATORIO = {
  id: "fe-1",
  cuit: "30500237305",
  razon_social: "SANATORIO PARQUE SA",
  condicion_iva: 1 as const,
};

/** Wrapper controlado: el componente es puro y el estado vive en el caller. */
function Harness({ onState }: { onState?: (s: ComprobanteState) => void }) {
  const [state, setState] = useState<ComprobanteState>(comprobanteInicial());
  return (
    <ComprobanteFields
      slug="demo"
      value={state}
      onChange={(next) => {
        setState(next);
        onState?.(next);
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarEntidadesFiscales.mockResolvedValue({ ok: true, data: [] });
});

describe("ComprobanteFields · entidades fiscales", () => {
  it("con Factura B no aparece el buscador (D2)", () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/Buscar receptor guardado/)).toBeNull();
  });

  it("al pasar a Factura A aparece el buscador", async () => {
    render(<Harness />);
    await userEvent.click(
      screen.getByRole("checkbox", { name: /Factura A/ }),
    );
    expect(
      screen.getByLabelText(/Buscar receptor guardado/),
    ).toBeInTheDocument();
  });

  it("elegir una entidad completa los campos y deja el vínculo", async () => {
    buscarEntidadesFiscales.mockResolvedValue({ ok: true, data: [SANATORIO] });
    let last: ComprobanteState | null = null;
    render(<Harness onState={(s) => (last = s)} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /Factura A/ }));
    await userEvent.type(
      screen.getByLabelText(/Buscar receptor guardado/),
      "30-50023730",
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /SANATORIO PARQUE SA/ }),
    );

    expect(last).toMatchObject({
      cuit: "30-50023730-5",
      razonSocial: "SANATORIO PARQUE SA",
      condicionIva: 1,
      fiscalEntityId: "fe-1",
    });

    // Lo que se le manda a `emitInvoice`: CUIT normalizado + el vínculo.
    expect(comprobanteToInvoiceInput(last!)).toEqual({
      tipoComprobante: "factura_a",
      cuitReceptor: "30500237305",
      razonSocialReceptor: "SANATORIO PARQUE SA",
      condicionIvaReceptor: 1,
      fiscalEntityId: "fe-1",
    });
  });

  it("corregir el CUIT a mano suelta el vínculo con la entidad elegida", async () => {
    buscarEntidadesFiscales.mockResolvedValue({ ok: true, data: [SANATORIO] });
    let last: ComprobanteState | null = null;
    render(<Harness onState={(s) => (last = s)} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /Factura A/ }));
    await userEvent.type(
      screen.getByLabelText(/Buscar receptor guardado/),
      "sanatorio",
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /SANATORIO PARQUE SA/ }),
    );
    await userEvent.type(screen.getByLabelText(/CUIT del receptor/), "9");

    // Otro CUIT es otro receptor: el id deja de valer. La razón social, en
    // cambio, se corrige sobre la misma entidad (D3) y no la desvincula.
    expect(last!.fiscalEntityId).toBeNull();
  });

  it("una Factura B no manda datos de receptor", () => {
    expect(comprobanteToInvoiceInput(comprobanteInicial())).toEqual({
      tipoComprobante: "factura_b",
    });
  });
});
