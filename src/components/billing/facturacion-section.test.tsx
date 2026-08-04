import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FacturacionSection } from "./facturacion-section";
import type { Invoice } from "@/lib/afip/types";

// La sección es la MISMA en el cobro del mozo y en el del encargado (#137).
// Mockeamos sólo el borde server (emitir/reintentar/pollear): todo lo que se
// testea acá es la UI y las reglas de CUIT/condición IVA que corren antes de
// llamar a ARCA.
const emitInvoice = vi.fn();
const retryInvoice = vi.fn();
const waitForInvoiceTerminal = vi.fn();

vi.mock("@/lib/afip/emit-invoice", () => ({
  emitInvoice: (...args: unknown[]) => emitInvoice(...args),
  retryInvoice: (...args: unknown[]) => retryInvoice(...args),
}));
vi.mock("@/lib/afip/poll", () => ({
  waitForInvoiceTerminal: (...args: unknown[]) =>
    waitForInvoiceTerminal(...args),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    business_id: "biz-1",
    order_id: "ord-1",
    payment_id: null,
    tipo_comprobante: "factura_b",
    punto_venta: 1,
    numero: 42,
    cae: "75123456789012",
    cae_vencimiento: "2026-08-20",
    cuit_receptor: null,
    razon_social_receptor: null,
    condicion_iva_receptor: null,
    total_cents: 350_000,
    neto_cents: 289_256,
    iva_cents: 60_744,
    iva_rate: 21,
    status: "authorized",
    error_message: null,
    idempotency_key: null,
    pdf_url: null,
    qr_url: null,
    provider: "gateway",
    provider_job_id: null,
    provider_response: null,
    created_at: "2026-08-04T21:00:00Z",
    cancelled_reason: null,
    ...over,
  } as Invoice;
}

function setup(existingInvoice: Invoice | null = null) {
  return render(
    <FacturacionSection
      orderId="ord-1"
      totalCents={350_000}
      slug="golf-jcr"
      existingInvoice={existingInvoice}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FacturacionSection", () => {
  it("sin factura previa ofrece emitir el comprobante", () => {
    setup();
    expect(screen.getByText("Emitir comprobante")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Emitir Factura B/ }),
    ).toBeInTheDocument();
  });

  it("emite Factura B sin CUIT (consumidor final)", async () => {
    emitInvoice.mockResolvedValue({
      ok: true,
      data: { invoice: invoice({ status: "authorized" }) },
    });
    setup();
    await userEvent.click(
      screen.getByRole("button", { name: /Emitir Factura B/ }),
    );
    await waitFor(() => expect(emitInvoice).toHaveBeenCalledTimes(1));
    expect(emitInvoice).toHaveBeenCalledWith({
      orderId: "ord-1",
      tipoComprobante: "factura_b",
      cuitReceptor: undefined,
      razonSocialReceptor: undefined,
      condicionIvaReceptor: undefined,
      slug: "golf-jcr",
    });
  });

  it("no llama al gateway si la Factura A no tiene CUIT de 11 dígitos", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Factura A/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Emitir Factura A/ }),
    );
    expect(emitInvoice).not.toHaveBeenCalled();
  });

  it("una factura ya autorizada se muestra con su CAE, sin formulario", () => {
    setup(invoice());
    expect(screen.getByText(/CAE: 75123456789012/)).toBeInTheDocument();
    expect(screen.getByText("Emitida")).toBeInTheDocument();
    expect(screen.queryByText("Emitir comprobante")).not.toBeInTheDocument();
  });

  it("una factura fallida ofrece reintentar", async () => {
    retryInvoice.mockResolvedValue({
      ok: true,
      data: { invoice: invoice({ status: "authorized" }) },
    });
    setup(invoice({ status: "failed", error_message: "ARCA rechazó" }));
    expect(screen.getByText("Factura no emitida")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    await waitFor(() =>
      expect(retryInvoice).toHaveBeenCalledWith("inv-1", "golf-jcr"),
    );
  });

  it("mientras el gateway resuelve el CAE muestra el estado en curso", () => {
    setup(invoice({ status: "pending", cae: null, numero: null }));
    expect(screen.getByText("Emitiendo comprobante…")).toBeInTheDocument();
  });
});
