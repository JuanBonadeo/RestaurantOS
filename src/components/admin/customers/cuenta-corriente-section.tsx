"use client";

import { useState, useTransition } from "react";
import { BookUser } from "lucide-react";
import { toast } from "sonner";

import { setCuentaCorrienteHabilitada } from "@/lib/caja/cuenta-corriente-actions";
import type { MovimientoCuenta } from "@/lib/caja/cuenta-corriente";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Cuenta corriente en la ficha del cliente — spec 141 · US1.
 *
 * El switch es la única puerta para habilitar a alguien: el buscador del cobro
 * ofrece exactamente a los que están acá en on (D2), y no hay tope de monto —
 * el control es el gate de rol más el saldo a la vista.
 */
export function CuentaCorrienteSection({
  slug,
  customerId,
  habilitadaInicial,
  saldoCents,
  diasSinPagar,
  libro,
}: {
  slug: string;
  customerId: string;
  habilitadaInicial: boolean;
  saldoCents: number;
  diasSinPagar: number | null;
  libro: MovimientoCuenta[];
}) {
  const [habilitada, setHabilitada] = useState(habilitadaInicial);
  const [pending, startTransition] = useTransition();

  const debe = saldoCents > 0;
  const aFavor = saldoCents < 0;

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <BookUser className="size-4 text-zinc-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              Cuenta corriente
            </h2>
            <p className="text-xs text-zinc-500">
              Puede llevarse cosas y pagarlas después.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={habilitada}
          aria-label="Cuenta corriente habilitada"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const siguiente = !habilitada;
              const r = await setCuentaCorrienteHabilitada(
                customerId,
                siguiente,
                slug,
              );
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              setHabilitada(r.data.credit_enabled);
              toast.success(
                r.data.credit_enabled
                  ? "Puede fiar"
                  : debe
                    ? "Ya no puede fiar. La deuda sigue registrada."
                    : "Ya no puede fiar",
              );
            })
          }
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50",
            habilitada ? "bg-emerald-600" : "bg-zinc-200",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
              habilitada ? "left-[1.375rem]" : "left-0.5",
            )}
          />
        </button>
      </div>

      {(habilitada || debe || aFavor) && (
        <div className="mt-4 rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            {aFavor ? "Saldo a favor" : "Debe"}
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              aFavor ? "text-emerald-700" : "text-zinc-900",
            )}
          >
            {formatCurrency(Math.abs(saldoCents))}
          </p>
          {debe && diasSinPagar != null && (
            <p className="mt-1 text-xs text-zinc-500">
              {diasSinPagar === 0
                ? "desde hoy"
                : `hace ${diasSinPagar} día${diasSinPagar === 1 ? "" : "s"} que no paga`}
            </p>
          )}
        </div>
      )}

      {libro.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100">
          {libro.map((m) => (
            <li
              key={`${m.tipo}-${m.id}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span
                className={cn(
                  "min-w-0 truncate",
                  // Lo anulado se muestra tachado, como en el libro de caja: un
                  // movimiento que desaparece es uno que nadie puede auditar.
                  m.anulado ? "text-zinc-400 line-through" : "text-zinc-700",
                )}
              >
                {m.detalle}
              </span>
              <span
                className={cn(
                  "shrink-0 font-medium tabular-nums",
                  m.anulado
                    ? "text-zinc-400 line-through"
                    : m.tipo === "cobranza"
                      ? "text-emerald-700"
                      : "text-zinc-900",
                )}
              >
                {m.tipo === "cobranza" ? "−" : "+"}
                {formatCurrency(m.amount_cents)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {habilitada && libro.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">
          Todavía no se llevó nada en cuenta.
        </p>
      )}
    </section>
  );
}
