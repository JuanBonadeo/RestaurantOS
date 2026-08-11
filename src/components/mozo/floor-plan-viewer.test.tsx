import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DELAY_COLORS } from "@/lib/comandas/mesa-demora";
import type { FloorTable } from "@/lib/reservations/types";

import { FloorPlanViewer, type TableExtra } from "./floor-plan-viewer";

const plan = {
  width: 500,
  height: 500,
  background_image_url: null,
  background_opacity: 100,
};

function makeTable(p: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    floor_plan_id: "fp1",
    label: "12",
    seats: 4,
    shape: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: "active",
    created_at: "2026-06-25T00:00:00Z",
    operational_status: "ocupada",
    ...p,
  };
}

/** Puntos de demora presentes (circles pintados con un color de nivel ≥ 1). */
function delayDots(container: HTMLElement): Element[] {
  const colors = DELAY_COLORS.slice(1); // sacamos el nivel 0 ("")
  return Array.from(container.querySelectorAll("circle")).filter((c) =>
    colors.includes(c.getAttribute("fill") ?? ""),
  );
}

describe("FloorPlanViewer — punto de demora (spec 30)", () => {
  it("dibuja el punto del nivel sin tocar el fill de estado", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 3, excessMinutes: 35, station: "Parrilla" } },
    };
    const { container } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );

    // Punto nivel 3 (rojo) presente.
    expect(
      container.querySelector(`circle[fill="${DELAY_COLORS[3]}"]`),
    ).not.toBeNull();
    // La mesa conserva su fill de estado (ocupada = verde), no se repinta.
    expect(container.querySelector('rect[fill="#d1fae5"]')).not.toBeNull();
  });

  it("sin demora (sin delayLevel) no dibuja punto", () => {
    const { container } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={{ t1: {} }} />,
    );
    expect(delayDots(container)).toHaveLength(0);
  });

  it("nivel 0 explícito tampoco pinta punto (margen de gracia)", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 0, excessMinutes: 5, station: "Cocina" } },
    };
    const { container } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );
    expect(delayDots(container)).toHaveLength(0);
  });

  it("en paint mode no muestra el punto de demora", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 4, excessMinutes: 50, station: "Parrilla" } },
    };
    const { container } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable()]}
        extras={extras}
        paintMode
      />,
    );
    expect(delayDots(container)).toHaveLength(0);
  });

  it("al hacer hover sobre el punto muestra sector + minutos de demora", () => {
    const extras: Record<string, TableExtra> = {
      t1: { delay: { level: 3, excessMinutes: 23, station: "Parrilla" } },
    };
    const { container, queryByText } = render(
      <FloorPlanViewer plan={plan} tables={[makeTable()]} extras={extras} />,
    );
    // Sin hover no hay tooltip…
    expect(queryByText("Parrilla")).toBeNull();
    // …al pararse encima del punto aparece con el sector + el exceso real.
    const dot = container.querySelector(`circle[fill="${DELAY_COLORS[3]}"]`);
    expect(dot).not.toBeNull();
    fireEvent.mouseEnter(dot!);
    expect(queryByText("Parrilla")).not.toBeNull();
    expect(queryByText("+23 min de demora")).not.toBeNull();
  });
});

describe("FloorPlanViewer — tap fuera de una mesa", () => {
  it("el fondo avisa al padre; la mesa abre la mesa y no cuenta como fondo", () => {
    const onTableClick = vi.fn();
    const onBackgroundClick = vi.fn();
    const { container } = render(
      <FloorPlanViewer
        plan={plan}
        tables={[makeTable()]}
        onTableClick={onTableClick}
        onBackgroundClick={onBackgroundClick}
      />,
    );

    // Tocar el plano al aire = "salir de lo que estoy haciendo".
    fireEvent.click(container.querySelector("svg")!);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(onTableClick).not.toHaveBeenCalled();

    // Tocar la mesa NO burbujea: si lo hiciera, el mismo gesto abriría la mesa
    // y cerraría el panel que acaba de abrir.
    fireEvent.click(container.querySelector("svg > g")!);
    expect(onTableClick).toHaveBeenCalledTimes(1);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
  });
});
