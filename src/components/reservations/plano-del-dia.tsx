"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { ElegirMesaBanner } from "@/components/reservations/elegir-mesa-banner";
import {
  mesaSirveParaReserva,
  textoDeAsignacion,
  textoDelModo,
} from "@/lib/reservations/asignar-mesa";
import {
  decideReservation,
  updateReservationDetails,
} from "@/lib/reservations/booking-actions";
import { OVERBOOK_HINT } from "@/lib/reservations/edit-window";
import {
  estadoDeMesasEn,
  horaInicial,
  momentoDe,
  sinMesa,
  type EstadoDeMesa,
  type MesaEnElPlano,
  type ReservaEnPlano,
} from "@/lib/reservations/plano-del-dia";
import type { FloorTable } from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/**
 * El salón a la hora que elijas (spec 137).
 *
 * El plano de Operación es la foto del ahora; éste responde la otra pregunta,
 * la que hay que contestar para decidir una solicitud: **cómo queda el sábado a
 * las 21**. Dibujo deliberadamente simple —sin sillas ni detalle de editor—:
 * son 70 mesas que hay que leer de un vistazo.
 */

const RELLENO: Record<EstadoDeMesa, string> = {
  libre: "fill-white stroke-zinc-300",
  reservada: "fill-blue-50 stroke-blue-400",
  pendiente: "fill-amber-50 stroke-amber-500",
};

const TEXTO: Record<EstadoDeMesa, string> = {
  libre: "fill-zinc-400",
  reservada: "fill-blue-700",
  pendiente: "fill-amber-800",
};

export function PlanoDelDia({
  slug,
  date,
  timezone,
  horas,
  reservas,
  mesas,
  floorPlans,
  asignando,
  onAsignarFin,
  onChanged,
}: {
  slug: string;
  /** `YYYY-MM-DD` del día que se está mirando. */
  date: string;
  timezone: string;
  /** Horas que ofrece el control, calculadas en el server (`horasDelDia`). */
  horas: string[];
  reservas: ReservaEnPlano[];
  mesas: FloorTable[];
  floorPlans: Array<{ id: string; name: string }>;
  /**
   * Spec 138 — la solicitud que está esperando mesa. Viene de afuera porque el
   * botón que enciende el modo vive en la bandeja, que es hermana del plano en
   * la pantalla (spec 136).
   */
  asignando?: { id: string; nombre: string; partySize: number } | null;
  /** Se llama al asignar o al cancelar: la página apaga el modo. */
  onAsignarFin?: () => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Sin `onChanged` (la página server-side) se recarga sola: confirmar desde el
  // plano tiene que verse en el plano.
  const resincronizar = () => (onChanged ? onChanged() : router.refresh());
  const [hora, setHora] = useState(() =>
    horaInicial(horas, reservas, date, timezone),
  );
  const [salonId, setSalonId] = useState(floorPlans[0]?.id ?? "");
  const [elegida, setElegida] = useState<string | null>(null);

  const mesasDelSalon = useMemo(
    () => mesas.filter((t) => (salonId ? t.floor_plan_id === salonId : true)),
    [mesas, salonId],
  );

  const momento = useMemo(
    () => (hora ? momentoDe(date, hora, timezone) : null),
    [date, hora, timezone],
  );

  const estado = useMemo(
    () => (momento ? estadoDeMesasEn(momento, reservas, mesasDelSalon) : []),
    [momento, reservas, mesasDelSalon],
  );

  const genericas = useMemo(
    () => (momento ? sinMesa(momento, reservas) : { cantidad: 0, cubiertos: 0 }),
    [momento, reservas],
  );

  /** Encuadre: el rectángulo que ocupan las mesas, con aire alrededor. */
  const viewBox = useMemo(() => {
    if (mesasDelSalon.length === 0) return "0 0 100 100";
    const pad = 40;
    const minX = Math.min(...mesasDelSalon.map((t) => t.x)) - pad;
    const minY = Math.min(...mesasDelSalon.map((t) => t.y)) - pad;
    const maxX = Math.max(...mesasDelSalon.map((t) => t.x + t.width)) + pad;
    const maxY = Math.max(...mesasDelSalon.map((t) => t.y + t.height)) + pad;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, [mesasDelSalon]);

  const seleccionada = estado.find((m) => m.mesa.id === elegida) ?? null;

  function asignarMesa(mesa: FloorTable) {
    if (!asignando) return;
    const chequeo = mesaSirveParaReserva({
      mesa,
      partySize: asignando.partySize,
    });
    if (!chequeo.ok) {
      toast.error(chequeo.motivo);
      return;
    }
    start(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: asignando.id,
        table_id: mesa.id,
        party_size: asignando.partySize,
      });
      if (result.ok) {
        toast.success(
          textoDeAsignacion({
            intent: "assign",
            etiquetaMesa: mesa.label,
            nombre: asignando.nombre,
          }),
        );
        onAsignarFin?.();
        resincronizar();
        return;
      }
      // Sobrecupo en flexible: no es un no, es un «confirmá» (spec 077). Acá no
      // hay dónde confirmarlo sin sacar al encargado del plano, así que se lo
      // manda al panel de edición, que sí tiene ese diálogo.
      toast.error(
        result.error.endsWith(OVERBOOK_HINT)
          ? `${result.error} Usá «Editar» en la solicitud.`
          : result.error,
      );
    });
  }

  function decidir(id: string, decision: "confirm" | "reject") {
    start(async () => {
      const result = await decideReservation({
        business_slug: slug,
        id,
        decision,
      });
      if (result.ok) {
        toast.success(
          decision === "confirm" ? "Reserva confirmada." : "Reserva rechazada.",
        );
        setElegida(null);
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (mesasDelSalon.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-sm text-zinc-500 ring-1 ring-zinc-200/70">
        Este salón todavía no tiene mesas cargadas.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-4 ring-1",
        asignando ? "ring-2 ring-indigo-500" : "ring-zinc-200/70",
      )}
    >
      {/* Spec 138 — el plano queda esperando el tap, como en Operación. */}
      {asignando && (
        <div className="mb-3">
          <ElegirMesaBanner
            texto={textoDelModo({
              intent: "assign",
              nombre: asignando.nombre,
              partySize: asignando.partySize,
            })}
            onCancelar={() => onAsignarFin?.()}
          />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {floorPlans.length > 1 && (
          <select
            value={salonId}
            onChange={(e) => {
              setSalonId(e.target.value);
              setElegida(null);
            }}
            className="h-8 rounded-xl border-0 bg-zinc-100 px-2.5 text-xs font-medium text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-300"
          >
            {floorPlans.map((fp) => (
              <option key={fp.id} value={fp.id}>
                {fp.name}
              </option>
            ))}
          </select>
        )}

        {horas.length > 0 ? (
          <div className="flex flex-1 items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">
              Cómo queda a las
            </span>
            <span className="rounded-lg bg-zinc-900 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-white">
              {hora || "—"}
            </span>
            <input
              type="range"
              min={0}
              max={horas.length - 1}
              step={1}
              value={Math.max(0, horas.indexOf(hora))}
              onChange={(e) => setHora(horas[Number(e.target.value)] ?? hora)}
              aria-label="Hora del plano"
              className="h-1 flex-1 cursor-pointer accent-zinc-900"
            />
          </div>
        ) : (
          <span className="text-xs text-zinc-500">
            Este día no tiene horarios configurados.
          </span>
        )}
      </div>

      <svg
        viewBox={viewBox}
        className="h-auto w-full"
        style={{ maxHeight: 420 }}
        role="img"
        aria-label={`Plano del salón a las ${hora}`}
      >
        {estado.map((m) => (
          <MesaDibujada
            key={m.mesa.id}
            m={m}
            elegida={m.mesa.id === elegida}
            // Con el modo activo, la mesa que no da la capacidad se ve apagada:
            // que el «no entran» se vea antes del tap, no después.
            apagada={
              !!asignando &&
              !mesaSirveParaReserva({
                mesa: m.mesa,
                partySize: asignando.partySize,
              }).ok
            }
            onClick={() => {
              if (asignando) {
                asignarMesa(m.mesa);
                return;
              }
              setElegida(m.mesa.id === elegida ? null : m.mesa.id);
            }}
          />
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <Leyenda className="bg-white ring-zinc-300" label="libre" />
        <Leyenda className="bg-blue-50 ring-blue-400" label="reservada" />
        <Leyenda
          className="bg-amber-50 ring-amber-500 ring-dashed"
          label="solicitud sin responder"
        />
        {genericas.cantidad > 0 && (
          <span className="ml-auto">
            {genericas.cantidad}{" "}
            {genericas.cantidad === 1 ? "reserva" : "reservas"} sin mesa ·{" "}
            {genericas.cubiertos} cubiertos
          </span>
        )}
      </div>

      {seleccionada && (
        <div
          className={cn(
            "mt-3 rounded-xl p-3 ring-1",
            seleccionada.estado === "pendiente"
              ? "bg-amber-50 ring-amber-200"
              : "bg-zinc-50 ring-zinc-200",
          )}
        >
          <p className="text-xs font-semibold text-zinc-900">
            Mesa {seleccionada.mesa.label}
          </p>
          {seleccionada.reserva ? (
            <>
              <p className="mt-0.5 text-xs text-zinc-600">
                {seleccionada.reserva.customer_name} ·{" "}
                {seleccionada.reserva.party_size}p ·{" "}
                {formatInTimeZone(
                  new Date(seleccionada.reserva.starts_at),
                  timezone,
                  "HH:mm",
                )}
                {seleccionada.estado === "pendiente" && " · sin responder"}
              </p>
              {seleccionada.estado === "pendiente" && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => decidir(seleccionada.reserva!.id, "confirm")}
                    disabled={pending}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => decidir(seleccionada.reserva!.id, "reject")}
                    disabled={pending}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-60"
                  >
                    <X className="h-3.5 w-3.5" />
                    Rechazar
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="mt-0.5 text-xs text-zinc-500">
              Libre a las {hora}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MesaDibujada({
  m,
  elegida,
  apagada = false,
  onClick,
}: {
  m: MesaEnElPlano;
  elegida: boolean;
  /** Spec 138 — no sirve para la solicitud que se está asignando. */
  apagada?: boolean;
  onClick: () => void;
}) {
  const { mesa, estado } = m;
  const cx = mesa.x + mesa.width / 2;
  const cy = mesa.y + mesa.height / 2;
  const comun = cn(
    RELLENO[estado],
    estado === "pendiente" ? "[stroke-dasharray:5_3]" : "",
    elegida ? "stroke-[3]" : "stroke-[1.5]",
    apagada ? "opacity-30" : "",
    "cursor-pointer transition",
  );

  return (
    <g
      transform={`rotate(${mesa.rotation} ${cx} ${cy})`}
      onClick={onClick}
      role="button"
      aria-label={`Mesa ${mesa.label}, ${estado}`}
    >
      {mesa.shape === "circle" ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={mesa.width / 2}
          ry={mesa.height / 2}
          className={comun}
        />
      ) : (
        <rect
          x={mesa.x}
          y={mesa.y}
          width={mesa.width}
          height={mesa.height}
          rx={mesa.shape === "square" ? 8 : 10}
          className={comun}
        />
      )}
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        className={cn("pointer-events-none text-[13px] font-semibold", TEXTO[estado])}
      >
        {mesa.label}
      </text>
    </g>
  );
}

function Leyenda({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-2.5 rounded ring-1", className)} />
      {label}
    </span>
  );
}
