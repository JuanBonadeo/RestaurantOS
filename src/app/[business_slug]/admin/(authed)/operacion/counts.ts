import type { LocalComanda } from "@/lib/admin/local-query";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { CajaConEstado, RendicionMozoPendiente } from "@/lib/caja/types";
import type { ReservationStatus } from "@/lib/reservations/types";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";

/**
 * Predicados puros de los contadores ("pills") de las tabs de `/admin/operacion`
 * (spec 39, FR-012). Se centralizan acá para que la pill y el contenido de la
 * tab deriven del **mismo criterio** sobre el **mismo dato** de su grupo de
 * streaming: así no puede desincronizarse el badge respecto de la tab, y un
 * badge nunca muestra un "0" provisional (mientras la promesa del grupo no
 * resuelve, la pill muestra "—" vía el fallback de Suspense; el número sólo se
 * calcula una vez que hay dato).
 *
 * Son idénticos a los criterios que vivían inline en `local-shell.tsx`.
 */

/** Pedidos online que requieren atención (nuevos / por confirmar). */
export function countPedidosNuevos(orders: AdminOrder[]): number {
  return orders.filter((o) => ["pending", "confirmed"].includes(o.status))
    .length;
}

/** Comandas activas = todavía no entregadas. */
export function countComandasActivas(comandas: LocalComanda[]): number {
  return comandas.filter((c) => c.status !== "entregado").length;
}

/**
 * Mesas ocupadas = mesas activas que NO están libres (ocupada / pidió cuenta).
 * Refleja cuántas mesas requieren atención del encargado.
 */
export function countSalonOcupadas(floorPlans: FloorPlanWithTables[]): number {
  return floorPlans
    .flatMap((fp) => fp.tables.filter((t) => t.status === "active"))
    .filter((t) => (t.operational_status ?? "libre") !== "libre").length;
}

/** Cajas del negocio (abiertas o configuradas). */
export function countCajas(cajas: CajaConEstado[]): number {
  return cajas.length;
}

/**
 * Rendiciones pendientes = mozos con al menos un pago sin rendir. Mismo
 * predicado `pagos_count > 0` que usa la tab de Rendición (money-adjacent: un
 * "0" falso puede llevar a cerrar el turno creyendo que no hay nada).
 */
export function countRendicionesPendientes(
  pendientes: RendicionMozoPendiente[],
): number {
  return pendientes.filter((p) => p.pagos_count > 0).length;
}

/**
 * Reservas del día que todavía esperan mesa = `confirmed` (las `seated` ya están
 * en el salón y las canceladas / no-show no requieren acción). Es el número que
 * le importa al encargado: cuánta gente falta sentar.
 */
export function countReservasPorSentar(
  rows: { status: ReservationStatus }[],
): number {
  return rows.filter((r) => r.status === "confirmed").length;
}

/** Personal presente ahora (fichados sin salida). */
export function countPresentes(present: PresentEmployee[]): number {
  return present.length;
}
