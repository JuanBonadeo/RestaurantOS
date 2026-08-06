import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * Desasigna el mozo de **todas** las mesas del negocio y audita cada cambio.
 *
 * Vive fuera de `actions.ts` porque tiene dos consumidores que no comparten
 * gate: el botón "Limpiar distribución" del modo pintura (encargado/admin, ver
 * `clearMozoAssignments`) y el corte de la caja principal (`hacerCorte`), que
 * lo dispara solo como parte del cierre del día.
 *
 * No valida permisos ni tenant — el caller ya resolvió el `businessId`.
 * Devuelve cuántas mesas liberó, o `null` si algo falló (el caller decide si
 * eso aborta o solo se loggea).
 */
export async function clearAssignmentsForBusiness(
  service: GenericClient,
  businessId: string,
  byUserId: string | null,
  reason: string,
): Promise<number | null> {
  // Cross-tenant: tables no tiene business_id, se llega por floor_plans.
  const { data: plansData, error: plansError } = await service
    .from("floor_plans")
    .select("id")
    .eq("business_id", businessId);
  if (plansError) {
    console.error("clearAssignmentsForBusiness floor_plans", plansError);
    return null;
  }
  const planIds = ((plansData as { id: string }[] | null) ?? []).map(
    (p) => p.id,
  );
  if (planIds.length === 0) return 0;

  const { data: rowsData, error: rowsError } = await service
    .from("tables")
    .select("id, mozo_id")
    .in("floor_plan_id", planIds)
    .not("mozo_id", "is", null);
  if (rowsError) {
    console.error("clearAssignmentsForBusiness select", rowsError);
    return null;
  }
  const assigned = (rowsData as { id: string; mozo_id: string }[] | null) ?? [];
  if (assigned.length === 0) return 0;

  const { error } = await service
    .from("tables")
    .update({ mozo_id: null })
    .in(
      "id",
      assigned.map((t) => t.id),
    );
  if (error) {
    console.error("clearAssignmentsForBusiness update", error);
    return null;
  }

  // Audit en bloque: una fila por mesa en un solo round-trip (un salón grande
  // son 40+ mesas). El audit no bloquea la mutación primaria.
  const { error: auditError } = await service.from("tables_audit_log").insert(
    assigned.map((t) => ({
      table_id: t.id,
      business_id: businessId,
      kind: "assignment" as const,
      from_value: t.mozo_id,
      to_value: null,
      by_user_id: byUserId,
      reason,
    })),
  );
  if (auditError) {
    console.error("tables_audit_log insert (clear)", auditError);
  }

  return assigned.length;
}
