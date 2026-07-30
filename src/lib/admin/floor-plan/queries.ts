import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FloorPlan, FloorTable } from "@/lib/reservations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Cast to a generic client until database.types.ts is regenerated after
// migration 0021. Mirrors the pattern used by promos/campaigns queries.
type GenericClient = SupabaseClient;

export type FloorPlanWithTables = {
  plan: FloorPlan;
  tables: FloorTable[];
};

/**
 * Returns the (single) floor plan for a business plus its tables. Auto-creates
 * an empty plan on first access so the editor always has somewhere to save.
 */
export async function getOrCreateFloorPlan(businessId: string): Promise<FloorPlanWithTables> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: existing } = await service
    .from("floor_plans")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let plan = existing as FloorPlan | null;
  if (!plan) {
    const { data, error } = await service
      .from("floor_plans")
      .insert({ business_id: businessId })
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(`No pudimos crear el plano del salón: ${error?.message ?? "desconocido"}`);
    }
    plan = data as FloorPlan;
  }

  const { data: tables } = await service
    .from("tables")
    .select("*")
    .eq("floor_plan_id", plan.id)
    .order("created_at", { ascending: true });

  return { plan, tables: (tables ?? []) as FloorTable[] };
}

/**
 * Devuelve todos los floor_plans del business con sus tables. Usado por
 * `/admin/salones` (listado) y por la tab Salón de `/admin/operacion` para
 * armar el selector multi-salón.
 */
export async function getFloorPlansForBusiness(
  businessId: string,
): Promise<FloorPlanWithTables[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: plans } = await service
    .from("floor_plans")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  const planList = (plans ?? []) as FloorPlan[];
  if (planList.length === 0) {
    // Auto-crear el primero si el business no tiene ninguno (idempotente con
    // `getOrCreateFloorPlan`).
    const seeded = await getOrCreateFloorPlan(businessId);
    return [seeded];
  }

  const planIds = planList.map((p) => p.id);
  const { data: allTables } = await service
    .from("tables")
    .select("*")
    .in("floor_plan_id", planIds)
    .order("created_at", { ascending: true });

  const tablesByPlan = new Map<string, FloorTable[]>();
  for (const t of (allTables ?? []) as FloorTable[]) {
    const list = tablesByPlan.get(t.floor_plan_id) ?? [];
    list.push(t);
    tablesByPlan.set(t.floor_plan_id, list);
  }

  return planList.map((plan) => ({
    plan,
    tables: tablesByPlan.get(plan.id) ?? [],
  }));
}

export type SalonOption = { id: string; name: string };

/**
 * Salones del negocio, sólo id + nombre (spec 065).
 *
 * Es la versión liviana de `getFloorPlansForBusiness` para el **selector de
 * salón** de `/admin/operacion`: la barra de tabs no puede suspender, así que
 * la page la resuelve con un `await` antes del render. Un puñado de filas por
 * índice de `business_id`; no trae mesas ni auto-crea nada.
 */
export async function getSalonOptions(
  businessId: string,
): Promise<SalonOption[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data } = await service
    .from("floor_plans")
    .select("id, name")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  return (data ?? []) as SalonOption[];
}

/**
 * Devuelve un floor_plan específico (por id) + sus tables. Valida pertenencia
 * al business para defensa cross-tenant. Retorna null si no existe o es de
 * otro business.
 */
export async function getFloorPlanById(
  planId: string,
  businessId: string,
): Promise<FloorPlanWithTables | null> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: plan } = await service
    .from("floor_plans")
    .select("*")
    .eq("id", planId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!plan) return null;
  const planRow = plan as FloorPlan;

  const { data: tables } = await service
    .from("tables")
    .select("*")
    .eq("floor_plan_id", planRow.id)
    .order("created_at", { ascending: true });

  return { plan: planRow, tables: (tables ?? []) as FloorTable[] };
}

export async function getFloorPlanForCurrentUser(
  businessId: string,
): Promise<FloorPlanWithTables> {
  // The server client respects RLS — we use it for read paths from RSC so the
  // policies enforce access. Falls back to service client to bootstrap the
  // empty plan since RLS would reject anon inserts.
  const supabase = (await createSupabaseServerClient()) as unknown as GenericClient;
  const { data: plan } = await supabase
    .from("floor_plans")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!plan) {
    return getOrCreateFloorPlan(businessId);
  }
  const { data: tables } = await supabase
    .from("tables")
    .select("*")
    .eq("floor_plan_id", (plan as FloorPlan).id)
    .order("created_at", { ascending: true });
  return { plan: plan as FloorPlan, tables: (tables ?? []) as FloorTable[] };
}
