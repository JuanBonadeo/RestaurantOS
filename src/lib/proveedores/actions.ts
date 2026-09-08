"use server";


import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canManageProveedores } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calcularVencimiento } from "./cuenta-corriente";
import { conceptoEsDelNegocio } from "./queries";
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

  // Issue #268 · el concepto tiene que ser de ESTE negocio. El FK apunta a
  // `expense_concepts(id)` a secas y el service client bypassa RLS, así que sin
  // esto un id ajeno entra igual: el comprobante queda clasificado en la ficha
  // y en «Sin concepto» en el informe de la 158, para siempre. Mismo chequeo
  // que ya hace `linkSupplierIngredients` con los insumos.
  if (!(await conceptoEsDelNegocio(service, businessId, conceptId))) {
    return actionError("El concepto de gasto no es de este negocio.");
  }

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
    // Issue #268 · el índice único parcial de la 0085. El módulo no tenía NINGÚN
    // chequeo de duplicado: el mismo taco de papeles cargado dos veces duplicaba
    // la deuda con el proveedor y —si traía renglones— el stock. Se traduce acá
    // igual que el 23505 de `suppliers`, porque el que carga no tiene por qué
    // saber que hay un índice.
    return actionError(
      error?.code === "23505"
        ? "Ya cargaste este comprobante de este proveedor con ese número."
        : "No pudimos cargar la factura.",
    );
  }

  // spec 165 · el detalle por insumo, si vino. Una RPC: cada renglón toca la
  // línea, el stock, el consumo y el precio del insumo, y un fallo a mitad
  // dejaría stock sumado sin rastro o precio nuevo sin mercadería.
  //
  // Si los renglones fallan, el comprobante NO queda: se anula, porque un
  // comprobante que el usuario cargó con detalle y quedó sin él es peor que
  // ninguno — parece cargado y no movió nada.
  if (parsed.data.items.length > 0) {
    const { error: itemsErr } = await service.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: data.id,
      p_created_by: ctxResult.data.userId,
      p_items: parsed.data.items,
    });

    if (itemsErr) {
      console.error("createSupplierInvoice · items", itemsErr);
      await service
        .from("supplier_invoices")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: ctxResult.data.userId,
          cancelled_reason: "Revertido: falló la carga del detalle por insumo",
        })
        .eq("id", data.id);
      return actionError(
        itemsErr.message?.includes("INSUMO_DE_OTRO_NEGOCIO")
          ? "Uno de los insumos no es de este negocio."
          : "No pudimos cargar el detalle por insumo. El comprobante no se guardó.",
      );
    }
  }

  revalidatePath(`/${businessSlug}/admin/proveedores`);
  revalidatePath(`/${businessSlug}/admin/catalogo`);
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
