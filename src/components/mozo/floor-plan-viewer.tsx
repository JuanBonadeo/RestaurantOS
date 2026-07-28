"use client";

import { useState } from "react";

import { DELAY_COLORS } from "@/lib/comandas/mesa-demora";
import type { FloorPlan, FloorTable, OperationalStatus } from "@/lib/reservations/types";

const STATUS_COLORS: Record<OperationalStatus, { fill: string; stroke: string }> = {
  libre: { fill: "#f4f4f5", stroke: "#a1a1aa" },
  ocupada: { fill: "#d1fae5", stroke: "#059669" },
  pidio_cuenta: { fill: "#fef3c7", stroke: "#d97706" },
};

export type TableExtra = {
  reservation?: {
    customer_name: string;
    party_size: number;
    starts_at: string; // ISO
  };
  order?: {
    order_number: number;
    total_cents: number;
    delivery_type: string;
  };
  minutesOpen?: number;
  mozoInitial?: string;
  /** HSL determinístico por user_id — pinta el badge con el color del mozo. */
  mozoColor?: string;
  /**
   * Demora de cocina (spec 30): la comanda más demorada de la mesa sobre su
   * tiempo esperado. `level 0`/undefined = sin punto. Lo calcula el parent con
   * el `now` del ticker; acá se pinta el punto + el tooltip al hover.
   */
  delay?: {
    /** Nivel 0–4 (escalón cada 10' de exceso). */
    level: number;
    /** Exceso real en minutos (para el "+N min" del tooltip). */
    excessMinutes: number;
    /** Sector de la comanda demorada (cocina, parrilla, …). */
    station: string;
  };
};

type Props = {
  plan: Pick<FloorPlan, "width" | "height" | "background_image_url" | "background_opacity">;
  tables: FloorTable[];
  extras?: Record<string, TableExtra>; // keyed by table.id
  onTableClick?: (table: FloorTable) => void;
  /**
   * Modo "pintura" — cuando está activo, las mesas se tiñen por mozo
   * asignado (en vez de color de estado) y el click llama a `onTableClick`
   * con la intención de asignar (el padre decide qué hacer). Cada mesa
   * mira su `extras[id].mozoColor` para decidir el tinte; sin color =
   * sin asignar = gris.
   */
  paintMode?: boolean;
};

export function FloorPlanViewer({ plan, tables, extras = {}, onTableClick, paintMode = false }: Props) {
  const active = tables.filter((t) => t.status === "active");

  return (
    // El plano se AJUSTA a la caja que le da el contenedor (ancho y alto), lo
    // más grande posible y centrado, en vez de dimensionarse solo por el ancho.
    // `preserveAspectRatio="xMidYMid meet"` = contain sin deformar → se adapta a
    // cualquier resolución de monitor sin números mágicos (antes: maxHeight 68vh
    // + aspect-ratio, que ignoraba la altura disponible y dejaba el plano chico
    // con márgenes en pantallas anchas).
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-background">
      <svg
        viewBox={`0 0 ${plan.width} ${plan.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
      >
        {plan.background_image_url && (
          <image
            href={plan.background_image_url}
            x={0}
            y={0}
            width={plan.width}
            height={plan.height}
            preserveAspectRatio="xMidYMid slice"
            opacity={plan.background_opacity / 100}
          />
        )}

        {active.map((table) => (
          <ViewerTable
            key={table.id}
            table={table}
            extra={extras[table.id]}
            paintMode={paintMode}
            planWidth={plan.width}
            planHeight={plan.height}
            onClick={() => onTableClick?.(table)}
          />
        ))}
      </svg>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Tiempo abierto, compacto para el label del plano: "45m", "1h30", "3h", "2d".
 * Antes mostrábamos siempre minutos ("95m"), poco legible pasada la hora.
 */
function formatOpenCompact(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) {
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h${m}`;
  }
  return `${Math.floor(h / 24)}d`;
}

function ViewerTable({
  table,
  extra,
  paintMode,
  planWidth,
  planHeight,
  onClick,
}: {
  table: FloorTable;
  extra?: TableExtra;
  paintMode: boolean;
  planWidth: number;
  planHeight: number;
  onClick: () => void;
}) {
  const [showDelayTip, setShowDelayTip] = useState(false);
  const cx = table.width / 2;
  const cy = table.height / 2;
  const transform = `translate(${table.x} ${table.y}) rotate(${table.rotation} ${cx} ${cy})`;
  const opStatus = table.operational_status ?? "libre";

  // En paint mode: ganan los colores del mozo asignado sobre el estado.
  // Sin mozo → gris zinc (señal de "sin asignar" en este modo).
  const statusColors = STATUS_COLORS[opStatus];
  const fill = paintMode
    ? extra?.mozoColor
      ? `${extra.mozoColor}40` // alpha ~25% para que el label se lea
      : "#f4f4f5"
    : statusColors.fill;
  const stroke = paintMode
    ? extra?.mozoColor ?? "#a1a1aa"
    : statusColors.stroke;
  const strokeWidth = paintMode ? 3 : 2.5;

  const labelSize = Math.min(table.width, table.height) * 0.22;
  const subSize = Math.max(9, labelSize * 0.62);

  // Qué mostrar debajo del label
  const hasReservation = !!extra?.reservation;
  // Radio del badge de reserva, escalado para que se lea también en mesas chicas.
  const reservationBadgeR = Math.max(6, Math.min(9, Math.min(table.width, table.height) * 0.11));
  const minutesOpen = extra?.minutesOpen;

  // Punto de demora de cocina (spec 30). En paint mode no va: el encargado
  // está distribuyendo mozos, no mirando demoras.
  const delay = paintMode ? undefined : extra?.delay;
  const delayColor = delay && delay.level >= 1 ? DELAY_COLORS[delay.level] : null;

  // Geometría del tooltip de demora (se dibuja dentro del SVG al hover, a la
  // misma escala que el resto del plano). Sector + minutos reales de exceso.
  const tipFont = Math.max(11, subSize);
  const tipLine1 = delay?.station ?? "";
  const tipLine2 = delay ? `+${Math.round(delay.excessMinutes)} min de demora` : "";
  const tipChars = Math.max(tipLine1.length, tipLine2.length);
  const tipPadX = tipFont * 0.7;
  const tipW = tipChars * tipFont * 0.56 + tipPadX * 2 + 6;
  const tipH = tipFont * 2.6 + 8;
  // El punto vive en la esquina sup-izq; el tooltip crece hacia el interior y
  // se "flipea" si tocaría el borde del plano (derecha / abajo).
  const tipX = table.x + 16 + tipW > planWidth ? 4 - tipW : 16;
  const tipY = table.y + 16 + tipH > planHeight ? -tipH - 2 : 16;

  // Línea secundaria bajo el label (oculta en paint mode para no saturar).
  let subLine: string | null = null;
  if (!paintMode) {
    if (hasReservation && opStatus === "libre") {
      subLine = `${extra!.reservation!.starts_at ? formatTime(extra!.reservation!.starts_at) : ""} · ${extra!.reservation!.party_size}p`;
    } else if (minutesOpen != null && minutesOpen >= 0) {
      subLine = formatOpenCompact(minutesOpen);
    }
  }

  return (
    <g transform={transform} onClick={onClick} style={{ cursor: "pointer" }}>
      {/* Mesa */}
      {table.shape === "circle" ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={table.width / 2}
          ry={table.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          style={{ filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.1))" }}
        />
      ) : (
        <rect
          x={0}
          y={0}
          width={table.width}
          height={table.height}
          rx={table.shape === "rect" ? 10 : 6}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          style={{ filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.1))" }}
        />
      )}

      {/* Label central */}
      <text
        x={cx}
        y={subLine ? cy - 2 : cy + labelSize * 0.35}
        textAnchor="middle"
        fontSize={labelSize}
        fontWeight="700"
        fill="#18181b"
        style={{ userSelect: "none", pointerEvents: "none", fontFamily: "inherit" }}
      >
        {table.label}
      </text>

      {/* Sub-línea: hora de reserva o tiempo abierta */}
      {subLine && (
        <text
          x={cx}
          y={cy + subSize + 2}
          textAnchor="middle"
          fontSize={subSize}
          fontWeight="500"
          fill="#52525b"
          style={{ userSelect: "none", pointerEvents: "none", fontFamily: "inherit" }}
        >
          {subLine}
        </text>
      )}

      {/* Badge reserva (esquina superior derecha). Antes sólo se dibujaba en
          mesas grandes, así que en las chicas la reserva pasaba desapercibida:
          ahora va siempre, escalado al tamaño de la mesa. */}
      {hasReservation && (
        <>
          <circle
            cx={table.width - reservationBadgeR - 2}
            cy={reservationBadgeR + 2}
            r={reservationBadgeR}
            fill="#6366f1"
            stroke="white"
            strokeWidth={1.5}
          />
          <text
            x={table.width - reservationBadgeR - 2}
            y={reservationBadgeR + 2 + reservationBadgeR * 0.5}
            textAnchor="middle"
            fontSize={reservationBadgeR * 1.1}
            fontWeight="700"
            fill="white"
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            R
          </text>
        </>
      )}

      {/* Badge mozo asignado (esquina inferior derecha) — color del mozo */}
      {extra?.mozoInitial && (
        <>
          <circle
            cx={table.width - 11}
            cy={table.height - 11}
            r={11}
            fill={extra.mozoColor ?? "#0f172a"}
            stroke="white"
            strokeWidth={1.5}
          />
          <text
            x={table.width - 11}
            y={table.height - 7.5}
            textAnchor="middle"
            fontSize="9.5"
            fontWeight="700"
            fill="white"
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            {extra.mozoInitial}
          </text>
        </>
      )}

      {/* Punto de demora de cocina (esquina sup-izq) + tooltip al hover. El
          color encodea cuánto se PASÓ del tiempo esperado; no toca el fill. */}
      {delayColor && delay && (
        <g>
          <circle
            cx={10}
            cy={10}
            r={7.5}
            fill={delayColor}
            stroke="white"
            strokeWidth={1.5}
            onMouseEnter={() => setShowDelayTip(true)}
            onMouseLeave={() => setShowDelayTip(false)}
            style={{ cursor: "pointer" }}
          />
          {showDelayTip && (
            <g
              transform={`translate(${tipX} ${tipY})`}
              style={{ pointerEvents: "none" }}
            >
              <rect
                x={0}
                y={0}
                width={tipW}
                height={tipH}
                rx={tipFont * 0.4}
                fill="#18181b"
                opacity={0.96}
                style={{ filter: "drop-shadow(0 2px 6px rgb(0 0 0 / 0.35))" }}
              />
              <rect x={0} y={0} width={4} height={tipH} rx={2} fill={delayColor} />
              <text
                x={tipPadX}
                y={tipFont * 1.25}
                fontSize={tipFont}
                fontWeight={700}
                fill="#ffffff"
                style={{ userSelect: "none", pointerEvents: "none", fontFamily: "inherit" }}
              >
                {tipLine1}
              </text>
              <text
                x={tipPadX}
                y={tipFont * 2.25}
                fontSize={tipFont * 0.85}
                fill="#e4e4e7"
                style={{ userSelect: "none", pointerEvents: "none", fontFamily: "inherit" }}
              >
                {tipLine2}
              </text>
            </g>
          )}
        </g>
      )}
    </g>
  );
}
