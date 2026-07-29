import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CobroForm, type CobroSubmit } from "./cobro-form";
import type { Caja, PaymentMethodConfig } from "@/lib/caja/types";

// El form no importa server actions — `onSubmit` es del caller. Eso es lo que
// permite testear todas las reglas de dinero sin tocar Supabase.

const CAJA: Caja = {
  id: "caja-1",
  business_id: "biz-1",
  name: "Principal",
  is_active: true,
  sort_order: 0,
  is_default: true,
};

const okResult = { ok: true as const, data: {} };

function config(
  method: string,
  percent: number,
): PaymentMethodConfig {
  return {
    id: `cfg-${method}`,
    business_id: "biz-1",
    method: method as PaymentMethodConfig["method"],
    adjustment_percent: percent,
    label: null,
    is_active: true,
    sort_order: 0,
  };
}

function setup(props: Partial<React.ComponentProps<typeof CobroForm>> = {}) {
  const onSubmit = vi.fn(async (_i: CobroSubmit) => okResult);
  render(
    <CobroForm
      subject={{ kind: "mesa", label: "Mesa 4" }}
      amountDueCents={10_000}
      cajas={[CAJA]}
      cajaId={CAJA.id}
      methodConfigs={[]}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

const pick = (label: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name: label }));

const confirm = () =>
  fireEvent.click(screen.getByRole("button", { name: /confirmar/i }));

describe("<CobroForm /> — las reglas de dinero, una sola vez", () => {
  it("cobra el monto que falta cuando el método no tiene ajuste", async () => {
    const { onSubmit } = setup();
    pick(/efectivo/i);
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      method: "cash",
      amountCents: 10_000,
      adjustmentCents: 0,
      adjustmentPercent: 0,
    });
  });

  it("aplica el recargo del método al monto y lo persiste desagregado", async () => {
    const { onSubmit } = setup({ methodConfigs: [config("card_manual", 10)] });
    pick(/tarjeta/i);
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      method: "card_manual",
      amountCents: 11_000,
      adjustmentPercent: 10,
      adjustmentCents: 1_000,
    });
  });

  it("aplica el descuento por efectivo (porcentaje negativo)", async () => {
    const { onSubmit } = setup({ methodConfigs: [config("cash", -10)] });
    pick(/efectivo/i);
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      amountCents: 9_000,
      adjustmentCents: -1_000,
    });
  });

  it("en efectivo no deja confirmar de menos", () => {
    setup();
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "50" }, // $50 de $100
    });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    expect(screen.getByText(/no se puede cobrar menos/i)).toBeInTheDocument();
  });

  it("en efectivo deja confirmar de más y lo muestra como vuelto", async () => {
    const { onSubmit } = setup();
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "150" },
    });
    expect(screen.getByText(/vuelto/i)).toBeInTheDocument();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].amountCents).toBe(15_000);
  });

  it("la guarda de efectivo no aplica a los otros métodos", () => {
    setup();
    pick(/tarjeta/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "50" },
    });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeEnabled();
  });

  it("transferencia exige nota", () => {
    setup();
    pick(/transferencia/i);
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/notas/i), {
      target: { value: "alias juan.mp" },
    });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeEnabled();
  });

  it("los últimos 4 dígitos son opcionales, pero si van tienen que ser 4", async () => {
    const { onSubmit } = setup();
    pick(/tarjeta/i);
    const input = screen.getByLabelText(/últimos 4/i);
    fireEvent.change(input, { target: { value: "12" } });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: "1234" } });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      lastFour: "1234",
      cardBrand: "visa",
    });
  });

  it("dos taps seguidos mandan el mismo requestId (idempotencia)", async () => {
    const onSubmit = vi.fn(
      async (_i: CobroSubmit) =>
        new Promise<typeof okResult>((r) => setTimeout(() => r(okResult), 20)),
    );
    render(
      <CobroForm
        subject={{ kind: "mesa", label: "Mesa 4" }}
        amountDueCents={10_000}
        cajas={[CAJA]}
        cajaId={CAJA.id}
        methodConfigs={[]}
        onSubmit={onSubmit}
      />,
    );
    pick(/efectivo/i);
    const btn = screen.getByRole("button", { name: /confirmar/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const ids = onSubmit.mock.calls.map((c) => c[0].requestId);
    expect(new Set(ids).size).toBe(1);
  });

  it("sin capacidad MP no ofrece MP", () => {
    setup();
    expect(screen.queryByRole("button", { name: /mercado pago/i })).toBeNull();
  });

  it("allowedMethods filtra los métodos ofrecidos", () => {
    setup({ allowedMethods: ["cash"] });
    expect(screen.getByRole("button", { name: /efectivo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tarjeta/i })).toBeNull();
  });
});

describe("<CobroForm /> — la propina sale de donde corresponda", () => {
  it("mode 'none': no se pide y va en 0", async () => {
    const { onSubmit } = setup();
    pick(/efectivo/i);
    expect(screen.queryByLabelText(/propina/i)).toBeNull();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].tipCents).toBe(0);
  });

  it("mode 'fixed': viene de la orden, no se edita (caso mozo)", async () => {
    const { onSubmit } = setup({ tip: { mode: "fixed", cents: 1_500 } });
    pick(/efectivo/i);
    expect(screen.queryByLabelText(/propina/i)).toBeNull();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].tipCents).toBe(1_500);
  });

  it("mode 'editable': se carga en el cobro (caso encargado)", async () => {
    const { onSubmit } = setup({ tip: { mode: "editable" } });
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/propina/i), {
      target: { value: "20" },
    });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].tipCents).toBe(2_000);
  });
});
