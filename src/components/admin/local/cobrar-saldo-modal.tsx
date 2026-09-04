"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { registrarCobranza } from "@/lib/caja/cuenta-corriente-actions";
import type { DeudorRow } from "@/lib/caja/cuenta-corriente-queries";
import type { Caja } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

const METODOS = [
  { value: "cash", label: "Efectivo" },
  { value: "transfer", label: "Transferencia" },
  { value: "card_manual", label: "Tarjeta" },
  { value: "other", label: "Otro" },
] as const;

/**
 * Cobrar el saldo de una cuenta corriente — spec 141 · US4.
 *
 * El monto arranca en el saldo entero, que es el caso normal: el socio viene a
 * saldar. Se puede bajar para un pago parcial, y el server no acepta más de lo
 * que se debe.
 */
export function CobrarSaldoModal({
  slug,
  cajas,
  deudor,
  onClose,
}: {
  slug: string;
  cajas: Caja[];
  deudor: DeudorRow;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [monto, setMonto] = useState(String(deudor.saldo_cents / 100));
  const [metodo, setMetodo] =
    useState<(typeof METODOS)[number]["value"]>("cash");
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? "");
  const [notas, setNotas] = useState("");

  const cents = Math.round(Number(monto.replace(",", ".")) * 100);
  const invalido =
    !Number.isFinite(cents) ||
    cents <= 0 ||
    cents > deudor.saldo_cents ||
    // El efectivo entra al cajón, así que hay que decir a cuál (D5).
    (metodo === "cash" && !cajaId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pago de {deudor.name ?? deudor.phone}</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
          <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Debe
          </p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">
            {formatCurrency(deudor.saldo_cents)}
          </p>
        </div>

        <div className="mt-4 grid gap-1.5">
          <Label htmlFor="cobranza-monto">Cuánto paga</Label>
          <Input
            id="cobranza-monto"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="text-base tabular-nums"
            autoFocus
          />
        </div>

        <div className="mt-3 grid gap-1.5">
          <Label>Cómo paga</Label>
          <div className="flex flex-wrap gap-1.5">
            {METODOS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMetodo(m.value)}
                className={
                  metodo === m.value
                    ? "rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white"
                    : "rounded-full bg-white px-3 py-1.5 text-sm text-zinc-700 ring-1 ring-zinc-200"
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sólo el efectivo pide caja: lo demás no toca el cajón, y preguntarlo
            sugeriría que el arqueo lo va a esperar. */}
        {metodo === "cash" && cajas.length > 0 && (
          <div className="mt-3 grid gap-1.5">
            <Label htmlFor="cobranza-caja">Entra en</Label>
            <select
              id="cobranza-caja"
              value={cajaId}
              onChange={(e) => setCajaId(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
            >
              {cajas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-3 grid gap-1.5">
          <Label htmlFor="cobranza-notas">Nota (opcional)</Label>
          <Input
            id="cobranza-notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej: pagó por transferencia el viernes"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={invalido || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await registrarCobranza({
                  customerId: deudor.customer_id,
                  amount_cents: cents,
                  method: metodo,
                  cajaId: metodo === "cash" ? cajaId : null,
                  notes: notas,
                  slug,
                });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(
                  r.data.saldo_cents > 0
                    ? `Pago registrado. Queda debiendo ${formatCurrency(r.data.saldo_cents)}`
                    : "Pago registrado. Cuenta saldada",
                );
                onClose();
              })
            }
          >
            {pending ? "Registrando…" : "Registrar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
