"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canCobrarCuentaCorriente, canFiar } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { getCuentaDeCliente } from "./cuenta-corriente-queries";

type GenericClient = SupabaseClient;
const db = () => createSupabaseServiceClient() as unknown as GenericClient;

/**
 * Habilitar (o deshabilitar) la cuenta corriente de un cliente — spec 141 · US1.
 *
 * Deshabilitar **no borra el saldo**: deja de poder fiar, pero lo que ya debe
 * sigue en la tab hasta que lo pague. Por eso el listado de deudores trae también
 * a los deshabilitados con saldo.
 */
export async function setCuentaCorrienteHabilitada(
  customerId: string,
  habilitada: boolean,
  slug: string,
): Promise<ActionResult<{ credit_enabled: boolean }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  // Quien puede fiar puede habilitar a quién fiarle: es la misma decisión, y
  // separarla obligaría al encargado a pedirle el switch al admin en el momento
  // en que el socio está esperando en el mostrador.
  if (!canFiar(ctxResult.data.role)) {
    return actionError("No tenés permiso para habilitar cuentas corrientes.");
  }

  const service = db();
  const { data: cliente } = await service
    .from("customers")
    .select("id, business_id")
    .eq("id", customerId)
    .maybeSingle();
  const row = cliente as { id: string; business_id: string } | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Cliente no encontrado.");
  }

  // Al apagar, se avisa si queda saldo: no bloquea —puede ser justamente lo que
  // se quiere hacer con un moroso— pero nadie debería enterarse después.
  if (!habilitada) {
    const cuenta = await getCuentaDeCliente(business.id, customerId);
    if (cuenta.saldo_cents > 0) {
      const { error } = await service
        .from("customers")
        .update({ credit_enabled: false })
        .eq("id", customerId);
      if (error) return actionError("No se pudo actualizar el cliente.");
      revalidatePath(`/${slug}/admin/clientes/${customerId}`);
      return actionOk({ credit_enabled: false });
    }
  }

  const { error } = await service
    .from("customers")
    .update({ credit_enabled: habilitada })
    .eq("id", customerId);
  if (error) return actionError("No se pudo actualizar el cliente.");

  revalidatePath(`/${slug}/admin/clientes/${customerId}`);
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk({ credit_enabled: habilitada });
}

/**
 * Registrar un pago del cliente contra su saldo — spec 141 · US4.
 *
 * Si es **efectivo**, además entra a la caja como `ingreso` y queda linkeado
 * (D5): esa plata va al cajón y el arqueo tiene que esperarla. Transferencia o
 * tarjeta quedan sólo en el libro del cliente, que es el mismo tratamiento que
 * el sistema ya le da a esos métodos.
 */
export async function registrarCobranza(input: {
  customerId: string;
  amount_cents: number;
  method: "cash" | "transfer" | "card_manual" | "other";
  cajaId: string | null;
  notes?: string | null;
  slug: string;
}): Promise<ActionResult<{ id: string; saldo_cents: number }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  // D7 — `terminal` fía pero no cobra: el ingreso entra a una caja que ese rol
  // no puede ni mirar, y sería plata cayendo en un cajón ciego.
  if (!canCobrarCuentaCorriente(ctx.role)) {
    return actionError("No tenés permiso para cobrar una cuenta corriente.");
  }
  if (input.amount_cents <= 0) {
    return actionError("El monto debe ser mayor a 0.");
  }

  const service = db();
  const { data: cliente } = await service
    .from("customers")
    .select("id, name, business_id")
    .eq("id", input.customerId)
    .maybeSingle();
  const row = cliente as {
    id: string;
    name: string | null;
    business_id: string;
  } | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Cliente no encontrado.");
  }

  // No se acepta cobrar más de lo que debe: el saldo a favor existe como
  // resultado de una anulación, no como algo que se tipea de frente.
  const antes = await getCuentaDeCliente(business.id, input.customerId);
  if (input.amount_cents > antes.saldo_cents) {
    return actionError(
      `Ese cliente debe menos de lo que estás cobrando. Saldo actual: ${(
        antes.saldo_cents / 100
      ).toFixed(2)}.`,
    );
  }

  let cajaMovimientoId: string | null = null;
  if (input.method === "cash") {
    if (!input.cajaId) {
      return actionError("Elegí en qué caja entra el efectivo.");
    }
    const { data: caja } = await service
      .from("cajas")
      .select("id, business_id, is_active")
      .eq("id", input.cajaId)
      .maybeSingle();
    const cajaRow = caja as {
      id: string;
      business_id: string;
      is_active: boolean;
    } | null;
    if (!cajaRow || cajaRow.business_id !== business.id) {
      return actionError("Caja no encontrada.");
    }
    if (!cajaRow.is_active) return actionError("La caja está inactiva.");

    const { data: mov, error: movErr } = await service
      .from("caja_movimientos")
      .insert({
        caja_id: input.cajaId,
        business_id: business.id,
        kind: "ingreso",
        amount_cents: input.amount_cents,
        reason: `Cobro cuenta corriente · ${row.name ?? "cliente"}`,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (movErr || !mov) return actionError("No se pudo registrar el ingreso.");
    cajaMovimientoId = (mov as { id: string }).id;
  }

  const { data: settlement, error } = await service
    .from("customer_credit_settlements")
    .insert({
      business_id: business.id,
      customer_id: input.customerId,
      amount_cents: input.amount_cents,
      method: input.method,
      caja_id: input.cajaId,
      caja_movimiento_id: cajaMovimientoId,
      notes: input.notes?.trim() || null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (error || !settlement) {
    // El movimiento de caja ya entró: se revierte para no dejar plata contada
    // que no corresponde a ninguna cobranza. No hay transacción entre las dos
    // escrituras, así que la compensación es explícita.
    if (cajaMovimientoId) {
      await service
        .from("caja_movimientos")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_reason: "La cobranza no se pudo registrar",
        })
        .eq("id", cajaMovimientoId);
    }
    return actionError("No se pudo registrar la cobranza.");
  }

  const despues = await getCuentaDeCliente(business.id, input.customerId);
  revalidatePath(`/${input.slug}/admin/clientes/${input.customerId}`);
  revalidatePath(`/${input.slug}/admin/operacion`);
  return actionOk({
    id: (settlement as { id: string }).id,
    saldo_cents: despues.saldo_cents,
  });
}

/** Anular una cobranza — nunca se borra, igual que un movimiento de caja. */
export async function anularCobranza(
  settlementId: string,
  motivo: string,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCobrarCuentaCorriente(ctxResult.data.role)) {
    return actionError("No tenés permiso para anular una cobranza.");
  }
  if (!motivo.trim()) return actionError("Decí por qué se anula.");

  const service = db();
  const { data: s } = await service
    .from("customer_credit_settlements")
    .select("id, business_id, caja_movimiento_id, cancelled_at")
    .eq("id", settlementId)
    .maybeSingle();
  const row = s as {
    id: string;
    business_id: string;
    caja_movimiento_id: string | null;
    cancelled_at: string | null;
  } | null;
  if (!row || row.business_id !== business.id) {
    return actionError("Cobranza no encontrada.");
  }
  if (row.cancelled_at) return actionError("Esa cobranza ya está anulada.");

  const ahora = new Date().toISOString();
  const { error } = await service
    .from("customer_credit_settlements")
    .update({
      cancelled_at: ahora,
      cancelled_by: ctxResult.data.userId,
      cancelled_reason: motivo.trim(),
    })
    .eq("id", settlementId);
  if (error) return actionError("No se pudo anular la cobranza.");

  // El ingreso a la caja se anula con ella: si no, el arqueo seguiría esperando
  // una plata cuya cobranza ya no existe.
  if (row.caja_movimiento_id) {
    await service
      .from("caja_movimientos")
      .update({
        cancelled_at: ahora,
        cancelled_reason: `Cobranza anulada · ${motivo.trim()}`,
      })
      .eq("id", row.caja_movimiento_id);
  }

  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(undefined);
}
