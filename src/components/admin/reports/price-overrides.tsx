import { Tag } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import type { PriceOverridesReport } from "@/lib/admin/price-overrides-query";

/**
 * Fecha + hora del cambio en la timezone del negocio. Un timestamp en UTC no
 * le sirve a nadie para reconstruir un turno.
 */
function formatOverrideDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/**
 * Spec 069 (FR-021) — «Precios modificados».
 *
 * Es el contrapeso de que el override no tenga tope: el control no es un
 * límite duro sino que todo cambio de precio quede a la vista del dueño, con
 * motivo y responsable.
 *
 * Si no hubo ninguno, la sección **no se renderiza** — un panel vacío en un
 * reporte largo es ruido, y "no hubo cambios de precio" no es información que
 * el dueño necesite buscar activamente.
 */
export function PriceOverridesSection({
  data,
  timezone,
}: {
  data: PriceOverridesReport;
  timezone: string;
}) {
  if (data.rows.length === 0) return null;

  const { resignedCents, surchargedCents } = data.summary;

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
      <header className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Tag className="size-4" strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Control
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
            Precios modificados
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Líneas cobradas a un precio distinto al de la carta, con su motivo
          </p>
        </div>
      </header>

      {/* Los dos totales van SEPARADOS, no neteados: netear escondería que se
          regaló mucho y se recargó mucho detrás de una diferencia chica. */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Se dejó de cobrar
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">
            {formatCurrency(resignedCents)}
          </p>
        </div>
        <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sky-700">
            Se cobró de más
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-900">
            {formatCurrency(surchargedCents)}
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              <th className="pb-2 pr-3 font-semibold">Producto</th>
              <th className="pb-2 pr-3 font-semibold">Dónde</th>
              <th className="pb-2 pr-3 text-right font-semibold">Carta</th>
              <th className="pb-2 pr-3 text-right font-semibold">Cobrado</th>
              <th className="pb-2 pr-3 text-right font-semibold">Dif.</th>
              <th className="pb-2 pr-3 font-semibold">Motivo</th>
              <th className="pb-2 pr-3 font-semibold">Quién</th>
              <th className="pb-2 font-semibold">Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2.5 pr-3 font-medium text-zinc-900">
                  {r.productName}
                  {r.quantity > 1 && (
                    <span className="ml-1 text-xs text-zinc-500">
                      ×{r.quantity}
                    </span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-zinc-600">
                  {r.tableLabel
                    ? `Mesa ${r.tableLabel}`
                    : r.orderNumber != null
                      ? `Pedido #${r.orderNumber}`
                      : "—"}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-zinc-500 line-through">
                  {formatCurrency(r.priceOriginalCents)}
                </td>
                <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-zinc-900">
                  {formatCurrency(r.unitPriceCents)}
                </td>
                <td
                  className={`py-2.5 pr-3 text-right font-semibold tabular-nums ${
                    r.deltaCents < 0 ? "text-amber-700" : "text-sky-700"
                  }`}
                >
                  {r.deltaCents < 0 ? "−" : "+"}
                  {formatCurrency(Math.abs(r.deltaCents))}
                </td>
                <td className="max-w-[16rem] py-2.5 pr-3 text-zinc-600">
                  {r.reason ?? "—"}
                </td>
                <td className="py-2.5 pr-3 text-zinc-600">
                  {r.actorName ?? "—"}
                </td>
                <td className="py-2.5 whitespace-nowrap text-zinc-500">
                  {r.at ? formatOverrideDate(r.at, timezone) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
