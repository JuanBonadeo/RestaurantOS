"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { requireCatalogManager } from "@/lib/catalog/require-catalog-manager";
import { DailyMenuInput, type DailyMenuComponentInput } from "./schemas";
import { deriveChoiceGroups } from "./choice-groups";

/**
 * Sincroniza los componentes de un menú comparando los incoming contra los
 * que ya están en DB. Inserta los nuevos (sin id), actualiza los existentes
 * (con id) y borra los que desaparecieron. Mismo pattern que
 * `syncModifierGroups` en [src/lib/catalog/product-actions.ts].
 */
async function syncComponents(
  menuId: string,
  components: DailyMenuComponentInput[],
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  // Grupos que realmente existen en lo que se está guardando. Se usa para
  // limpiar referencias a grupos borrados en `blocks_choice_group_ids` (spec
  // 074): si el encargado elimina el grupo «Guarnición», las opciones que lo
  // condicionaban quedarían apuntando a un uuid fantasma. No es un error —el
  // schema lo deja pasar a propósito—, se limpia acá.
  const existingGroupIds = new Set(
    components
      .filter((c) => c.kind === "choice" && c.choice_group_id)
      .map((c) => c.choice_group_id as string),
  );

  const { data: existing } = await supabase
    .from("daily_menu_components")
    .select("id")
    .eq("menu_id", menuId);
  const existingIds = new Set((existing ?? []).map((c) => c.id));
  const incomingIds = new Set(
    components.map((c) => c.id).filter((id): id is string => !!id),
  );
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("daily_menu_components")
      .delete()
      .in("id", toDelete);
    if (error) return "No pudimos borrar componentes viejos.";
  }

  for (const [idx, component] of components.entries()) {
    const payload = {
      menu_id: menuId,
      label: component.label,
      description: component.description ?? null,
      sort_order: idx,
      kind: component.kind ?? "text",
      product_id: component.product_id ?? null,
      choice_group_id: component.choice_group_id ?? null,
      choice_group_label: component.choice_group_label ?? null,
      // Adicional sólo para `choice` (spec 29); los demás kinds van en 0.
      extra_price_cents:
        component.kind === "choice" ? (component.extra_price_cents ?? 0) : 0,
      // Grupos condicionados (spec 074), sólo para `choice` y sólo los que
      // siguen existiendo. Un componente que deja de ser `choice` pierde sus
      // condiciones, igual que pierde el adicional.
      blocks_choice_group_ids:
        component.kind === "choice"
          ? (component.blocks_choice_group_ids ?? []).filter(
              (id) => id !== component.choice_group_id && existingGroupIds.has(id),
            )
          : [],
    };
    if (component.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("daily_menu_components")
        .update(payload as any)
        .eq("id", component.id);
      if (error) return "No pudimos actualizar un componente.";
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from("daily_menu_components")
        .insert(payload as any);
      if (error) return "No pudimos crear un componente.";
    }
  }

  return syncChoiceGroups(menuId, components);
}

/**
 * Mantiene `daily_menu_choice_groups` al día (spec 087).
 *
 * Mientras el editor siga hablando el modelo viejo —una lista plana con el
 * nombre del grupo denormalizado y la condición en la opción— los grupos se
 * **derivan** de los componentes en cada guardado, con la misma traducción que
 * hizo el backfill de la migración `0036`.
 *
 * Esto es lo que permite que los lectores pasen a la tabla nueva sin coordinar
 * un deploy: guarde quien guarde, con el editor que sea, la tabla queda
 * consistente. Cuando el editor mande los grupos explícitos, esta derivación se
 * reemplaza por lo que venga del form.
 */
async function syncChoiceGroups(
  menuId: string,
  components: DailyMenuComponentInput[],
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const grupos = deriveChoiceGroups(components);

  const { data: existentes } = await supabase
    .from("daily_menu_choice_groups")
    .select("id")
    .eq("menu_id", menuId);

  const vivos = new Set(grupos.map((g) => g.id));
  const aBorrar = ((existentes ?? []) as { id: string }[])
    .map((g) => g.id)
    .filter((id) => !vivos.has(id));
  if (aBorrar.length > 0) {
    const { error } = await supabase
      .from("daily_menu_choice_groups")
      .delete()
      .in("id", aBorrar);
    if (error) return "No pudimos borrar grupos de opciones viejos.";
  }

  if (grupos.length === 0) return null;

  // Dos pasadas: primero sin condición, después con ella. La condición apunta a
  // otro grupo del mismo menú y en el alta todavía puede no existir.
  const { error: upsertErr } = await supabase
    .from("daily_menu_choice_groups")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(
      grupos.map((g) => ({
        id: g.id,
        menu_id: menuId,
        name: g.name,
        sort_order: g.sort_order,
      })) as any,
      { onConflict: "id" },
    );
  if (upsertErr) return "No pudimos guardar los grupos de opciones.";

  for (const g of grupos) {
    const { error } = await supabase
      .from("daily_menu_choice_groups")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({
        applies_when_group_id: g.applies_when_group_id,
        applies_when_product_ids: g.applies_when_product_ids,
      } as any)
      .eq("id", g.id);
    if (error) return "No pudimos guardar la condición de un grupo.";
  }

  return null;
}

export async function createDailyMenu(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DailyMenuInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();
  const { components, ...menuData } = parsed.data;
  const { data, error } = await supabase
    .from("daily_menus")
    .insert({ ...menuData, business_id: businessId })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createDailyMenu", error);
    return actionError(
      error?.code === "23505"
        ? "Ya existe un menú con ese slug."
        : "No pudimos crear el menú.",
    );
  }
  const err = await syncComponents(data.id, components);
  if (err) return actionError(err);
  revalidatePath(`/${businessSlug}/admin/menu-del-dia`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ id: data.id });
}

export async function updateDailyMenu(
  businessSlug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = DailyMenuInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();
  const { components, ...menuData } = parsed.data;
  const { error } = await supabase
    .from("daily_menus")
    .update(menuData)
    .eq("id", id)
    .eq("business_id", businessId);
  if (error) {
    console.error("updateDailyMenu", error);
    return actionError(
      error.code === "23505"
        ? "Ya existe un menú con ese slug."
        : "No pudimos actualizar el menú.",
    );
  }
  const err = await syncComponents(id, components);
  if (err) return actionError(err);
  revalidatePath(`/${businessSlug}/admin/menu-del-dia`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ id });
}

export async function deleteDailyMenu(
  businessSlug: string,
  id: string,
): Promise<ActionResult<null>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("daily_menus")
    .delete()
    .eq("id", id)
    .eq("business_id", guard.data.businessId);
  if (error) {
    console.error("deleteDailyMenu", error);
    return actionError("No pudimos borrar el menú.");
  }
  revalidatePath(`/${businessSlug}/admin/menu-del-dia`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk(null);
}

export async function toggleDailyMenuActive(
  businessSlug: string,
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ is_active: boolean }>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("daily_menus")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("business_id", guard.data.businessId);
  if (error) {
    console.error("toggleDailyMenuActive", error);
    return actionError("No pudimos actualizar.");
  }
  revalidatePath(`/${businessSlug}/admin/menu-del-dia`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ is_active: isActive });
}

export async function toggleDailyMenuAvailability(
  businessSlug: string,
  id: string,
  isAvailable: boolean,
): Promise<ActionResult<{ is_available: boolean }>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("daily_menus")
    .update({ is_available: isAvailable })
    .eq("id", id)
    .eq("business_id", guard.data.businessId);
  if (error) {
    console.error("toggleDailyMenuAvailability", error);
    return actionError("No pudimos actualizar.");
  }
  revalidatePath(`/${businessSlug}/admin/menu-del-dia`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ is_available: isAvailable });
}
