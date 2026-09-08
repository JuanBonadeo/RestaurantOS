"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { getPriceLogDeInsumo } from "@/lib/ingredients/actions-client";
import type { PriceLogEntry } from "@/lib/ingredients/types";

/**
 * El precio que cambió, a la vista — spec 172, fase 5.
 *
 * `ingredient_price_log` existe desde el baseline, tiene su trigger, y hasta hoy
 * tenía **0 filas y ninguna pantalla**. Con el lector de facturas se va a llenar
 * rápido: cada compra con renglones que traiga un precio distinto asienta una
 * fila acá.
 *
 * Es la red POSTERIOR al hecho. La anterior —el precio por unidad base contra el
 * actual, en la pantalla de revisión— va primero y es la que importa, porque
 * anular la compra devuelve el stock pero **no el precio** (165·D4). Ésta existe
 * para el caso en que la anterior no alcanzó: un costo raro en el food cost se
 * puede rastrear hasta el día y la compra que lo escribió.
 */
const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function HistorialPrecio({
  slug,
  ingredientId,
}: {
  slug: string;
  ingredientId: string;
}) {
  const [items, setItems] = useState<PriceLogEntry[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    getPriceLogDeInsumo(slug, ingredientId)
      .then((r) => {
        if (!cancelado) setItems(r.items);
      })
      .catch(() => {
        if (!cancelado) setItems([]);
      });
    return () => {
      cancelado = true;
    };
  }, [slug, ingredientId]);

  // Mientras carga no se dibuja nada: un bloque vacío que después se llena
  // parpadea en una ficha que ya es larga.
  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-900">Historial de precio</p>
        <p className="text-[11px] text-zinc-500">
          Todavía no cambió. Se anota solo cuando una compra con detalle por
          insumo trae un precio distinto al que había.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-zinc-900">Historial de precio</p>
      <ul className="divide-y rounded-xl border border-zinc-200 bg-white">
        {items.map((e) => {
          const subio = e.newCostCents > e.oldCostCents;
          // Sobre 0 no hay variación que calcular: es el primer precio, no un
          // salto. Mostrar «∞%» sería ruido con forma de alarma.
          const pct =
            e.oldCostCents > 0
              ? Math.round(((e.newCostCents - e.oldCostCents) / e.oldCostCents) * 100)
              : null;

          return (
            <li key={e.id} className="flex items-baseline gap-2 px-3 py-2 text-xs">
              <span className="tabular-nums text-zinc-500">{fmtFecha(e.recordedAt)}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-500">
                {e.presentationName ?? "—"}
              </span>
              <span className="tabular-nums text-zinc-400 line-through">
                {formatCurrency(e.oldCostCents)}
              </span>
              <span className="font-semibold tabular-nums text-zinc-900">
                {formatCurrency(e.newCostCents)}
              </span>
              {pct !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 tabular-nums",
                    // ±60%: por debajo de eso, en Argentina, un salto entre dos
                    // compras es normal. El wiki midió NALGA +59%, ENTRECOT
                    // +118% y FILET DE SALMÓN +155% entre 2025-09 y 2026-05.
                    Math.abs(pct) >= 60 ? "font-semibold text-amber-700" : "text-zinc-400",
                  )}
                >
                  {subio ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                  {pct > 0 ? "+" : ""}
                  {pct}%
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
