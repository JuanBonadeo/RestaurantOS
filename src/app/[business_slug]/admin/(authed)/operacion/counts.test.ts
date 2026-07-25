import { describe, expect, it } from "vitest";

import {
  countCajas,
  countComandasActivas,
  countPedidosNuevos,
  countPresentes,
  countRendicionesPendientes,
  countReservasPorSentar,
  countSalonOcupadas,
} from "./counts";
import type { LocalComanda } from "@/lib/admin/local-query";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { CajaConEstado, RendicionMozoPendiente } from "@/lib/caja/types";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";

// Fixtures mínimos: sólo los campos que el predicado mira, casteados al tipo.
const order = (status: AdminOrder["status"]) => ({ status }) as AdminOrder;
const comanda = (status: LocalComanda["status"]) => ({ status }) as LocalComanda;
const table = (
  status: "active" | "inactive",
  operational_status: string | null,
) =>
  ({ status, operational_status: operational_status ?? undefined }) as unknown as
    FloorPlanWithTables["tables"][number];
const plan = (tables: FloorPlanWithTables["tables"]): FloorPlanWithTables =>
  ({ plan: {}, tables }) as unknown as FloorPlanWithTables;
const pendiente = (pagos_count: number) =>
  ({ pagos_count }) as RendicionMozoPendiente;

describe("operacion/counts — predicados de pills (FR-012)", () => {
  it("countPedidosNuevos: pending + confirmed cuentan; el resto no", () => {
    const orders = [
      order("pending"),
      order("confirmed"),
      order("preparing"),
      order("delivered"),
      order("cancelled"),
    ];
    expect(countPedidosNuevos(orders)).toBe(2);
  });

  it("countComandasActivas: todo lo que no está entregado", () => {
    const comandas = [
      comanda("pendiente"),
      comanda("en_preparacion"),
      comanda("entregado"),
    ];
    expect(countComandasActivas(comandas)).toBe(2);
  });

  it("countSalonOcupadas: mesas activas NO libres, aplanando floor plans", () => {
    const floorPlans = [
      plan([
        table("active", "ocupada"),
        table("active", "libre"),
        table("active", "pidio_cuenta"),
        table("inactive", "ocupada"), // inactiva → no cuenta aunque esté ocupada
      ]),
      plan([table("active", null)]), // sin operational_status = libre → no cuenta
    ];
    expect(countSalonOcupadas(floorPlans)).toBe(2);
  });

  it("countRendicionesPendientes: solo mozos con pagos_count > 0", () => {
    const pendientes = [pendiente(0), pendiente(3), pendiente(1)];
    expect(countRendicionesPendientes(pendientes)).toBe(2);
  });

  it("countReservasPorSentar: solo las confirmadas (las sentadas ya están en mesa)", () => {
    const rows = [
      { status: "confirmed" as const },
      { status: "seated" as const },
      { status: "confirmed" as const },
      { status: "cancelled" as const },
      { status: "no_show" as const },
      { status: "completed" as const },
    ];
    expect(countReservasPorSentar(rows)).toBe(2);
  });

  it("countCajas y countPresentes son el largo de su lista", () => {
    expect(countCajas([{}, {}] as unknown as CajaConEstado[])).toBe(2);
    expect(countPresentes([{}] as unknown as PresentEmployee[])).toBe(1);
  });

  it("listas vacías → 0 (nunca undefined/NaN)", () => {
    expect(countPedidosNuevos([])).toBe(0);
    expect(countComandasActivas([])).toBe(0);
    expect(countSalonOcupadas([])).toBe(0);
    expect(countRendicionesPendientes([])).toBe(0);
    expect(countReservasPorSentar([])).toBe(0);
  });
});
