"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { corregirCobro, corregirMovimiento } from "@/lib/caja/correccion-actions";
import type { LibroEntry, PaymentMethod } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

const METODOS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card_manual", label: "Tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "other", label: "Otro" },
];

const SIN_MOZO = "__sin_mozo__";

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function inputToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  entry: LibroEntry;
  cajas: { id: string; name: string }[];
  mozos: { id: string; name: string }[];
  onDone: () => void;
};

/**
 * Corregir una línea de caja (spec 070). Confirmación explícita y no
 * optimista: es plata, así que el botón se bloquea hasta que el server
 * confirma — la frontera de la spec 021.
 */
export function CorregirCobroModal({
  open,
  onOpenChange,
  slug,
  entry,
  cajas,
  mozos,
  onDone,
}: Props) {
  const esCobro = entry.tipo === "cobro";

  const [method, setMethod] = useState<PaymentMethod | null>(entry.method);
  const [amount, setAmount] = useState(centsToInput(entry.amount_cents));
  const [tip, setTip] = useState(centsToInput(entry.tip_cents));
  const [mozoId, setMozoId] = useState(entry.attributed_mozo_id ?? SIN_MOZO);
  const [cajaId, setCajaId] = useState(entry.caja_id);
  const [notes, setNotes] = useState("");
  const [motivo, setMotivo] = useState("");
  const [anular, setAnular] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setMethod(entry.method);
    setAmount(centsToInput(entry.amount_cents));
    setTip(centsToInput(entry.tip_cents));
    setMozoId(entry.attributed_mozo_id ?? SIN_MOZO);
    setCajaId(entry.caja_id);
    setNotes("");
    setMotivo("");
    setAnular(false);
  }, [open, entry]);

  const nuevoMonto = inputToCents(amount);
  const nuevaPropina = inputToCents(tip);
  const facturada = entry.advertencias.some((a) => a.includes("factura"));
  const mozoBloqueado = entry.advertencias.some((a) => a.includes("rindió"));

  const cambios: string[] = [];
  if (esCobro) {
    if (method !== entry.method) cambios.push("método");
    if (nuevoMonto !== entry.amount_cents) cambios.push("monto");
    if (nuevaPropina !== entry.tip_cents) cambios.push("propina");
    if ((mozoId === SIN_MOZO ? null : mozoId) !== entry.attributed_mozo_id) {
      cambios.push("mozo");
    }
    if (cajaId !== entry.caja_id) cambios.push("caja");
    if (notes.trim() !== "") cambios.push("nota");
  } else {
    if (anular) cambios.push("anulación");
    else if (nuevoMonto !== entry.amount_cents) cambios.push("monto");
  }

  const montoValido = nuevoMonto > 0 && nuevaPropina >= 0 && nuevaPropina <= nuevoMonto;
  const puedeConfirmar =
    !pending && motivo.trim() !== "" && cambios.length > 0 && montoValido;

  function confirmar() {
    startTransition(async () => {
      const r = esCobro
        ? await corregirCobro({
            paymentId: entry.id,
            slug,
            motivo: motivo.trim(),
            ...(method !== entry.method && method ? { method } : {}),
            ...(nuevoMonto !== entry.amount_cents ? { amount_cents: nuevoMonto } : {}),
            ...(nuevaPropina !== entry.tip_cents ? { tip_cents: nuevaPropina } : {}),
            ...((mozoId === SIN_MOZO ? null : mozoId) !== entry.attributed_mozo_id
              ? { attributed_mozo_id: mozoId === SIN_MOZO ? null : mozoId }
              : {}),
            ...(cajaId !== entry.caja_id ? { caja_id: cajaId } : {}),
            ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
          })
        : await corregirMovimiento({
            movimientoId: entry.id,
            slug,
            motivo: motivo.trim(),
            ...(anular ? { anular: true } : { amount_cents: nuevoMonto }),
          });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(anular ? "Movimiento anulado" : "Línea corregida");
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? null : onOpenChange(o))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto text-base sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {esCobro ? "Corregir cobro" : "Corregir movimiento"}
            <span className="ml-2 text-base font-normal text-zinc-500">
              · {entry.descripcion}
            </span>
          </DialogTitle>
        </DialogHeader>

        {entry.advertencias.length > 0 && (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            {entry.advertencias.map((a) => (
              <p key={a} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{a}</span>
              </p>
            ))}
          </div>
        )}

        <div className="grid gap-4">
          {esCobro && (
            <div className="grid gap-1.5">
              <Label className="text-sm">Método</Label>
              <Select
                value={method ?? undefined}
                onValueChange={(v) => setMethod(v as PaymentMethod)}
              >
                <SelectTrigger className="h-11 w-full text-base">
                  {/* `SelectValue` sin render function imprime el VALOR, que
                      acá es un id: el trigger mostraba el uuid del mozo y de
                      la caja. La etiqueta se resuelve a mano. */}
                  <SelectValue placeholder="Elegí un método">
                    {(value) =>
                      METODOS.find((m) => m.value === value)?.label ??
                      "Elegí un método"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {METODOS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!esCobro && (
            <label className="flex items-center gap-3 rounded-xl bg-zinc-50 p-4 text-base ring-1 ring-zinc-200">
              <input
                type="checkbox"
                checked={anular}
                onChange={(e) => setAnular(e.target.checked)}
                className="size-5"
              />
              <span>
                Anular el movimiento — deja de contar para el arqueo, pero sigue
                visible acá.
              </span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-sm">Monto{facturada && esCobro ? " (facturado)" : ""}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-zinc-400">
                  $
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  disabled={anular || (esCobro && facturada)}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-12 pl-8 text-lg font-semibold tabular-nums"
                />
              </div>
            </div>
            {esCobro && (
              <div className="grid gap-1.5">
                <Label className="text-sm">De propina</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-zinc-400">
                    $
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={tip}
                    disabled={facturada}
                    onChange={(e) => setTip(e.target.value)}
                    className="h-12 pl-8 text-lg font-semibold tabular-nums"
                  />
                </div>
              </div>
            )}
          </div>

          {esCobro && (
            <p className="-mt-2 text-sm text-zinc-500">
              La propina viaja dentro del monto: {formatCurrency(entry.amount_cents)}{" "}
              incluye {formatCurrency(entry.tip_cents)} de propina.
            </p>
          )}

          {esCobro && (
            <>
              <div className="grid gap-1.5">
                <Label className="text-sm">Mozo atribuido</Label>
                <Select
                  value={mozoId}
                  onValueChange={(v) => setMozoId(v ?? SIN_MOZO)}
                  disabled={mozoBloqueado}
                >
                  <SelectTrigger className="h-11 w-full text-base">
                    <SelectValue placeholder="Sin mozo">
                      {(value) =>
                        !value || value === SIN_MOZO
                          ? "Sin mozo"
                          : (mozos.find((m) => m.id === value)?.name ?? "Sin mozo")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_MOZO}>Sin mozo</SelectItem>
                    {mozos.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {cajas.length > 1 && (
                <div className="grid gap-1.5">
                  <Label className="text-sm">Caja</Label>
                  <Select
                    value={cajaId}
                    onValueChange={(v) => setCajaId(v ?? cajaId)}
                  >
                    <SelectTrigger className="h-11 w-full text-base">
                      <SelectValue>
                        {(value) =>
                          cajas.find((c) => c.id === value)?.name ?? "Caja"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {cajas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(method === "transfer" || method === "other") && (
                <div className="grid gap-1.5">
                  <Label className="text-sm">
                    {method === "transfer" ? "Alias / referencia" : "Nota"}
                    <span className="ml-1 text-rose-600">*</span>
                  </Label>
                  <Input
                    className="h-11 text-base"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={method === "transfer" ? "alias.mp" : "Detalle"}
                  />
                </div>
              )}
            </>
          )}

          <div className="grid gap-1.5">
            <Label className="text-sm">
              Motivo<span className="ml-1 text-rose-600">*</span>
            </Label>
            <Textarea
              className="text-base"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Ej: lo pagó con débito, no en efectivo"
            />
          </div>

          {esCobro && nuevoMonto !== entry.amount_cents && (
            <p className="text-sm text-zinc-600">
              El recargo o descuento por método registrado en el cobro{" "}
              <strong>no se recalcula</strong>: se corrige cuánto entró, no cómo
              se compuso el precio.
            </p>
          )}
          {!montoValido && (
            <p className="text-sm font-medium text-rose-600">
              El monto tiene que ser mayor a cero y la propina no puede superarlo.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            className="h-11 px-5 text-base"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            className="h-11 px-5 text-base"
            disabled={!puedeConfirmar}
            onClick={confirmar}
          >
            {pending
              ? "Corrigiendo…"
              : cambios.length > 0
                ? `Corregir ${cambios.join(" + ")}`
                : "Corregir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
