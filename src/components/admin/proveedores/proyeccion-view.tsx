"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { getProyeccionPagos } from "@/lib/proveedores/actions-client";
import type { ProyeccionDelMes } from "@/lib/proveedores/cuenta-corriente-queries";
import { etiquetaTipo, type DocumentType } from "@/lib/proveedores/cuenta-corriente";
import { hoyAR, primerDiaDelMesAR } from "@/lib/proveedores/fechas-ar";

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Las casillas del mes, con los huecos del principio para alinear los días. */
function armarGrilla(mes: string): Array<string | null> {
  const [y, m] = mes.split("-").map(Number);
  const primero = new Date(Date.UTC(y, m - 1, 1));
  const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const celdas: Array<string | null> = Array(primero.getUTCDay()).fill(null);
  for (let d = 1; d <= dias; d++) {
    celdas.push(`${mes}-${String(d).padStart(2, "0")}`);
  }
  return celdas;
}

function moverMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Proyección de pagos — spec 159 · D4.
 *
 * El calendario del mes con la plata que hay que pagar cada día. Responde
 * "¿cuánta plata necesito el jueves?", que la lista de vencimientos —ordenada por
 * atraso— no responde.
 *
 * Lo vencido se acumula en el día de hoy, marcado (D5): sigue siendo plata que
 * hace falta, y en un mes futuro no caería en ninguna casilla.
 */
export function ProyeccionView({ businessId }: { businessId: string }) {
  const hoy = hoyAR();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [data, setData] = useState<ProyeccionDelMes | null>(null);
  const [loading, setLoading] = useState(true);
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProyeccionPagos(businessId, mes).then((d) => {
      if (cancelled) return;
      setData(d);
      setDiaAbierto(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, mes]);

  const porDia = useMemo(
    () => new Map((data?.dias ?? []).map((d) => [d.fecha, d])),
    [data],
  );

  const celdas = useMemo(() => armarGrilla(mes), [mes]);
  const detalle = diaAbierto ? porDia.get(diaAbierto) : null;
  const [y, m] = mes.split("-").map(Number);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMes(moverMes(mes, -1))}
            className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <h3 className="min-w-44 text-center text-sm font-bold capitalize text-zinc-900">
            {MESES[m - 1]} {y}
          </h3>
          <button
            type="button"
            onClick={() => setMes(moverMes(mes, 1))}
            className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="rounded-xl border bg-white px-4 py-2">
          <p className="text-xs font-medium text-zinc-500">Total a pagar del mes</p>
          <p className="text-lg font-bold tabular-nums text-zinc-900">
            {formatCurrency(data?.total_cents ?? 0)}
          </p>
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid grid-cols-7 border-b bg-zinc-50">
          {DIAS.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-center text-xs font-semibold text-zinc-500"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {celdas.map((fecha, i) => {
            if (!fecha) return <div key={`v${i}`} className="min-h-16 border-b border-r bg-zinc-50/50" />;

            const dia = porDia.get(fecha);
            const esHoy = fecha === hoy;
            const conAtraso = dia?.items.some((it) => it.atrasado) ?? false;
            const abierto = fecha === diaAbierto;

            return (
              <button
                key={fecha}
                type="button"
                onClick={() => setDiaAbierto(abierto ? null : dia ? fecha : null)}
                disabled={!dia}
                className={cn(
                  "min-h-16 border-b border-r p-1.5 text-left align-top transition",
                  dia ? "cursor-pointer hover:bg-zinc-50" : "cursor-default",
                  abierto && "bg-zinc-100",
                  conAtraso && "bg-red-50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                    esHoy ? "bg-zinc-900 font-bold text-white" : "text-zinc-500",
                  )}
                >
                  {Number(fecha.slice(-2))}
                </span>
                {dia && (
                  <p
                    className={cn(
                      "mt-1 text-xs font-semibold tabular-nums leading-tight",
                      conAtraso ? "text-red-700" : "text-zinc-900",
                    )}
                  >
                    {formatCurrency(dia.total_cents)}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <p className="py-4 text-center text-sm text-zinc-400">Cargando…</p>
      ) : detalle ? (
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
            Vence el {detalle.fecha}
            {detalle.items.some((i) => i.atrasado) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                <AlertTriangle className="size-3" />
                incluye atrasado
              </span>
            )}
          </h4>
          <ul className="divide-y rounded-xl border bg-white">
            {detalle.items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {it.supplierName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {it.invoice_number?.trim()
                      ? `#${it.invoice_number.trim()}`
                      : etiquetaTipo((it.document_type ?? "interno") as DocumentType)}
                    {it.atrasado && ` · vencía ${it.due_date ?? it.invoice_date}`}
                  </p>
                </div>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    it.atrasado ? "text-red-700" : "text-zinc-900",
                  )}
                >
                  {formatCurrency(it.saldo_cents)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : (data?.dias.length ?? 0) === 0 ? (
        <p className="rounded-xl border bg-white py-8 text-center text-sm text-zinc-400">
          No hay nada que pagar este mes.
        </p>
      ) : (
        <p className="py-2 text-center text-sm text-zinc-400">
          Tocá un día para ver a quién se le paga.
        </p>
      )}
    </div>
  );
}
