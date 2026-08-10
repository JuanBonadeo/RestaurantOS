"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Link2,
  MoreHorizontal,
  QrCode,
  RefreshCw,
  User,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
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
import { CajaAssignmentsPanel } from "@/components/admin/local/caja-assignments-tab";
import { registrarRendicionMozo } from "@/lib/caja/actions";
import type {
  Caja,
  CajaUserAssignment,
  MozoRendicion,
  PaymentMethod,
  RendicionMozoPendiente,
} from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import { useOnActivate } from "@/lib/ui/use-tab-param";
import { getRendicionTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";
import type { RendicionData } from "@/app/[business_slug]/admin/(authed)/operacion/data";
import { cn } from "@/lib/utils";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
};

type AssignmentWithNames = CajaUserAssignment & {
  user_name: string | null;
  caja_name: string;
};

type MemberOption = {
  user_id: string;
  full_name: string | null;
};

type Props = {
  slug: string;
  initialPendientes: RendicionMozoPendiente[];
  initialHistorial: (MozoRendicion & {
    mozo_name: string;
    registered_by_name: string | null;
  })[];
  cajas: Caja[];
  cajaAssignments: AssignmentWithNames[];
  members: MemberOption[];
  showAssignments: boolean;
  /** Spec 101: `false` mientras la tab está oculta (el panel sigue montado). */
  active?: boolean;
  /** `true` si el panel montó lazy (spec 103): entonces revalida al montar. */
  refetchAlMontar?: boolean;
  /** Spec 103: cada snapshot nuevo del refetch, para el badge de la tab. */
  onServerData?: (d: RendicionData) => void;
};

export function RendicionMozosTab({
  slug,
  initialPendientes,
  initialHistorial,
  cajas,
  cajaAssignments: initialAssignments,
  members,
  showAssignments,
  active = true,
  refetchAlMontar = false,
  onServerData,
}: Props) {
  const [rendirMozo, setRendirMozo] = useState<RendicionMozoPendiente | null>(
    null,
  );

  // Snapshot del server de la tab, seedeado de los props y actualizado sólo por
  // el refetch (spec 103). Se reemplaza **entero**: es plata, y sumar en el
  // cliente es como se duplica una rendición.
  const [serverData, setServerData] = useState({
    pendientes: initialPendientes,
    historial: initialHistorial,
    assignments: initialAssignments,
  });
  const { pendientes, historial, assignments } = serverData;

  const refetchSeq = useRef(0);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  const refetchRendicion = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getRendicionTabData(slug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) {
        setServerData({
          pendientes: res.data.rendicionPendientes,
          historial: res.data.rendicionHistorial,
          assignments: res.data.cajaAssignments,
        });
        onServerDataRef.current?.(res.data);
      }
    } catch {
      // swallow: refresh de fondo, mantiene lo que hay (nunca vacía la tabla).
    }
  }, [slug]);

  // Volver a la tab revalida: es plata y el snapshot del page-load puede ser de
  // hace horas. Reemplaza al puente `router.refresh()` de la spec 101.
  useOnActivate(active, refetchRendicion, { onMount: refetchAlMontar });

  const conPagos = pendientes.filter((p) => p.pagos_count > 0);
  const sinPagos = pendientes.filter((p) => p.pagos_count === 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Rendición de mozos · pendientes del turno
        </p>
        <button
          type="button"
          onClick={() => void refetchRendicion()}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Refrescar"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {conPagos.length === 0 && sinPagos.length === 0 && (
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-zinc-100">
              <User className="size-7 text-zinc-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-zinc-900">
                Sin mozos activos
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                No hay mozos/encargados con pagos pendientes de rendir.
              </p>
            </div>
          </div>
        </Surface>
      )}

      {conPagos.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {conPagos.map((p) => (
            <MozoPendienteCard
              key={p.mozo_id}
              pendiente={p}
              onRendir={() => setRendirMozo(p)}
            />
          ))}
        </div>
      )}

      {sinPagos.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">
            Sin cobros en este turno
          </p>
          <div className="flex flex-wrap gap-2">
            {sinPagos.map((p) => (
              <span
                key={p.mozo_id}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm text-zinc-500 ring-1 ring-zinc-200/70"
              >
                <User className="size-3.5" />
                {p.mozo_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <div>
          <p className="mb-3 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Últimas rendiciones
          </p>
          <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200/70">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60">
                  <th className="px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Mozo
                  </th>
                  <th className="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Esperado
                  </th>
                  <th className="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Entregado
                  </th>
                  <th className="px-3 py-2 text-right text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Dif.
                  </th>
                  <th className="px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Registrado por
                  </th>
                  <th className="px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Hora
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {historial.map((r) => {
                  const diff = r.difference_cents;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-zinc-900">
                        {r.mozo_name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                        {formatCurrency(r.expected_cash_cents)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                        {formatCurrency(r.delivered_cash_cents)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-semibold tabular-nums",
                          diff === 0
                            ? "text-emerald-700"
                            : diff < 0
                              ? "text-rose-700"
                              : "text-amber-700",
                        )}
                      >
                        {diff === 0
                          ? "OK"
                          : `${diff > 0 ? "+" : ""}${formatCurrency(diff)}`}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">
                        {r.registered_by_name ?? "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-zinc-500">
                        {new Date(r.created_at).toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAssignments && (
        <CajaAssignmentsPanel
          slug={slug}
          cajas={cajas}
          assignments={assignments}
          onChanged={() => void refetchRendicion()}
          members={members}
        />
      )}

      {rendirMozo && (
        <RendirModal
          open
          onOpenChange={(o) => !o && setRendirMozo(null)}
          pendiente={rendirMozo}
          slug={slug}
          onSuccess={() => {
            setRendirMozo(null);
            void refetchRendicion();
          }}
        />
      )}
    </div>
  );
}

function MozoPendienteCard({
  pendiente,
  onRendir,
}: {
  pendiente: RendicionMozoPendiente;
  onRendir: () => void;
}) {
  const p = pendiente;
  const metodos = (
    Object.entries(p.por_metodo) as [PaymentMethod, number][]
  ).filter(([, v]) => v > 0);

  return (
    <article className="flex flex-col rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <header className="flex items-start justify-between gap-3 border-b border-zinc-100 p-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-zinc-900">
            {p.mozo_name}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {p.pagos_count} cobro{p.pagos_count !== 1 ? "s" : ""} en el turno
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-800">
          Pendiente
        </span>
      </header>

      <div className="border-b border-zinc-100 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Efectivo a entregar
          </p>
          <p className="text-xl font-bold tabular-nums text-zinc-900">
            {formatCurrency(p.efectivo_cents)}
          </p>
        </div>
        {p.tickets_cents > 0 && (
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="text-xs text-zinc-500">Tickets (tarj./transf.)</p>
            <p className="text-sm font-semibold tabular-nums text-zinc-600">
              {formatCurrency(p.tickets_cents)}
            </p>
          </div>
        )}
        {p.total_propinas_cents > 0 && (
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="text-xs text-zinc-500">Propinas (aparte)</p>
            <p className="text-sm tabular-nums text-emerald-700">
              {formatCurrency(p.total_propinas_cents)}
            </p>
          </div>
        )}
      </div>

      {metodos.length > 0 && (
        <div className="border-b border-zinc-100 p-4">
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Detalle por método
          </p>
          <ul className="space-y-1">
            {metodos.map(([method, amount]) => (
              <li
                key={method}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="inline-flex items-center gap-2 text-zinc-600">
                  <MethodIcon method={method} />
                  {METHOD_LABEL[method]}
                </span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {formatCurrency(amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="p-3">
        <Button
          className="w-full"
          onClick={onRendir}
        >
          <CheckCircle2 className="mr-2 size-4" />
          Registrar rendición
        </Button>
      </div>
    </article>
  );
}

function MethodIcon({ method }: { method: PaymentMethod }) {
  const cls = "size-3.5";
  switch (method) {
    case "cash":
      return <Banknote className={cls} />;
    case "mp_qr":
      return <QrCode className={cls} />;
    case "mp_link":
      return <Link2 className={cls} />;
    case "card_manual":
      return <CreditCard className={cls} />;
    case "transfer":
      return <Wallet className={cls} />;
    default:
      return <MoreHorizontal className={cls} />;
  }
}

function RendirModal({
  open,
  onOpenChange,
  pendiente,
  slug,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pendiente: RendicionMozoPendiente;
  slug: string;
  onSuccess: () => void;
}) {
  const [, startTransition] = useTransition();
  const [delivered, setDelivered] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) {
      setDelivered("");
      setNotes("");
    }
  }, [open]);

  const cents =
    delivered === ""
      ? null
      : Math.max(0, Math.round(Number(delivered) * 100));
  const diff = cents === null ? 0 : cents - pendiente.efectivo_cents;
  const requiresNotes = cents !== null && diff !== 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Rendición de {pendiente.mozo_name}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Efectivo que debería entregar
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">
            {formatCurrency(pendiente.efectivo_cents)}
          </p>
          {pendiente.tickets_cents > 0 && (
            <p className="mt-1 text-xs text-zinc-600">
              + {formatCurrency(pendiente.tickets_cents)} en tickets
              (tarjeta/transferencia)
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-1.5">
          <Label className="text-sm font-medium">
            Efectivo que entrega
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-zinc-400">
              $
            </span>
            <Input
              type="number"
              value={delivered}
              onChange={(e) => setDelivered(e.target.value)}
              placeholder="0"
              autoFocus
              inputMode="decimal"
              className="pl-7 text-base tabular-nums"
            />
          </div>
        </div>

        {cents !== null && diff !== 0 && (
          <div
            className={cn(
              "mt-4 flex items-center justify-between rounded-lg p-3 ring-1",
              diff < 0
                ? "bg-rose-50 ring-rose-200 text-rose-900"
                : "bg-amber-50 ring-amber-200 text-amber-900",
            )}
          >
            <span className="text-sm font-semibold">
              {diff < 0 ? "Falta" : "Sobra"}
            </span>
            <span className="text-lg font-bold tabular-nums">
              {diff > 0 ? "+" : "−"}
              {formatCurrency(Math.abs(diff))}
            </span>
          </div>
        )}

        {cents !== null && diff === 0 && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200 text-emerald-900">
            <span className="text-sm font-semibold">Cuadra perfecto</span>
            <CheckCircle2 className="size-4" />
          </div>
        )}

        {requiresNotes && (
          <div className="mt-3 grid gap-1.5">
            <Label className="text-sm font-medium">
              ¿Qué pasó?
              <span className="ml-1 text-rose-600">*</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ej: le di cambio de más, billete falso…"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={
              cents === null || (requiresNotes && notes.trim() === "")
            }
            onClick={() =>
              cents !== null &&
              startTransition(async () => {
                const r = await registrarRendicionMozo(
                  pendiente.mozo_id,
                  cents,
                  notes.trim() || null,
                  slug,
                );
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(
                  `Rendición de ${pendiente.mozo_name} registrada`,
                );
                onSuccess();
              })
            }
          >
            <CheckCircle2 className="mr-2 size-4" />
            Registrar rendición
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
