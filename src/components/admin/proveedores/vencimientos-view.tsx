"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  getGastoPorConcepto,
  getVencimientos,
} from "@/lib/proveedores/actions-client";
import type { GastoPorClave, Vencimiento } from "@/lib/proveedores/cuenta-corriente-queries";
import { etiquetaTipo } from "@/lib/proveedores/cuenta-corriente";
import { hoyAR, primerDiaDelMesAR } from "@/lib/proveedores/fechas-ar";

export function VencimientosView({ businessId }: { businessId: string }) {
  const [vencimientos, setVencimientos] = useState<Vencimiento[]>([]);
  const [gasto, setGasto] = useState<GastoPorClave[]>([]);
  const [agrupacion, setAgrupacion] = useState<"concepto" | "rubro">("rubro");
  const [desde, setDesde] = useState(primerDiaDelMesAR());
  const [hasta, setHasta] = useState(hoyAR());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getVencimientos(businessId),
      getGastoPorConcepto(businessId, desde, hasta, agrupacion),
    ]).then(([v, g]) => {
      if (cancelled) return;
      setVencimientos(v);
      setGasto(g);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, desde, hasta, agrupacion]);

  const totalDeuda = vencimientos.reduce((n, v) => n + v.saldo_cents, 0);
  const totalVencido = vencimientos
    .filter((v) => v.atraso_dias > 0)
    .reduce((n, v) => n + v.saldo_cents, 0);
  const totalGasto = gasto.reduce((n, g) => n + g.total_cents, 0);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs font-medium text-zinc-500">Deuda total</p>
            <p className="text-lg font-bold tabular-nums text-zinc-900">
              {formatCurrency(totalDeuda)}
            </p>
          </div>
          <div
            className={cn(
              "rounded-xl border p-4",
              totalVencido > 0 ? "border-red-200 bg-red-50" : "bg-white",
            )}
          >
            <p className="text-xs font-medium text-zinc-500">Ya vencido</p>
            <p className="text-lg font-bold tabular-nums text-zinc-900">
              {formatCurrency(totalVencido)}
            </p>
          </div>
        </div>

        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          <CalendarClock className="size-4 text-zinc-500" />
          Qué vence
        </h3>

        {loading ? (
          <p className="py-6 text-center text-sm text-zinc-400">Cargando…</p>
        ) : vencimientos.length === 0 ? (
          <p className="rounded-xl border bg-white py-6 text-center text-sm text-zinc-400">
            No hay comprobantes impagos.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {vencimientos.map((v) => (
              <li key={v.id} className="flex items-center gap-3 p-3">
                {v.atraso_dias > 0 && (
                  <AlertTriangle className="size-4 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {v.supplierName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {v.invoice_number?.trim()
                      ? `#${v.invoice_number.trim()}`
                      : etiquetaTipo(v.document_type ?? "interno")}{" "}
                    · {v.due_date ?? v.invoice_date}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-zinc-900">
                    {formatCurrency(v.saldo_cents)}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      v.atraso_dias > 0 ? "font-medium text-red-600" : "text-zinc-500",
                    )}
                  >
                    {v.atraso_dias > 0
                      ? `${v.atraso_dias} d de atraso`
                      : v.atraso_dias === 0
                        ? "vence hoy"
                        : `en ${-v.atraso_dias} d`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-zinc-900">En qué se fue la plata</h3>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="h-8 rounded-md border border-zinc-200 px-2 text-xs"
            />
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="h-8 rounded-md border border-zinc-200 px-2 text-xs"
            />
            <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold">
              {(["rubro", "concepto"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAgrupacion(a)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition",
                    agrupacion === a
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-900",
                  )}
                >
                  {a === "rubro" ? "Rubro" : "Concepto"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {gasto.length === 0 ? (
          <p className="rounded-xl border bg-white py-6 text-center text-sm text-zinc-400">
            Sin compras en el período.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {gasto.map((g) => {
              const pct = totalGasto > 0 ? (g.total_cents / totalGasto) * 100 : 0;
              return (
                <li key={g.clave} className="p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {g.etiqueta}
                    </p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900">
                      {formatCurrency(g.total_cents)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-zinc-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs text-zinc-500">
                      {pct.toFixed(0)}% · {g.comprobantes}{" "}
                      {g.comprobantes === 1 ? "compra" : "compras"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
