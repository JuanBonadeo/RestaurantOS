import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CierreCajaData } from "@/lib/caja/queries";

const cerrarCaja = vi.fn(async () => ({
  ok: true as const,
  data: {
    corte: {},
    retiro_cents: 312_400,
    mesasLiberadas: 0,
    mozosLimpiados: 0,
  },
}));
const registrarRendicionMozo = vi.fn(async () => ({ ok: true as const, data: {} }));

vi.mock("@/lib/caja/actions", () => ({
  cerrarCaja: (...args: unknown[]) => cerrarCaja(...(args as [])),
  registrarRendicionMozo: (...args: unknown[]) =>
    registrarRendicionMozo(...(args as [])),
}));

let DATA: CierreCajaData;
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getCierreCajaTabData: async () => ({ ok: true, data: DATA }),
}));

import { CerrarCajaModal } from "./cerrar-caja-modal";

const EMPTY_METODO = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
};

function data(over: Partial<CierreCajaData> = {}): CierreCajaData {
  return {
    stats: {
      caja_id: "c1",
      total_ventas_cents: 500_000,
      total_propinas_cents: 12_000,
      ventas_por_metodo: { ...EMPTY_METODO, cash: 312_400, mp_qr: 187_600 },
      ventas_por_origen: {
        salon: 400_000,
        delivery: 100_000,
        takeaway: 0,
        otro: 0,
      },
      cobros_count: 14,
      expected_cash_cents: 312_400,
      periodo_desde: "2026-08-30T12:00:00Z",
      desglose_esperado: {
        apertura_cents: 0,
        efectivo_cents: 312_400,
        ingresos_cents: 0,
        sangrias_cents: 0,
      },
    },
    reparto: { en_cajon_cents: 312_400, mozos: [], descuadre_cents: 0 },
    cuentas_abiertas: [],
    pedidos_abiertos: [],
    salon: { mesas_a_liberar: 0, mozos_asignados: 0 },
    barre_salon: true,
    ...over,
  };
}

/**
 * El campo es `type="number"` y el Dialog toma el foco al abrirse: tipear
 * carácter por carácter perdía el primero cada tantas corridas y el test se
 * volvía flaky. Un `change` directo dice lo mismo sin la carrera.
 */
function contar(valor: string) {
  fireEvent.change(screen.getByLabelText(/Efectivo contado/i), {
    target: { value: valor },
  });
}

function abrir() {
  return render(
    <CerrarCajaModal
      open
      onOpenChange={() => {}}
      slug="golf-jcr"
      cajaId="c1"
      cajaName="Caja principal"
      onCerrada={() => {}}
    />,
  );
}

/**
 * Lo que se fija acá es el criterio del cierre, no el pixel: que la mesa
 * abierta frene el botón (D7), que el retiro sea una casilla y no un número
 * tipeado (D2) y que el mozo sin rendir esté a la vista **antes** de contar
 * (D5/D6) — que es lo que hace que la diferencia del arqueo ya venga explicada.
 */
describe("CerrarCajaModal", () => {
  it("una mesa con la cuenta abierta bloquea el cierre y se dice cuál", async () => {
    DATA = data({
      cuentas_abiertas: [
        {
          order_id: "o1",
          order_number: 128,
          table_id: "t1",
          table_label: "12",
          mozo_name: "Nacho",
          total_cents: 84_000,
          pendiente_cents: 84_000,
        },
      ],
    });
    abrir();

    expect(
      await screen.findByText(/Hay una mesa con la cuenta abierta/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Mesa 12")).toBeInTheDocument();
    expect(screen.getByText(/Nacho/)).toBeInTheDocument();

    const cerrar = screen.getByRole("button", { name: /Cerrar caja/i });
    expect(cerrar).toBeDisabled();
  });

  it("el delivery abierto avisa pero no frena", async () => {
    DATA = data({
      pedidos_abiertos: [
        {
          order_id: "o2",
          order_number: 130,
          origen: "delivery",
          customer_name: "Ana",
          total_cents: 20_000,
        },
      ],
    });
    const user = userEvent.setup();
    abrir();

    expect(
      await screen.findByText(/No frenan el cierre/i),
    ).toBeInTheDocument();

    contar("3124");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeEnabled(),
    );
  });

  it("el CTA dice cuánto se retira, y cambia si se destilda la casilla", async () => {
    DATA = data();
    const user = userEvent.setup();
    abrir();

    await screen.findByLabelText(/Efectivo contado/i);
    contar("3124");
    expect(
      await screen.findByRole("button", { name: /Cerrar caja y retirar/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /Cerrar caja sin retirar/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sin retirar/i }));
    await waitFor(() => expect(cerrarCaja).toHaveBeenCalled());
    expect(cerrarCaja.mock.calls[0][0]).toMatchObject({
      cajaId: "c1",
      closing_cash_cents: 312_400,
      retirar: false,
    });
  });

  it("con diferencia pide motivo antes de dejar cerrar", async () => {
    DATA = data();
    const user = userEvent.setup();
    abrir();

    // Cuenta $3.000 contra $3.124 esperados: faltan $124.
    await screen.findByLabelText(/Efectivo contado/i);
    contar("3000");
    expect(await screen.findByText("Te falta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/Qué pasó/i), "vuelto mal dado");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeEnabled(),
    );
  });

  it("el mozo sin rendir aparece con su monto, y se rinde desde el modal", async () => {
    DATA = data({
      reparto: {
        en_cajon_cents: 198_000,
        mozos: [
          { mozo_id: "m1", mozo_name: "Nacho", efectivo_cents: 71_200 },
          { mozo_id: "m2", mozo_name: "Caro", efectivo_cents: 43_200 },
        ],
        descuadre_cents: 0,
      },
    });
    const user = userEvent.setup();
    abrir();

    expect(await screen.findByText("Nacho")).toBeInTheDocument();
    expect(screen.getByText("Caro")).toBeInTheDocument();
    // El total no cambia: rendir mueve plata de columna, no la suma de nuevo.
    expect(screen.getAllByText(/sin rendir/i)).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Rendir" })[0]);
    await user.click(
      screen.getByRole("button", { name: /Registrar rendición/i }),
    );

    await waitFor(() => expect(registrarRendicionMozo).toHaveBeenCalled());
    // Sin tocar el monto se rinde lo que debía: 71.200 en centavos.
    expect(registrarRendicionMozo.mock.calls[0].slice(0, 2)).toEqual([
      "m1",
      71_200,
    ]);
  });

  it("anuncia lo que el cierre va a barrer antes de apretar", async () => {
    DATA = data({ salon: { mesas_a_liberar: 12, mozos_asignados: 4 } });
    abrir();

    expect(await screen.findByText(/liberan 12 mesas/i)).toBeInTheDocument();
    expect(screen.getByText(/distribución de 4 mozos/i)).toBeInTheDocument();
  });
});
