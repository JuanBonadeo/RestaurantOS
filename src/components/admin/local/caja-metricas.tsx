"use client";

/**
 * Las piezas de métrica de la caja que se leen en dos lugares: el board de la
 * tab y el modal de cierre (spec 130). Viven acá para que el modal no tenga
 * que importar del board —que a su vez importa el modal— ni duplicar el
 * desglose que ya existía.
 */

import {
  Banknote,
  CreditCard,
  Link2,
  MoreHorizontal,
  Package,
  QrCode,
  Truck,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

import type { PaymentMethod, VentaOrigen } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
};

export function methodIcon(method: PaymentMethod) {
  switch (method) {
    case "cash": return Banknote;
    case "mp_qr": return QrCode;
    case "mp_link": return Link2;
    case "card_manual": return CreditCard;
    case "transfer": return Wallet;
    default: return MoreHorizontal;
  }
}

// Orden canónico de métodos para el desglose. Las filas con monto > 0 se
// muestran como barras (ordenadas por monto desc); las que están en $0 se
// colapsan en una sola línea al pie, para no competir con los cobros reales.
const COBRO_METHOD_ORDER: PaymentMethod[] = [
  "cash",
  "mp_qr",
  "mp_link",
  "card_manual",
  "transfer",
  "other",
];

export function CobrosPorMetodo({
  porMetodo,
}: {
  porMetodo: Record<PaymentMethod, number>;
}) {
  const metodos = COBRO_METHOD_ORDER.map((key) => ({
    key,
    label: METHOD_LABEL[key],
    Icon: methodIcon(key),
    amount: porMetodo[key] ?? 0,
  }));
  const total = metodos.reduce((s, m) => s + m.amount, 0);
  const activos = metodos
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const vacios = metodos.filter((m) => m.amount === 0);

  return (
    <>
      <ul className="mt-4 space-y-3.5">
        {activos.map(({ key, label, Icon, amount }) => {
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="inline-flex items-baseline gap-2 text-zinc-700">
                  <Icon className="size-3.5 shrink-0 translate-y-px text-zinc-400" />
                  <span className="font-medium">{label}</span>
                  <span className="font-semibold tabular-nums text-zinc-900">
                    {formatCurrency(amount)}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums text-zinc-400">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(pct, 2)}%`,
                    background: "var(--brand, #18181B)",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {vacios.length > 0 && (
        <p className="mt-4 border-t border-zinc-100 pt-3 text-[0.7rem] leading-relaxed text-zinc-400">
          <span className="font-medium text-zinc-500">Sin movimientos:</span>{" "}
          {vacios.map((m) => m.label).join(", ")}
        </p>
      )}
    </>
  );
}

// Desglose de lo cobrado según de dónde vino el pedido. `otro` solo aparece si
// hay plata ahí: es el balde de valores viejos/desconocidos de `delivery_type`.
const ORIGEN_META: Record<
  VentaOrigen,
  { label: string; Icon: typeof UtensilsCrossed }
> = {
  salon: { label: "Salón", Icon: UtensilsCrossed },
  delivery: { label: "Delivery", Icon: Truck },
  takeaway: { label: "Take away", Icon: Package },
  otro: { label: "Otro", Icon: MoreHorizontal },
};

const ORIGEN_ORDER: VentaOrigen[] = ["salon", "delivery", "takeaway", "otro"];

export function VentasPorOrigen({
  porOrigen,
}: {
  porOrigen: Record<VentaOrigen, number>;
}) {
  const total = ORIGEN_ORDER.reduce((s, k) => s + (porOrigen[k] ?? 0), 0);
  const items = ORIGEN_ORDER.filter(
    (k) => k !== "otro" || (porOrigen[k] ?? 0) > 0,
  );

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Cobrado por origen
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {items.map((key) => {
          const { label, Icon } = ORIGEN_META[key];
          const amount = porOrigen[key] ?? 0;
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <li
              key={key}
              className="rounded-xl bg-zinc-50 px-3.5 py-3 ring-1 ring-zinc-200/70"
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                <Icon className="size-3.5 shrink-0 text-zinc-400" />
                {label}
              </p>
              <p className="mt-1 text-lg font-bold tracking-tight text-zinc-900 tabular-nums">
                {formatCurrency(amount)}
              </p>
              <p className="text-[0.7rem] tabular-nums text-zinc-400">
                {pct.toFixed(0)}% del período
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
