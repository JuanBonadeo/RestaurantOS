"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/currency";
import type { SupplierInvoiceItemInput } from "@/lib/proveedores/schema";

export type InsumoOption = {
  id: string;
  name: string;
  unit: string;
  /** La presentación default: cuántas unidades base trae un envase y qué costó. */
  presentationId?: string | null;
  netQuantity?: number;
  costCents?: number;
};

type Renglon = SupplierInvoiceItemInput & { key: string };

/**
 * El detalle por insumo de una compra — spec 165.
 *
 * **Es opcional a propósito**: el 92% de los comprobantes del Golf se cargan sólo
 * con concepto de gasto, y la ayuda de MaxiRest bendice ese camino. Por eso
 * arranca cerrado y hay que abrirlo.
 *
 * Lo que cambia al usarlo: la compra **da de alta stock** y **actualiza el costo
 * del insumo**. Hoy el stock sólo baja —golf-jcr tiene 7 insumos en negativo— y
 * el costo no se movió nunca (`ingredient_price_log` tenía 0 filas).
 *
 * La suma de los renglones **no** tiene que dar el total del comprobante: en
 * 2026 sólo 585 de 1.502 comprobantes del Golf cuadran exacto.
 */
export function RenglonesEditor({
  insumos,
  value,
  onChange,
  totalComprobanteCents,
}: {
  insumos: InsumoOption[];
  value: SupplierInvoiceItemInput[];
  onChange: (items: SupplierInvoiceItemInput[]) => void;
  totalComprobanteCents: number;
}) {
  const [abierto, setAbierto] = useState(value.length > 0);

  const filas: Renglon[] = value.map((v, i) => ({ ...v, key: `${i}` }));
  const sumaCents = value.reduce(
    (n, it) => n + Math.round(it.units * it.unit_cost_cents),
    0,
  );

  const set = (i: number, patch: Partial<SupplierInvoiceItemInput>) =>
    onChange(value.map((v, j) => (i === j ? { ...v, ...patch } : v)));

  function agregar() {
    const primero = insumos[0];
    if (!primero) return;
    onChange([
      ...value,
      {
        ingredient_id: primero.id,
        presentation_id: primero.presentationId ?? null,
        units: 1,
        unit_cost_cents: primero.costCents ?? 0,
      },
    ]);
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setAbierto(true);
          if (value.length === 0) agregar();
        }}
        className="w-full rounded-lg border border-dashed border-zinc-200 py-2.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-800"
      >
        + Detallar por insumo (da de alta stock y actualiza el costo)
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-700">Detalle por insumo</p>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            onChange([]);
          }}
          className="text-[11px] text-zinc-400 underline hover:text-zinc-700"
        >
          Cargar sin detalle
        </button>
      </div>

      {filas.map((f, i) => {
        const ins = insumos.find((x) => x.id === f.ingredient_id);
        return (
          <div key={f.key} className="flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <select
                value={f.ingredient_id}
                onChange={(e) => {
                  const nuevo = insumos.find((x) => x.id === e.target.value);
                  set(i, {
                    ingredient_id: e.target.value,
                    presentation_id: nuevo?.presentationId ?? null,
                    unit_cost_cents: nuevo?.costCents ?? 0,
                  });
                }}
                className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs"
                aria-label="Insumo"
              >
                {insumos.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-16">
              <Input
                className="h-8 text-xs"
                inputMode="decimal"
                value={f.units}
                onChange={(e) => set(i, { units: Number(e.target.value) || 0 })}
                aria-label="Envases"
              />
            </div>
            <div className="w-24">
              <Input
                className="h-8 text-xs"
                inputMode="decimal"
                value={f.unit_cost_cents / 100}
                onChange={(e) =>
                  set(i, {
                    unit_cost_cents: Math.round(
                      (Number(e.target.value.replace(",", ".")) || 0) * 100,
                    ),
                  })
                }
                aria-label="Precio por envase"
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="mb-1 rounded p-1 text-zinc-300 transition hover:bg-zinc-100 hover:text-red-600"
              aria-label="Quitar renglón"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}

      <Button type="button" variant="ghost" size="sm" onClick={agregar} className="h-7 text-xs">
        <Plus className="mr-1 size-3" />
        Agregar insumo
      </Button>

      <div className="flex items-center justify-between border-t pt-2 text-xs">
        <span className="text-zinc-500">Suma del detalle</span>
        <span className="font-semibold tabular-nums text-zinc-800">
          {formatCurrency(sumaCents)}
        </span>
      </div>
      {/* Se muestra la diferencia, no se bloquea: en 2026 sólo 585 de 1.502
          comprobantes del Golf cuadran exacto entre detalle y total. */}
      {totalComprobanteCents > 0 && sumaCents !== totalComprobanteCents && (
        <p className="text-[11px] text-zinc-400">
          El total del comprobante es {formatCurrency(totalComprobanteCents)} — la
          diferencia queda sin detallar, y está bien.
        </p>
      )}
    </div>
  );
}
