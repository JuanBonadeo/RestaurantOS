import { describe, expect, it } from "vitest";

import {
  countCajas,
  countPedidosNuevos,
  countPresentes,
  countRendicionesPendientes,
  countReservasPorSentar,
  countSalonOcupadas,
} from "./counts";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { CajaConEstado, RendicionMozoPendiente } from "@/lib/caja/types";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";

// Fixtures mínimos: sólo los campos que el predicado mira, casteados al tipo.
const order = (status: AdminOrder["status"]) => ({ status }) as AdminOrder;
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
    expect(countSalonOcupadas([])).toBe(0);
    expect(countRendicionesPendientes([])).toBe(0);
    expect(countReservasPorSentar([])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec 065 — las pills cuentan sobre el MISMO dato filtrado que muestra la tab.
// ─────────────────────────────────────────────────────────────────────────────

const planDe = (
  id: string,
  tables: FloorPlanWithTables["tables"],
): FloorPlanWithTables =>
  ({ plan: { id }, tables }) as unknown as FloorPlanWithTables;
const reservaEn = (
  status: "confirmed" | "seated" | "cancelled",
  salon: string | null,
) => ({
  status,
  tables: salon ? { floor_plans: { id: salon } } : null,
  floor_plan_id: null,
});

describe("operacion/counts — filtro por salón (spec 065)", () => {
  it("countSalonOcupadas: con un salón puntual sólo mira ese plano", () => {
    const floorPlans = [
      planDe("terraza", [table("active", "ocupada"), table("active", "libre")]),
      planDe("comedor", [
        table("active", "ocupada"),
        table("active", "pidio_cuenta"),
      ]),
    ];
    expect(countSalonOcupadas(floorPlans, [])).toBe(3);
    expect(countSalonOcupadas(floorPlans, ["terraza"])).toBe(1);
    expect(countSalonOcupadas(floorPlans, ["comedor"])).toBe(2);
  });

  it("countReservasPorSentar: con un salón puntual sólo las de ese salón", () => {
    const rows = [
      reservaEn("confirmed", "terraza"),
      reservaEn("confirmed", "comedor"),
      reservaEn("seated", "terraza"),
      reservaEn("confirmed", null), // sin mesa ni zona
    ];
    expect(countReservasPorSentar(rows, [])).toBe(3);
    expect(countReservasPorSentar(rows, ["terraza"])).toBe(1);
  });

  it("un salón sin nada da 0, no el total sin filtrar", () => {
    expect(
      countReservasPorSentar([reservaEn("confirmed", "terraza")], ["quincho"]),
    ).toBe(0);
    expect(countSalonOcupadas([planDe("terraza", [table("active", "ocupada")])], ["quincho"])).toBe(0);
  });
});

describe("operacion/counts — dos salones a la vez (fast-follow 065)", () => {
  it("countSalonOcupadas mira los dos planos elegidos", () => {
    const floorPlans = [
      planDe("terraza", [table("active", "ocupada")]),
      planDe("comedor", [table("active", "pidio_cuenta")]),
      planDe("quincho", [table("active", "ocupada")]),
    ];
    expect(countSalonOcupadas(floorPlans, ["terraza", "comedor"])).toBe(2);
  });

  it("countReservasPorSentar cuenta las de los dos", () => {
    const rows = [
      reservaEn("confirmed", "terraza"),
      reservaEn("confirmed", "comedor"),
      reservaEn("confirmed", "quincho"),
    ];
    expect(countReservasPorSentar(rows, ["terraza", "comedor"])).toBe(2);
  });
});
