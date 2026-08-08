"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CreditCard,
  Link2,
  Lock,
  MoreHorizontal,
  Package,
  QrCode,
  RefreshCw,
  Settings,
  Truck,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
import { SegmentedSelector } from "@/components/admin/local/segmented-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  hacerCorte,
  registrarIngreso,
  registrarSangria,
} from "@/lib/caja/actions";
import type { CajaPayment } from "@/lib/caja/queries";
import type {
  CajaConEstado,
  CajaLiveStats,
  CajaMovimiento,
  PaymentMethod,
  VentaOrigen,
} from "@/lib/caja/types";
import { useCajaPreferida } from "@/lib/caja/use-caja-preferida";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  cajas: CajaConEstado[];
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
};

export function CajaAdminBoard({ slug, cajas, active = true }: Props) {
  const router = useRouter();
  const [statsByCaja, setStatsByCaja] = useState<
    Record<string, CajaLiveStats | null>
  >({});
  const [movimientosByCaja, setMovimientosByCaja] = useState<
    Record<string, CajaMovimiento[]>
  >({});
  const [paymentsByCaja, setPaymentsByCaja] = useState<
    Record<string, CajaPayment[]>
  >({});
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Selector de caja activa (persiste por máquina) ──
  // Misma preferencia que usa el cobro: el puesto del bar registra en Caja Bar
  // acá y al cobrar. Ver `use-caja-preferida.ts`.
  const [activeCajaId, selectCaja] = useCajaPreferida(slug, cajas);

  // Poll de stats por caja. Depende de `active` (spec 101): con el keep-alive el
  // panel queda montado al cambiar de tab, y sin esta guarda seguiría golpeando
  // `/api/caja/stats` × N cajas cada 30 s desde cada tablet del local, para
  // siempre, sin que nadie lo mire. Volver a la tab re-corre el effect → `load()`
  // inmediato: la tab de plata nunca pinta el snapshot viejo mientras espera el
  // primer tick.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        cajas.map(async (c) => {
          try {
            const res = await fetch(`/api/caja/stats?caja=${c.id}`);
            const data = await res.json();
            return [
              c.id,
              data?.stats ?? null,
              data?.movimientos ?? [],
              data?.payments ?? [],
            ] as const;
          } catch {
            return [c.id, null, [], []] as const;
          }
        }),
      );
      if (!cancelled) {
        setStatsByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[1]])),
        );
        setMovimientosByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[2]])),
        );
        setPaymentsByCaja(
          Object.fromEntries(entries.map((e) => [e[0], e[3]])),
        );
      }
    };
    if (cajas.length > 0) load();
    const i = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [cajas, refreshKey, active]);

  if (cajas.length === 0) {
    return (
      <div className="space-y-5">
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-6 text-center">
            <div
              className="flex size-14 items-center justify-center rounded-full"
              style={{ background: "var(--brand-soft, #F4F4F5)" }}
            >
              <Wallet
                className="size-7"
                style={{ color: "var(--brand, #18181B)" }}
              />
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
                Sin cajas configuradas
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                Creá una caja desde la configuración para empezar a operar.
              </p>
            </div>
            <Link
              href={`/${slug}/admin/cajas`}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition hover:brightness-95"
              style={{
                background: "var(--brand, #18181B)",
                color: "var(--brand-foreground, white)",
              }}
            >
              <Settings className="size-4" />
              Configurar cajas
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  const activeCaja = cajas.find((c) => c.id === activeCajaId) ?? cajas[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        {cajas.length > 1 ? (
          <SegmentedSelector
            ariaLabel="Seleccionar caja"
            activeId={activeCajaId}
            onSelect={selectCaja}
            items={cajas.map((c) => ({
              id: c.id,
              label: c.name,
              count: statsByCaja[c.id]?.cobros_count || undefined,
            }))}
          />
        ) : (
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Refresco cada 30s
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setRefreshKey((k) => k + 1);
            router.refresh();
          }}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Refrescar"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <CajaCard
        key={activeCaja.id}
        caja={activeCaja}
        stats={statsByCaja[activeCaja.id] ?? null}
        movimientos={movimientosByCaja[activeCaja.id] ?? []}
        payments={paymentsByCaja[activeCaja.id] ?? []}
        slug={slug}
      />

      <div className="pt-1 text-center">
        <Link
          href={`/${slug}/admin/cajas`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
        >
          <Settings className="size-3" />
          Configurar cajas
        </Link>
      </div>
    </div>
  );
}

// ── Card de caja (siempre operativa) ─────────────────────────────

function CajaCard({
  caja,
  stats,
  movimientos,
  payments,
  slug,
}: {
  caja: CajaConEstado;
  stats: CajaLiveStats | null;
  movimientos: CajaMovimiento[];
  payments: CajaPayment[];
  slug: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [ingresoOpen, setIngresoOpen] = useState(false);
  const [corteOpen, setCorteOpen] = useState(false);

  const expected = stats?.expected_cash_cents ?? 0;
  const ventas = stats?.total_ventas_cents ?? 0;
  const propinas = stats?.total_propinas_cents ?? 0;
  const cobros = stats?.cobros_count ?? 0;
  const porMetodo = stats?.ventas_por_metodo;
  const porOrigen = stats?.ventas_por_origen;
  const periodoDesdeFecha = stats?.periodo_desde ?? caja.periodo_desde;

  const periodoLabel = (() => {
    const d = new Date(periodoDesdeFecha);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
    if (diffMin < 1) return "desde ahora";
    if (diffMin < 60) return `desde hace ${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m === 0 ? `desde hace ${h}h` : `desde hace ${h}h ${m}m`;
  })();

  type Entry =
    | { kind: "cobro"; createdAt: string; data: CajaPayment }
    | { kind: "sangria" | "ingreso"; createdAt: string; data: CajaMovimiento };
  const entries: Entry[] = [
    ...payments.map((p) => ({
      kind: "cobro" as const,
      createdAt: p.created_at,
      data: p,
    })),
    ...movimientos.map((m) => ({
      kind: m.kind as "sangria" | "ingreso",
      createdAt: m.created_at,
      data: m,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="text-lg font-semibold tracking-tight text-zinc-900">
              {caja.name}
            </h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-800">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              Activa
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Período activo {periodoLabel}
            {caja.ultimo_corte && " · último corte registrado"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSangriaOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ArrowDownToLine className="size-3.5" /> Sangría
          </button>
          <button
            type="button"
            onClick={() => setIngresoOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
          >
            <ArrowUpFromLine className="size-3.5" /> Ingreso
          </button>
          <button
            type="button"
            onClick={() => setCorteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition hover:brightness-95"
            style={{
              background: "var(--brand, #18181B)",
              color: "var(--brand-foreground, white)",
            }}
          >
            <Lock className="size-3.5" /> Hacer corte
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          className="rounded-2xl p-5 ring-1 ring-zinc-200/70"
          style={{ background: "var(--brand-soft, #F4F4F5)" }}
        >
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            En la caja deberías tener
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {formatCurrency(expected)}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {caja.ultimo_corte
              ? `${formatCurrency(caja.ultimo_corte.closing_cash_cents)} del corte anterior`
              : "$0 inicio"}{" "}
            + movimientos del período
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Cobrado en el período
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 tabular-nums">
            {formatCurrency(ventas)}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {cobros} {cobros === 1 ? "cobro" : "cobros"}
            {propinas > 0 && ` · ${formatCurrency(propinas)} en propinas`}
          </p>
        </div>
      </div>

      {porOrigen && cobros > 0 && <VentasPorOrigen porOrigen={porOrigen} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Cobros por método
          </p>
          {porMetodo && cobros > 0 ? (
            <CobrosPorMetodo porMetodo={porMetodo} />
          ) : (
            <p className="mt-3 text-xs text-zinc-500">Todavía no hubo cobros.</p>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Movimientos del período
            </p>
            <div className="flex items-baseline gap-2">
              {/* El período es el hot path del turno; el libro (spec 070) es el
                  histórico con filtros, los anulados y la corrección. */}
              <Link
                href={`/${slug}/admin/operacion/movimientos?caja=${caja.id}`}
                className="text-xs font-semibold text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
              >
                Ver todos
              </Link>
              <p className="text-xs font-semibold tabular-nums text-zinc-700">
                {entries.length}
              </p>
            </div>
          </div>
          {entries.length === 0 ? (
            <p className="mt-3 text-xs text-zinc-500">
              Todavía no hubo movimientos.
            </p>
          ) : (
            <ul className="mt-3 max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200/70">
              {entries.map((e) => {
                const dia = e.createdAt.slice(0, 10);
                const href = `/${slug}/admin/operacion/movimientos?caja=${caja.id}&desde=${dia}`;
                return e.kind === "cobro" ? (
                  <CobroRow key={`p-${e.data.id}`} payment={e.data} href={href} />
                ) : (
                  <MovimientoRow key={`m-${e.data.id}`} mov={e.data} href={href} />
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {payments.length > 0 && <RendicionSection payments={payments} />}

      <MovimientoModal
        open={sangriaOpen}
        onOpenChange={setSangriaOpen}
        title="Registrar sangría"
        description="Sacar efectivo de la caja (depósito en banco, pago a proveedor, etc.)."
        requiereMotivo
        ctaLabel="Registrar sangría"
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarSangria(caja.id, amount, reason ?? "", slug);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Sangría registrada");
              setSangriaOpen(false);
              router.refresh();
            }
          })
        }
      />
      <MovimientoModal
        open={ingresoOpen}
        onOpenChange={setIngresoOpen}
        title="Registrar ingreso"
        description="Sumar efectivo extra a la caja."
        requiereMotivo={false}
        ctaLabel="Registrar ingreso"
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarIngreso(caja.id, amount, reason ?? null, slug);
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Ingreso registrado");
              setIngresoOpen(false);
              router.refresh();
            }
          })
        }
      />
      <CorteModal
        open={corteOpen}
        onOpenChange={setCorteOpen}
        cajaName={caja.name}
        ventas={ventas}
        propinas={propinas}
        expected={expected}
        onSubmit={(closing, notes) =>
          startTransition(async () => {
            const r = await hacerCorte(caja.id, closing, notes, null, slug);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success(
              r.data.mesasLiberadas > 0
                ? `Corte registrado — ${r.data.mesasLiberadas} mesas liberadas.`
                : "Corte registrado",
            );
            setCorteOpen(false);
            router.refresh();
          })
        }
      />
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────

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

function CobrosPorMetodo({
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

function VentasPorOrigen({
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

function MovimientoRow({ mov, href }: { mov: CajaMovimiento; href: string }) {
  const isSangria = mov.kind === "sangria";
  const time = new Date(mov.created_at).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex items-start gap-3 px-3 py-2.5 transition hover:bg-zinc-50",
          mov.cancelled_at && "opacity-50",
        )}
      >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          isSangria ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
        )}
      >
        {isSangria ? (
          <ArrowDownToLine className="size-3.5" strokeWidth={2.25} />
        ) : (
          <ArrowUpFromLine className="size-3.5" strokeWidth={2.25} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {isSangria ? "Sangría" : "Ingreso"}
            <span className="ml-1.5 text-[10px] font-normal text-zinc-400 tabular-nums">{time}</span>
          </p>
          <p className={cn("shrink-0 text-sm font-bold tabular-nums", isSangria ? "text-rose-700" : "text-emerald-700")}>
            {isSangria ? "−" : "+"}
            {formatCurrency(mov.amount_cents)}
          </p>
        </div>
        {mov.reason && <p className="mt-0.5 truncate text-xs text-zinc-500">{mov.reason}</p>}
      </div>
      </Link>
    </li>
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
};

function methodIcon(method: PaymentMethod) {
  switch (method) {
    case "cash": return Banknote;
    case "mp_qr": return QrCode;
    case "mp_link": return Link2;
    case "card_manual": return CreditCard;
    case "transfer": return Wallet;
    default: return MoreHorizontal;
  }
}

function CobroRow({ payment, href }: { payment: CajaPayment; href: string }) {
  const Icon = methodIcon(payment.method);
  const time = new Date(payment.created_at).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const origen =
    payment.delivery_type === "dine_in" && payment.table_label
      ? `Mesa ${payment.table_label}`
      : payment.customer_name?.trim() ||
        (payment.order_number > 0 ? `#${payment.order_number}` : "Orden");

  return (
    <li>
      {/* La línea es accionable: lleva al libro, que es donde se corrige. */}
      <Link
        href={href}
        className="flex items-start gap-3 px-3 py-2.5 transition hover:bg-zinc-50"
      >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {origen}
            <span className="ml-1.5 text-[10px] font-normal text-zinc-400 tabular-nums">{time}</span>
          </p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-900">
            +{formatCurrency(payment.amount_cents)}
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs text-zinc-500">
            {METHOD_LABEL[payment.method]}
            {payment.attributed_mozo_name && (
              <><span className="mx-1 text-zinc-300">·</span>{payment.attributed_mozo_name}</>
            )}
          </p>
          {payment.tip_cents > 0 && (
            <p className="shrink-0 text-[11px] text-emerald-700 tabular-nums">
              +{formatCurrency(payment.tip_cents)} propina
            </p>
          )}
        </div>
      </div>
      </Link>
    </li>
  );
}

// ── Modales ──────────────────────────────────────────────────────

function MovimientoModal({
  open,
  onOpenChange,
  title,
  description,
  requiereMotivo,
  ctaLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  requiereMotivo: boolean;
  ctaLabel: string;
  onSubmit: (amountCents: number, reason: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) { setAmount(""); setReason(""); }
  }, [open]);

  const cents = Math.max(0, Math.round(Number(amount) * 100));
  const canSubmit = cents > 0 && (!requiereMotivo || reason.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="-mt-2 text-sm text-zinc-600">{description}</p>
        <div className="mt-3 grid gap-4">
          <div className="grid gap-1.5">
            <Label>Monto</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-zinc-400">$</span>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus inputMode="decimal" className="pl-7 text-base tabular-nums" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Motivo{requiereMotivo && <span className="ml-1 text-rose-600">*</span>}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={requiereMotivo ? "Ej: depósito en banco / pago proveedor" : "Opcional"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!canSubmit} onClick={() => onSubmit(cents, reason.trim() || null)}>{ctaLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CorteModal({
  open,
  onOpenChange,
  cajaName,
  ventas,
  propinas,
  expected,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cajaName: string;
  ventas: number;
  propinas: number;
  expected: number;
  onSubmit: (closingCents: number, notes: string | null) => void;
}) {
  const [closing, setClosing] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) { setClosing(""); setNotes(""); }
  }, [open]);

  const cents = closing === "" ? null : Math.max(0, Math.round(Number(closing) * 100));
  const diff = cents === null ? 0 : cents - expected;
  const requiresNotes = cents !== null && diff !== 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Hacer corte
            <span className="ml-2 text-sm font-normal text-zinc-500">· {cajaName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Lo que esperás encontrar
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">
            {formatCurrency(expected)}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Cobros en efectivo ({formatCurrency(ventas)})
            {propinas > 0 && ` + propinas (${formatCurrency(propinas)})`}
          </p>
        </div>

        <div className="mt-4 grid gap-1.5">
          <Label className="text-sm font-medium">Efectivo contado en caja</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-zinc-400">$</span>
            <Input type="number" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="0" autoFocus inputMode="decimal" className="pl-7 text-base tabular-nums" />
          </div>
        </div>

        {cents !== null && diff !== 0 && (
          <div className={cn("mt-4 flex items-center justify-between rounded-lg p-3 ring-1", diff < 0 ? "bg-rose-50 ring-rose-200 text-rose-900" : "bg-amber-50 ring-amber-200 text-amber-900")}>
            <span className="text-sm font-semibold">{diff < 0 ? "Te falta" : "Te sobra"}</span>
            <span className="text-lg font-bold tabular-nums">{diff > 0 ? "+" : "−"}{formatCurrency(Math.abs(diff))}</span>
          </div>
        )}

        {cents !== null && diff === 0 && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200 text-emerald-900">
            <span className="text-sm font-semibold">Cuadra perfecto</span>
            <Banknote className="size-4" />
          </div>
        )}

        {requiresNotes && (
          <div className="mt-3 grid gap-1.5">
            <Label className="text-sm font-medium">¿Qué pasó?<span className="ml-1 text-rose-600">*</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Vuelto mal dado, billete falso, propina mal cargada…" />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={cents === null || (requiresNotes && notes.trim() === "")}
            onClick={() => cents !== null && onSubmit(cents, notes.trim() || null)}
          >
            <Lock className="mr-2 size-4" />
            Hacer corte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rendición por empleado ───────────────────────────────────────

type RendicionRow = {
  mozo_name: string;
  method: PaymentMethod;
  count: number;
  total_cents: number;
};

function buildRendicion(payments: CajaPayment[]): RendicionRow[] {
  const map = new Map<string, RendicionRow>();
  for (const p of payments) {
    const name = p.attributed_mozo_name ?? "Sin mozo";
    const key = `${name}|${p.method}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.total_cents += p.amount_cents;
    } else {
      map.set(key, { mozo_name: name, method: p.method, count: 1, total_cents: p.amount_cents });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.mozo_name === b.mozo_name ? a.method.localeCompare(b.method) : a.mozo_name.localeCompare(b.mozo_name),
  );
}

function RendicionSection({ payments }: { payments: CajaPayment[] }) {
  const rows = buildRendicion(payments);
  const mozos = Array.from(new Set(rows.map((r) => r.mozo_name)));

  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Rendición por empleado
      </p>
      <div className="mt-3 overflow-hidden rounded-lg ring-1 ring-zinc-200/70">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/60">
              <th className="px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">Mozo</th>
              <th className="px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">Método</th>
              <th className="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">Cant.</th>
              <th className="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {mozos.map((mozo) => {
              const mozoRows = rows.filter((r) => r.mozo_name === mozo);
              const mozoTotal = mozoRows.reduce((acc, r) => acc + r.total_cents, 0);
              return mozoRows.map((r, i) => (
                <tr key={`${mozo}-${r.method}`} className={i === mozoRows.length - 1 && mozo !== mozos[mozos.length - 1] ? "border-b-2 border-zinc-200" : ""}>
                  <td className="px-3 py-2 font-medium text-zinc-900">{i === 0 ? mozo : ""}</td>
                  <td className="px-3 py-2 text-zinc-600">{METHOD_LABEL[r.method]}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{r.count}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-zinc-900">
                    {formatCurrency(r.total_cents)}
                    {i === mozoRows.length - 1 && mozoRows.length > 1 && (
                      <span className="ml-1 text-xs text-zinc-500">({formatCurrency(mozoTotal)})</span>
                    )}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
