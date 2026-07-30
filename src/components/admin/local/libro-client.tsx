"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CreditCard,
  History,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  QrCode,
  Wallet,
} from "lucide-react";

import { CorregirCobroModal } from "@/components/admin/local/corregir-cobro-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  verCorrecciones,
  type CorreccionLogConNombres,
} from "@/lib/caja/correccion-actions";
import type { LibroEntry, LibroTotales, PaymentMethod } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
};

const CAMPO_LABEL: Record<string, string> = {
  method: "Método",
  amount_cents: "Monto",
  tip_cents: "Propina",
  attributed_mozo_id: "Mozo",
  caja_id: "Caja",
  last_four: "Últimos 4",
  card_brand: "Tarjeta",
  notes: "Nota",
  cancelled: "Estado",
};

function iconoDe(entry: LibroEntry) {
  if (entry.tipo === "sangria") return ArrowDownToLine;
  if (entry.tipo === "ingreso") return ArrowUpFromLine;
  switch (entry.method) {
    case "cash":
      return Banknote;
    case "mp_qr":
      return QrCode;
    case "mp_link":
      return Link2;
    case "card_manual":
      return CreditCard;
    case "transfer":
      return Wallet;
    default:
      return MoreHorizontal;
  }
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Traduce un renglón de auditoría a algo que se lea: los montos vienen en
 * centavos y los mozos/cajas como id (el log guarda el dato exacto).
 */
function valorLegible(
  campo: string,
  raw: string | null,
  label: string | null,
): string {
  if (raw === null) return "—";
  if (campo === "amount_cents" || campo === "tip_cents") {
    return formatCurrency(Number(raw));
  }
  if (campo === "method") return METHOD_LABEL[raw as PaymentMethod] ?? raw;
  if (campo === "attributed_mozo_id" || campo === "caja_id") return label ?? raw;
  return raw;
}

type FiltrosUI = {
  desde: string;
  hasta: string;
  caja: string;
  tipo: string;
  metodo: string;
  mozo: string;
  q: string;
};

type Props = {
  slug: string;
  cajas: { id: string; name: string }[];
  mozos: { id: string; name: string }[];
  entries: LibroEntry[];
  totales: LibroTotales;
  truncado: boolean;
  filtros: FiltrosUI;
  puedeCorregir: boolean;
};

export function LibroClient({
  slug,
  cajas,
  mozos,
  entries,
  totales,
  truncado,
  filtros,
  puedeCorregir,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [detalle, setDetalle] = useState<LibroEntry | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<LibroEntry | null>(null);

  function aplicar(patch: Partial<FiltrosUI>) {
    const next = { ...filtros, ...patch };
    const params = new URLSearchParams();
    if (next.desde) params.set("desde", next.desde);
    if (next.hasta && next.hasta !== next.desde) params.set("hasta", next.hasta);
    if (next.caja) params.set("caja", next.caja);
    if (next.tipo) params.set("tipo", next.tipo);
    if (next.metodo) params.set("metodo", next.metodo);
    if (next.mozo) params.set("mozo", next.mozo);
    if (next.q) params.set("q", next.q);
    startTransition(() => {
      router.push(`/${slug}/admin/operacion/movimientos?${params.toString()}`);
    });
  }

  const selectClass =
    "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-800";

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
        <div className="grid gap-1">
          <Label className="text-[11px] text-zinc-500">Desde</Label>
          <Input
            type="date"
            value={filtros.desde}
            className="h-9 w-[9.5rem]"
            onChange={(e) => aplicar({ desde: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-zinc-500">Hasta</Label>
          <Input
            type="date"
            value={filtros.hasta}
            className="h-9 w-[9.5rem]"
            onChange={(e) => aplicar({ hasta: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-zinc-500">Caja</Label>
          <select
            className={selectClass}
            value={filtros.caja}
            onChange={(e) => aplicar({ caja: e.target.value })}
          >
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-zinc-500">Tipo</Label>
          <select
            className={selectClass}
            value={filtros.tipo}
            onChange={(e) => aplicar({ tipo: e.target.value })}
          >
            <option value="">Todo</option>
            <option value="cobro">Cobros</option>
            <option value="sangria">Sangrías</option>
            <option value="ingreso">Ingresos</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-zinc-500">Método</Label>
          <select
            className={selectClass}
            value={filtros.metodo}
            onChange={(e) => aplicar({ metodo: e.target.value })}
          >
            <option value="">Todos</option>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-zinc-500">Mozo</Label>
          <select
            className={selectClass}
            value={filtros.mozo}
            onChange={(e) => aplicar({ mozo: e.target.value })}
          >
            <option value="">Todos</option>
            {mozos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid flex-1 gap-1">
          <Label className="text-[11px] text-zinc-500">Buscar</Label>
          <Input
            defaultValue={filtros.q}
            placeholder="Mesa, cliente o # de orden"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                aplicar({ q: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Totalizador
          label="Cobrado"
          value={formatCurrency(totales.cobrado_cents)}
          hint={`${totales.cobros_count} ${totales.cobros_count === 1 ? "cobro" : "cobros"}`}
        />
        <Totalizador
          label="Propinas"
          value={formatCurrency(totales.propinas_cents)}
          hint="dentro de lo cobrado"
        />
        <Totalizador
          label="Ingresos"
          value={formatCurrency(totales.ingresos_cents)}
          hint="a la caja"
        />
        <Totalizador
          label="Sangrías"
          value={formatCurrency(totales.sangrias_cents)}
          hint="fuera de la caja"
        />
      </div>

      {truncado && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          El rango tiene más movimientos de los que entran en una pantalla: se
          muestran los más recientes. Acotá las fechas para verlos todos.
        </p>
      )}

      {/* Lista */}
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
        {entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            No hubo movimientos en este período.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {entries.map((e) => {
              const Icon = iconoDe(e);
              const esSangria = e.tipo === "sangria";
              return (
                <li key={`${e.tipo}-${e.id}`}>
                  <button
                    type="button"
                    onClick={() => setDetalle(e)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                        e.anulado
                          ? "bg-zinc-100 text-zinc-400"
                          : esSangria
                            ? "bg-rose-50 text-rose-700"
                            : e.tipo === "ingreso"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-700",
                      )}
                    >
                      <Icon className="size-4" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-sm font-semibold text-zinc-900",
                            e.anulado && "text-zinc-400 line-through",
                          )}
                        >
                          {e.descripcion}
                          <span className="ml-1.5 text-[10px] font-normal tabular-nums text-zinc-400">
                            {fecha(e.created_at)} {hora(e.created_at)}
                          </span>
                        </p>
                        <p
                          className={cn(
                            "shrink-0 text-sm font-bold tabular-nums",
                            e.anulado
                              ? "text-zinc-400 line-through"
                              : esSangria
                                ? "text-rose-700"
                                : "text-zinc-900",
                          )}
                        >
                          {esSangria ? "−" : "+"}
                          {formatCurrency(e.amount_cents)}
                        </p>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-xs text-zinc-500">
                          {e.tipo === "cobro" && e.method
                            ? METHOD_LABEL[e.method]
                            : esSangria
                              ? "Sangría"
                              : "Ingreso"}
                          <span className="mx-1 text-zinc-300">·</span>
                          {e.caja_name}
                          {e.attributed_mozo_name && (
                            <>
                              <span className="mx-1 text-zinc-300">·</span>
                              {e.attributed_mozo_name}
                            </>
                          )}
                        </p>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {e.tip_cents > 0 && !e.anulado && (
                            <span className="text-[11px] tabular-nums text-emerald-700">
                              +{formatCurrency(e.tip_cents)} propina
                            </span>
                          )}
                          {e.corregido && (
                            <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                              corregido
                            </span>
                          )}
                          {e.anulado && (
                            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                              anulado
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DetalleSheet
        entry={detalle}
        slug={slug}
        puedeCorregir={puedeCorregir}
        onClose={() => setDetalle(null)}
        onCorregir={(e) => {
          setDetalle(null);
          setCorrigiendo(e);
        }}
      />

      {corrigiendo && (
        <CorregirCobroModal
          open
          onOpenChange={(o) => !o && setCorrigiendo(null)}
          slug={slug}
          entry={corrigiendo}
          cajas={cajas}
          mozos={mozos}
          onDone={() => {
            setCorrigiendo(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Totalizador({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-zinc-900">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

function DetalleSheet({
  entry,
  slug,
  puedeCorregir,
  onClose,
  onCorregir,
}: {
  entry: LibroEntry | null;
  slug: string;
  puedeCorregir: boolean;
  onClose: () => void;
  onCorregir: (entry: LibroEntry) => void;
}) {
  const [logs, setLogs] = useState<CorreccionLogConNombres[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!entry || !entry.corregido) {
      setLogs([]);
      return;
    }
    let vivo = true;
    setCargando(true);
    verCorrecciones(
      slug,
      entry.tipo === "cobro" ? "payment" : "movimiento",
      entry.id,
    ).then((r) => {
      if (!vivo) return;
      setLogs(r.ok ? r.data : []);
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [entry, slug]);

  if (!entry) return null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{entry.descripcion}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
            <p className="text-3xl font-bold tabular-nums text-zinc-900">
              {formatCurrency(entry.amount_cents)}
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              {entry.tipo === "cobro" && entry.method
                ? METHOD_LABEL[entry.method]
                : entry.tipo === "sangria"
                  ? "Sangría"
                  : "Ingreso"}
              <span className="mx-1 text-zinc-300">·</span>
              {entry.caja_name}
              <span className="mx-1 text-zinc-300">·</span>
              {fecha(entry.created_at)} {hora(entry.created_at)}
            </p>
            {entry.tip_cents > 0 && (
              <p className="mt-1 text-xs text-emerald-700">
                Incluye {formatCurrency(entry.tip_cents)} de propina
              </p>
            )}
            {entry.attributed_mozo_name && (
              <p className="mt-1 text-xs text-zinc-600">
                Atribuido a {entry.attributed_mozo_name}
              </p>
            )}
          </div>

          {entry.anulado && (
            <div className="rounded-xl bg-zinc-100 p-3 text-xs text-zinc-700">
              <p className="font-semibold">Anulado</p>
              {entry.anulado_reason && <p className="mt-0.5">{entry.anulado_reason}</p>}
            </div>
          )}

          {/* Por qué no se puede corregir: decirlo es parte del trabajo — un
              botón escondido no explica nada. */}
          {entry.bloqueo && (
            <p className="flex items-start gap-2 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-600 ring-1 ring-zinc-200">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>
                No se puede corregir: {entry.bloqueo}{" "}
                {entry.bloqueo.includes("arqueo")
                  ? "Registrá la corrección en el período vigente."
                  : ""}
              </span>
            </p>
          )}
          {!entry.bloqueo &&
            entry.advertencias.map((a) => (
              <p
                key={a}
                className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200"
              >
                {a}
              </p>
            ))}

          {entry.corregido && (
            <div>
              <p className="flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                <History className="size-3.5" /> Historial
              </p>
              {cargando ? (
                <p className="mt-2 text-xs text-zinc-500">Cargando…</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {logs.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-xl bg-white p-3 text-xs ring-1 ring-zinc-200/70"
                    >
                      <p className="font-semibold text-zinc-800">
                        {CAMPO_LABEL[l.field] ?? l.field}:{" "}
                        {valorLegible(l.field, l.from_value, l.from_label)} →{" "}
                        {valorLegible(l.field, l.to_value, l.to_label)}
                      </p>
                      <p className="mt-0.5 text-zinc-600">{l.reason}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {l.by_name ?? "—"} · {fecha(l.created_at)} {hora(l.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {puedeCorregir && !entry.bloqueo && (
            <Button className="w-full" onClick={() => onCorregir(entry)}>
              <Pencil className="size-4" /> Corregir
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
