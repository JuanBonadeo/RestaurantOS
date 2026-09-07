"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { SupplierStats } from "@/lib/proveedores/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { hoyAR, primerDiaDelMesAR } from "@/lib/proveedores/fechas-ar";

type Props = {
  slug: string;
  businessId: string;
};

async function fetchStats(
  businessId: string,
  from?: string,
  to?: string,
): Promise<SupplierStats[]> {
  const { getSupplierStats } = await import("@/lib/proveedores/actions-client");
  return getSupplierStats(businessId, from, to);
}

export function SupplierStatsView({ slug: _slug, businessId }: Props) {
  void _slug;
  // Spec 163 — acá había `new Date().toISOString()`, que es UTC: después de las
  // 21 hs de Argentina el rango saltaba a mañana, y el 30 a las 21 el «hasta» se
  // iba al mes siguiente. Es el único de los cinco componentes de la carpeta que
  // no usaba hora de Buenos Aires.
  const [from, setFrom] = useState(primerDiaDelMesAR);
  const [to, setTo] = useState(hoyAR);
  const [stats, setStats] = useState<SupplierStats[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const data = await fetchStats(businessId, from, to);
    setStats(data);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalCents = stats.reduce((sum, s) => sum + s.totalSpentCents, 0);
  const totalInvoices = stats.reduce((sum, s) => sum + s.invoiceCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="size-4 text-zinc-500" />
        <h2 className="text-base font-bold text-zinc-900">
          Estadística de proveedores
        </h2>
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="text-xs font-medium text-zinc-500">Desde</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-zinc-500">Hasta</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Filtrar
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">Total gastado</p>
          <p className="text-xl font-bold tabular-nums text-zinc-900">
            {formatCurrency(totalCents)}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-zinc-500">Total facturas</p>
          <p className="text-xl font-bold tabular-nums text-zinc-900">
            {totalInvoices}
          </p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="py-8 text-center text-sm text-zinc-400">Cargando…</p>
      ) : stats.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400">
          Sin facturas en el período.
        </p>
      ) : (
        <div className="rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-xs font-medium text-zinc-500">
                <th className="px-4 py-3 text-left">Proveedor</th>
                <th className="px-4 py-3 text-right">Facturas</th>
                <th className="px-4 py-3 text-right">Total gastado</th>
                <th className="px-4 py-3 text-right">Última factura</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats
                .sort((a, b) => b.totalSpentCents - a.totalSpentCents)
                .map((s) => (
                  <tr key={s.supplierId}>
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {s.supplierName}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                      {s.invoiceCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-900">
                      {formatCurrency(s.totalSpentCents)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500">
                      {s.lastInvoiceDate ?? "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
