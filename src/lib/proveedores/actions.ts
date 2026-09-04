"use server";


import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canManageProveedores } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calcularVencimiento } from "./cuenta-corriente";
import { ImportSupplierBatch, SupplierInput, SupplierInvoiceInput } from "./schema";

// ── Helpers ──────────────────────────────────────────────────────

async function getBusinessIdBySlug(slug: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

// Las columnas de la spec 158 (`default_expense_concept_id`, `payment_terms_days`,
// `expense_concept_id`, `document_type`, `due_date`) todavía no están en
// `database.types.ts`: el `pnpm db:types` del repo necesita el CLI linkeado.
// Mismo escape hatch que `caja/cuenta-corriente-actions.ts` de la spec 141.
type GenericClient = SupabaseClient;

function db(): GenericClient {
  return createSupabaseServiceClient() as unknown as GenericClient;
}

async function requireProveedorContext(businessId: string) {
  const ctxResult = await requireMozoActionContext(businessId);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (!canManageProveedores(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo admin o encargado pueden gestionar proveedores.");
  }
  return actionOk(ctx);
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIERS (PROVEEDORES)
// ═══════════════════════════════════════════════════════════════════

export async function createSupplier(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SupplierInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  const { data, error } = await service
    .from("suppliers")
    .insert({
      ...parsed.data,
      email: parsed.data.email || null,
      business_id: businessId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createSupplier", error);
    return actionError(
      error?.code === "23505"
        ? "Ya existe un proveedor con ese nombre."
        : "No pudimos crear el proveedor.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ id: data.id });
}

export async function updateSupplier(
  businessSlug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SupplierInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  const { error } = await service
    .from("suppliers")
    .update({ ...parsed.data, email: parsed.data.email || null })
    .eq("id", id)
    .eq("business_id", businessId);

  if (error) {
    console.error("updateSupplier", error);
    return actionError(
      error.code === "23505"
        ? "Ya existe un proveedor con ese nombre."
        : "No pudimos actualizar el proveedor.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ id });
}

export async function deactivateSupplier(
  businessSlug: string,
  id: string,
): Promise<ActionResult<void>> {
  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  const { error } = await service
    .from("suppliers")
    .update({ is_active: false })
    .eq("id", id)
    .eq("business_id", businessId);

  if (error) {
    console.error("deactivateSupplier", error);
    return actionError("No pudimos desactivar el proveedor.");
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk(undefined);
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER INVOICES (FACTURAS DE COMPRA)
// ═══════════════════════════════════════════════════════════════════

export async function createSupplierInvoice(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SupplierInvoiceInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();

  // spec 158 · el proveedor precarga la compra. Sin esto el encargado tipea el
  // concepto y calcula el vencimiento a mano diez veces por día — que es
  // exactamente la fricción que el módulo viene a sacar.
  const { data: supplier } = await service
    .from("suppliers")
    .select("id, default_expense_concept_id, payment_terms_days")
    .eq("id", parsed.data.supplier_id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!supplier) return actionError("Proveedor no encontrado.");
  const prov = supplier as unknown as {
    default_expense_concept_id: string | null;
    payment_terms_days: number | null;
  };

  const conceptId =
    parsed.data.expense_concept_id ?? prov.default_expense_concept_id ?? null;
  const dueDate =
    parsed.data.due_date ??
    calcularVencimiento(parsed.data.invoice_date, prov.payment_terms_days ?? 0);

  const { data, error } = await service
    .from("supplier_invoices")
    .insert({
      business_id: businessId,
      supplier_id: parsed.data.supplier_id,
      invoice_number: parsed.data.invoice_number ?? null,
      invoice_date: parsed.data.invoice_date,
      total_cents: parsed.data.total_cents,
      photo_url: parsed.data.photo_url ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctxResult.data.userId,
      document_type: parsed.data.document_type,
      expense_concept_id: conceptId,
      due_date: dueDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createSupplierInvoice", error);
    return actionError("No pudimos cargar la factura.");
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ id: data.id });
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER ↔ INGREDIENTS (VÍNCULO N:N)
// ═══════════════════════════════════════════════════════════════════

export async function linkSupplierIngredients(
  businessSlug: string,
  supplierId: string,
  ingredientIds: string[],
): Promise<ActionResult<void>> {
  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();

  // Validar tenant de supplier + insumos: el service client bypassa RLS y los
  // FK sólo chequean existencia, no negocio. Sin esto, un admin del negocio A
  // podría pasar ids del negocio B y crear vínculos cruzados.
  const { data: supplier } = await service
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!supplier) return actionError("Proveedor no encontrado.");

  if (ingredientIds.length > 0) {
    const { data: owned } = await service
      .from("ingredients")
      .select("id")
      .eq("business_id", businessId)
      .in("id", ingredientIds);
    const ownedIds = new Set((owned ?? []).map((r: { id: string }) => r.id));
    if (ingredientIds.some((id) => !ownedIds.has(id))) {
      return actionError("Algún insumo no pertenece a este negocio.");
    }
  }

  // Atomic replace: delete existing, insert new
  await service
    .from("supplier_ingredients")
    .delete()
    .eq("supplier_id", supplierId)
    .eq("business_id", businessId);

  if (ingredientIds.length > 0) {
    const rows = ingredientIds.map((ingredientId) => ({
      supplier_id: supplierId,
      ingredient_id: ingredientId,
      business_id: businessId,
    }));
    const { error } = await service.from("supplier_ingredients").insert(rows);
    if (error) {
      console.error("linkSupplierIngredients", error);
      return actionError("No pudimos vincular los insumos.");
    }
  }

  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk(undefined);
}

// ═══════════════════════════════════════════════════════════════════
// IMPORT MASIVO
// ═══════════════════════════════════════════════════════════════════

export async function importSuppliers(
  businessSlug: string,
  rows: unknown,
): Promise<ActionResult<{ created: number; updated: number; errors: number }>> {
  const parsed = ImportSupplierBatch.safeParse(rows);
  if (!parsed.success) return actionError("Datos del lote inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const row of parsed.data) {
    const { data: existing } = await service
      .from("suppliers")
      .select("id")
      .eq("business_id", businessId)
      .eq("name", row.name)
      .maybeSingle();

    if (existing) {
      const { error } = await service
        .from("suppliers")
        .update({
          cuit: row.cuit ?? null,
          contact: row.contact ?? null,
          phone: row.phone ?? null,
          email: row.email || null,
        })
        .eq("id", existing.id);
      if (error) {
        errors++;
        console.error("importSuppliers update", row.name, error);
      } else {
        updated++;
      }
    } else {
      const { error } = await service.from("suppliers").insert({
        business_id: businessId,
        name: row.name,
        cuit: row.cuit ?? null,
        contact: row.contact ?? null,
        phone: row.phone ?? null,
        email: row.email || null,
      });
      if (error) {
        errors++;
        console.error("importSuppliers insert", row.name, error);
      } else {
        created++;
      }
    }
  }

  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ created, updated, errors });
}
