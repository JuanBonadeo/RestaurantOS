import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  armarLibro,
  calcularSaldo,
  diasSinPagar,
  tramoDeAntiguedad,
  type CargoCuentaCorriente,
  type CobranzaCuentaCorriente,
  type MovimientoCuenta,
  type TramoAntiguedad,
} from "./cuenta-corriente";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

export type DeudorRow = {
  customer_id: string;
  name: string | null;
  phone: string;
  saldo_cents: number;
  dias_sin_pagar: number | null;
  tramo: TramoAntiguedad;
  ultimo_consumo: string | null;
};

export type CuentasCorrientesData = {
  deudores: DeudorRow[];
  /** Sólo los que DEBEN (saldo > 0): es lo que el pill de la tab cuenta. */
  cuantos_deben: number;
  total_fiado_cents: number;
  por_tramo: Record<TramoAntiguedad, number>;
  /** Habilitados para fiar, deban o no. El estado vacío los necesita. */
  habilitados: number;
};

/**
 * Los cargos y las cobranzas de un negocio, en dos viajes.
 *
 * No se agrega en SQL a propósito: el saldo lo calcula
 * [`cuenta-corriente.ts`](./cuenta-corriente.ts), que es puro y está testeado, y
 * duplicar esa regla en una vista sería la segunda fuente que la D4 evita. El
 * volumen lo permite — son los fiados de un local, no un ledger bancario.
 */
async function cargarMovimientos(businessId: string) {
  const service = db();
  const [cargosRes, cobranzasRes] = await Promise.all([
    service
      .from("payments")
      .select(
        "id, amount_cents, created_at, cancelled_at, credit_customer_id, orders(order_number)",
      )
      .eq("business_id", businessId)
      .eq("method", "cuenta_corriente")
      .not("credit_customer_id", "is", null),
    service
      .from("customer_credit_settlements")
      .select("id, amount_cents, created_at, method, cancelled_at, customer_id")
      .eq("business_id", businessId),
  ]);

  const cargosPorCliente = new Map<string, CargoCuentaCorriente[]>();
  // PostgREST tipa el embed como array aunque la relación sea a-uno; el cast va
  // por `unknown` porque los dos tipos no se solapan lo suficiente para TS.
  for (const row of (cargosRes.data ?? []) as unknown as Array<{
    id: string;
    amount_cents: number;
    created_at: string;
    cancelled_at: string | null;
    credit_customer_id: string;
    orders: { order_number: number } | null;
  }>) {
    const lista = cargosPorCliente.get(row.credit_customer_id) ?? [];
    lista.push({
      id: row.id,
      amount_cents: row.amount_cents,
      created_at: row.created_at,
      cancelled_at: row.cancelled_at,
      order_number: row.orders?.order_number ?? null,
    });
    cargosPorCliente.set(row.credit_customer_id, lista);
  }

  const cobranzasPorCliente = new Map<string, CobranzaCuentaCorriente[]>();
  for (const row of (cobranzasRes.data ?? []) as Array<{
    id: string;
    amount_cents: number;
    created_at: string;
    method: string;
    cancelled_at: string | null;
    customer_id: string;
  }>) {
    const lista = cobranzasPorCliente.get(row.customer_id) ?? [];
    lista.push(row);
    cobranzasPorCliente.set(row.customer_id, lista);
  }

  return { cargosPorCliente, cobranzasPorCliente };
}

export async function getCuentasCorrientes(
  businessId: string,
  ahora: Date = new Date(),
): Promise<CuentasCorrientesData> {
  const service = db();
  const { cargosPorCliente, cobranzasPorCliente } =
    await cargarMovimientos(businessId);

  const ids = new Set([
    ...cargosPorCliente.keys(),
    ...cobranzasPorCliente.keys(),
  ]);
  const { data: habilitadosRes } = await service
    .from("customers")
    .select("id, name, phone")
    .eq("business_id", businessId)
    .eq("credit_enabled", true);
  const habilitados = (habilitadosRes ?? []) as Array<{
    id: string;
    name: string | null;
    phone: string;
  }>;
  for (const h of habilitados) ids.add(h.id);

  // Un cliente puede tener saldo y haber quedado deshabilitado después: la deuda
  // no se evapora porque le sacaron el permiso de seguir fiando.
  const faltantes = [...ids].filter(
    (id) => !habilitados.some((h) => h.id === id),
  );
  let extra: Array<{ id: string; name: string | null; phone: string }> = [];
  if (faltantes.length > 0) {
    const { data } = await service
      .from("customers")
      .select("id, name, phone")
      .in("id", faltantes);
    extra = (data ?? []) as typeof extra;
  }
  const porId = new Map(
    [...habilitados, ...extra].map((c) => [c.id, c] as const),
  );

  const deudores: DeudorRow[] = [];
  for (const id of ids) {
    const cargos = cargosPorCliente.get(id) ?? [];
    const cobranzas = cobranzasPorCliente.get(id) ?? [];
    const saldo = calcularSaldo(cargos, cobranzas);
    const dias = diasSinPagar(cargos, cobranzas, ahora);
    const cliente = porId.get(id);
    deudores.push({
      customer_id: id,
      name: cliente?.name ?? null,
      phone: cliente?.phone ?? "",
      saldo_cents: saldo,
      dias_sin_pagar: dias,
      tramo: tramoDeAntiguedad(dias),
      ultimo_consumo:
        cargos
          .filter((c) => !c.cancelled_at)
          .map((c) => c.created_at)
          .sort()
          .at(-1) ?? null,
    });
  }

  deudores.sort((a, b) => b.saldo_cents - a.saldo_cents);

  const conDeuda = deudores.filter((d) => d.saldo_cents > 0);
  const por_tramo: Record<TramoAntiguedad, number> = {
    al_dia: 0,
    mas_30: 0,
    mas_60: 0,
  };
  for (const d of conDeuda) por_tramo[d.tramo] += d.saldo_cents;

  return {
    deudores,
    cuantos_deben: conDeuda.length,
    total_fiado_cents: conDeuda.reduce((n, d) => n + d.saldo_cents, 0),
    por_tramo,
    habilitados: habilitados.length,
  };
}

export type CuentaDeCliente = {
  saldo_cents: number;
  dias_sin_pagar: number | null;
  libro: MovimientoCuenta[];
};

export async function getCuentaDeCliente(
  businessId: string,
  customerId: string,
  ahora: Date = new Date(),
): Promise<CuentaDeCliente> {
  const { cargosPorCliente, cobranzasPorCliente } =
    await cargarMovimientos(businessId);
  const cargos = cargosPorCliente.get(customerId) ?? [];
  const cobranzas = cobranzasPorCliente.get(customerId) ?? [];
  return {
    saldo_cents: calcularSaldo(cargos, cobranzas),
    dias_sin_pagar: diasSinPagar(cargos, cobranzas, ahora),
    libro: armarLibro(cargos, cobranzas),
  };
}

/**
 * Los clientes que el cobro ofrece para fiar: habilitados, con su saldo actual.
 *
 * El saldo viaja con la lista porque es **lo único que la spec le da a
 * `terminal`** (D7): ese rol fía pero no ve la tab de cuentas, así que el número
 * antes de confirmar es toda su información.
 */
export async function getClientesParaFiar(
  businessId: string,
): Promise<
  { id: string; name: string | null; phone: string; saldo_cents: number }[]
> {
  const service = db();
  const { data } = await service
    .from("customers")
    .select("id, name, phone")
    .eq("business_id", businessId)
    .eq("credit_enabled", true)
    .order("name", { ascending: true });
  const clientes = (data ?? []) as Array<{
    id: string;
    name: string | null;
    phone: string;
  }>;
  if (clientes.length === 0) return [];

  const { cargosPorCliente, cobranzasPorCliente } =
    await cargarMovimientos(businessId);
  return clientes.map((c) => ({
    ...c,
    saldo_cents: calcularSaldo(
      cargosPorCliente.get(c.id) ?? [],
      cobranzasPorCliente.get(c.id) ?? [],
    ),
  }));
}
