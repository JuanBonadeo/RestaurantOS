import { describe, expect, it } from "vitest";

import { groupTablesForSidebar } from "./salon-table-order";
import type { FloorTable, OperationalStatus } from "@/lib/reservations/types";

function mesa(
  id: string,
  label: string,
  operational_status: OperationalStatus,
): FloorTable {
  return {
    id,
    label,
    operational_status,
    seats: 4,
    x: 0,
    y: 0,
    width: 60,
    height: 60,
    status: "active",
  } as FloorTable;
}

const AHORA = new Date("2026-08-03T20:00:00Z").getTime();
const enMinutos = (m: number) =>
  new Date(AHORA + m * 60 * 1000).toISOString();

describe("groupTablesForSidebar", () => {
  it("ordena por urgencia: pidió la cuenta → ocupadas → libres", () => {
    const groups = groupTablesForSidebar(
      [
        mesa("c", "3", "libre"),
        mesa("a", "1", "ocupada"),
        mesa("b", "2", "pidio_cuenta"),
      ],
      {},
      AHORA,
    );
    expect(groups.map((g) => g.tone)).toEqual([
      "pidio_cuenta",
      "ocupada",
      "libre",
    ]);
    expect(groups.flatMap((g) => g.tables.map((t) => t.id))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("dentro de un grupo ordena por label", () => {
    const groups = groupTablesForSidebar(
      [mesa("b", "12", "ocupada"), mesa("a", "3", "ocupada")],
      {},
      AHORA,
    );
    expect(groups[1].tables.map((t) => t.label)).toEqual(["12", "3"]);
  });

  it("una mesa libre con reserva en las próximas 2h sube al tope de su grupo", () => {
    const groups = groupTablesForSidebar(
      [mesa("a", "1", "libre"), mesa("b", "2", "libre")],
      { b: { starts_at: enMinutos(45) } },
      AHORA,
    );
    expect(groups[2].tables.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("una reserva de más tarde no altera el orden", () => {
    const groups = groupTablesForSidebar(
      [mesa("a", "1", "libre"), mesa("b", "2", "libre")],
      { b: { starts_at: enMinutos(240) } },
      AHORA,
    );
    expect(groups[2].tables.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("sin `now` (SSR) ignora las reservas: mismo orden que el server", () => {
    const groups = groupTablesForSidebar(
      [mesa("a", "1", "libre"), mesa("b", "2", "libre")],
      { b: { starts_at: enMinutos(45) } },
      null,
    );
    expect(groups[2].tables.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("una mesa sin estado cuenta como libre", () => {
    const sinEstado = {
      ...mesa("x", "9", "libre"),
      operational_status: null,
    } as unknown as FloorTable;
    const groups = groupTablesForSidebar([sinEstado], {}, AHORA);
    expect(groups[2].tables.map((t) => t.id)).toEqual(["x"]);
  });

  it("devuelve siempre los tres grupos, aunque queden vacíos", () => {
    const groups = groupTablesForSidebar([], {}, AHORA);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.tables.length === 0)).toBe(true);
  });

  it("no muta la lista que recibe", () => {
    const tables = [mesa("b", "2", "ocupada"), mesa("a", "1", "ocupada")];
    groupTablesForSidebar(tables, {}, AHORA);
    expect(tables.map((t) => t.id)).toEqual(["b", "a"]);
  });
});
