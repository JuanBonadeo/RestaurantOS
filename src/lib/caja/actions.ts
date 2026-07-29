"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { assignMozoToTable } from "@/lib/mozo/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import {
  canAcceptCajaDifference,
  canAssignMozo,
  canHacerCorte,
  canMakeSangria,
  canManageCajas,
  canRendirMozo,
} from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { getCajaLiveStats, getRendicionPendienteMozo } from "./queries";
import type { CajaCorte, MozoRendicion, PaymentMethod } from "./types";

type GenericClient = SupabaseClient;

// ── Helpers internos ───────────────────────────────────────────

async function loadCajaForBusiness(
  service: GenericClient,
  cajaId: string,
  businessId: string,
): Promise<{ id: string; is_active: boolean } | null> {
  const { data } = await service
    .from("cajas")
    .select("id, business_id, is_active")
    .eq("id", cajaId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; business_id: string; is_active: boolean };
  if (row.business_id !== businessId) return null;
  return { id: row.id, is_active: row.is_active };
}

// ── CRUD de cajas físicas ──────────────────────────────────────

export async function crearCaja(
  name: string,
  businessSlug: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }
  const trimmed = name.trim();
  if (trimmed === "") return actionError("La caja necesita un nombre.");
  if (trimmed.length > 60) return actionError("Nombre demasiado largo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("cajas")
    .insert({
      business_id: business.id,
      name: trimmed,
      is_active: true,
    })
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") {
      return actionError("Ya existe una caja con ese nombre.");
    }
    return actionError(`No se pudo crear la caja: ${error.message}`);
  }

  revalidatePath(`/${businessSlug}/admin/cajas`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({
    id: (data as { id: string }).id,
    name: (data as { name: string }).name,
  });
}

export async function renombrarCaja(
  cajaId: string,
  newName: string,
  businessSlug: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }
  const trimmed = newName.trim();
  if (trimmed === "") return actionError("La caja necesita un nombre.");
  if (trimmed.length > 60) return actionError("Nombre demasiado largo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");

  const { data, error } = await service
    .from("cajas")
    .update({ name: trimmed })
    .eq("id", cajaId)
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") {
      return actionError("Ya existe una caja con ese nombre.");
    }
    return actionError(`No se pudo renombrar la caja: ${error.message}`);
  }

  revalidatePath(`/${businessSlug}/admin/cajas`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({
    id: (data as { id: string }).id,
    name: (data as { name: string }).name,
  });
}

export async function setCajaActive(
  cajaId: string,
  isActive: boolean,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");

  const { error } = await service
    .from("cajas")
    .update({ is_active: isActive })
    .eq("id", cajaId);
  if (error) return actionError(`No se pudo actualizar la caja: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/cajas`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Marca la caja donde caen los cobros sin cajero — hoy, el pago online de un
 * delivery / take-away que acredita el webhook de MP (no hay nadie eligiendo
 * dónde asentarlo y `payments.caja_id` es NOT NULL).
 *
 * Es excluyente: el índice único parcial `cajas_one_default_per_business`
 * (migración 0025) sólo admite una por negocio, así que primero se limpia la
 * anterior. Sin una marcada, `getDefaultCaja` cae en la primera activa.
 */
export async function setCajaDefault(
  cajaId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) {
    return actionError("Una caja inactiva no puede ser la caja por defecto.");
  }

  // Limpiar la anterior antes de marcar la nueva: el unique parcial no admite
  // dos, y hacerlo al revés falla.
  const { error: clearErr } = await service
    .from("cajas")
    .update({ is_default: false })
    .eq("business_id", business.id)
    .eq("is_default", true);
  if (clearErr) {
    return actionError(`No se pudo actualizar la caja: ${clearErr.message}`);
  }

  const { error } = await service
    .from("cajas")
    .update({ is_default: true })
    .eq("id", cajaId);
  if (error) return actionError(`No se pudo actualizar la caja: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/cajas`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Corte ─────────────────────────────────────────────────────

export async function hacerCorte(
  cajaId: string,
  closing_cash_cents: number,
  closing_notes: string | null,
  denomination_count: Record<string, number> | null,
  businessSlug: string,
): Promise<ActionResult<{ corte: CajaCorte }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canHacerCorte(ctx.role)) {
    return actionError("Solo encargado o admin pueden hacer un corte de caja.");
  }
  if (closing_cash_cents < 0) {
    return actionError("El monto de cierre no puede ser negativo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) return actionError("Caja inactiva.");

  const stats = await getCajaLiveStats(cajaId, business.id);
  if (!stats) return actionError("No se pudieron calcular los stats de la caja.");
  const expected_cash_cents = stats.expected_cash_cents;
  const difference_cents = closing_cash_cents - expected_cash_cents;

  if (difference_cents !== 0) {
    if (!closing_notes || closing_notes.trim() === "") {
      return actionError(
        "Hay diferencia con el efectivo esperado. Tenés que registrar el motivo en las notas.",
      );
    }
    if (!canAcceptCajaDifference(ctx.role, difference_cents)) {
      return actionError(
        "La diferencia excede tu autorización. Pedile al admin que haga el corte.",
      );
    }
  }

  const { data: inserted, error } = await service
    .from("caja_cortes")
    .insert({
      caja_id: cajaId,
      business_id: business.id,
      encargado_id: ctx.userId,
      expected_cash_cents,
      closing_cash_cents,
      difference_cents,
      closing_notes: closing_notes?.trim() || null,
      denomination_count: denomination_count ?? null,
    })
    .select("*")
    .single();

  if (error) return actionError(`No se pudo registrar el corte: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({ corte: inserted as CajaCorte });
}

// ── Movimientos manuales ───────────────────────────────────────

export async function registrarSangria(
  cajaId: string,
  amount_cents: number,
  reason: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canMakeSangria(ctx.role)) {
    return actionError("Solo encargado o admin pueden registrar una sangría.");
  }
  if (amount_cents <= 0) return actionError("El monto debe ser mayor a 0.");
  if (!reason || reason.trim() === "") {
    return actionError("La sangría requiere un motivo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) return actionError("Caja inactiva.");

  const { error } = await service.from("caja_movimientos").insert({
    caja_id: cajaId,
    business_id: business.id,
    kind: "sangria",
    amount_cents,
    reason: reason.trim(),
    created_by: ctx.userId,
  });
  if (error) return actionError(`No se pudo registrar la sangría: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

export async function registrarIngreso(
  cajaId: string,
  amount_cents: number,
  reason: string | null,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canMakeSangria(ctx.role)) {
    return actionError("Solo encargado o admin pueden registrar un ingreso.");
  }
  if (amount_cents <= 0) return actionError("El monto debe ser mayor a 0.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) return actionError("Caja inactiva.");

  const { error } = await service.from("caja_movimientos").insert({
    caja_id: cajaId,
    business_id: business.id,
    kind: "ingreso",
    amount_cents,
    reason: reason?.trim() || null,
    created_by: ctx.userId,
  });
  if (error) return actionError(`No se pudo registrar el ingreso: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Configuración de métodos de pago ──────────────────────────────

const VALID_METHODS: PaymentMethod[] = [
  "cash", "card_manual", "mp_link", "mp_qr", "transfer", "other",
];

export async function upsertPaymentMethodConfig(
  businessSlug: string,
  method: PaymentMethod,
  input: { adjustment_percent: number; label: string | null; is_active: boolean },
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar métodos de pago.");
  }
  if (!VALID_METHODS.includes(method)) {
    return actionError("Método de pago inválido.");
  }
  if (input.adjustment_percent < -100 || input.adjustment_percent > 100) {
    return actionError("El ajuste debe estar entre -100% y 100%.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("payment_method_configs")
    .upsert(
      {
        business_id: business.id,
        method,
        adjustment_percent: input.adjustment_percent,
        label: input.label?.trim() || null,
        is_active: input.is_active,
      },
      { onConflict: "business_id,method" },
    );

  if (error) return actionError(`No se pudo guardar: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Rendición de mozos ──────────────────────────────────────────

export async function registrarRendicionMozo(
  mozoId: string,
  delivered_cash_cents: number,
  notes: string | null,
  businessSlug: string,
): Promise<ActionResult<{ rendicion: MozoRendicion }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canRendirMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden registrar una rendición.");
  }
  if (delivered_cash_cents < 0) {
    return actionError("El monto entregado no puede ser negativo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: mozoUser } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", business.id)
    .eq("user_id", mozoId)
    .maybeSingle();
  if (!mozoUser) return actionError("El mozo no pertenece a este negocio.");

  const pendiente = await getRendicionPendienteMozo(
    mozoId,
    business.id,
    (mozoUser as { full_name: string | null }).full_name ?? "Sin nombre",
  );

  const expected_cash_cents = pendiente.efectivo_cents;
  const difference_cents = delivered_cash_cents - expected_cash_cents;

  if (difference_cents !== 0 && (!notes || notes.trim() === "")) {
    return actionError(
      "Hay diferencia entre lo esperado y lo entregado. Registrá el motivo.",
    );
  }

  const { data: inserted, error } = await service
    .from("mozo_rendiciones")
    .insert({
      business_id: business.id,
      mozo_id: mozoId,
      registered_by: ctx.userId,
      expected_cash_cents,
      delivered_cash_cents,
      difference_cents,
      notes: notes?.trim() || null,
      por_metodo: pendiente.por_metodo,
    })
    .select("*")
    .single();

  if (error) return actionError(`No se pudo registrar la rendición: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({ rendicion: inserted as MozoRendicion });
}

// ── Asignación caja↔usuario ─────────────────────────────────────

export async function asignarCajaUsuario(
  cajaId: string,
  userId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede asignar cajas a usuarios.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada en este negocio.");

  const { data: bu } = await service
    .from("business_users")
    .select("user_id")
    .eq("business_id", business.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!bu) return actionError("El usuario no pertenece a este negocio.");

  const { error } = await service
    .from("caja_user_assignments")
    .upsert(
      {
        business_id: business.id,
        caja_id: cajaId,
        user_id: userId,
      },
      { onConflict: "business_id,caja_id,user_id" },
    );

  if (error) return actionError(`No se pudo asignar la caja: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  revalidatePath(`/${businessSlug}/admin/cajas`);
  return actionOk(undefined);
}

export async function desasignarCajaUsuario(
  cajaId: string,
  userId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede desasignar cajas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { error } = await service
    .from("caja_user_assignments")
    .delete()
    .eq("business_id", business.id)
    .eq("caja_id", cajaId)
    .eq("user_id", userId);

  if (error) return actionError(`No se pudo desasignar: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  revalidatePath(`/${businessSlug}/admin/cajas`);
  return actionOk(undefined);
}

// ── Distribución masiva del salón ────────────────────────────────

export async function distribuirSalon(
  input: {
    assignments: Array<{ tableId: string; mozoId: string | null }>;
    slug: string;
  },
): Promise<ActionResult<{ count: number }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canAssignMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden distribuir el salón.");
  }

  let count = 0;
  for (const a of input.assignments) {
    const r = await assignMozoToTable(a.tableId, a.mozoId, input.slug);
    if (!r.ok) return actionError(`Falló asignar mesa: ${r.error}`);
    count += 1;
  }

  return actionOk({ count });
}
