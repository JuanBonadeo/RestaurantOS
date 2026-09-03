"use client";

import { useState, useTransition } from "react";
import { FileText, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CONDICION_IVA_LABEL,
  condicionesValidasPara,
} from "@/lib/afip/condicion-iva";
import { formatCuit } from "@/lib/afip/cuit";
import { actualizarEntidadFiscal } from "@/lib/afip/fiscal-entities-actions";
import type { FiscalEntity } from "@/lib/afip/fiscal-entities";
import {
  formatInvoiceNumber,
  INVOICE_STATUS_META,
  tipoLabel,
} from "@/lib/afip/format";
import type { CondicionIvaReceptor, Invoice } from "@/lib/afip/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

// ============================================================================
// Detalle de una entidad fiscal (spec 150): sus datos y sus comprobantes.
//
// Ésta es la pantalla donde SÍ se pisan datos fiscales. El cobro nunca lo hace
// (D4): un CUIT ya cargado que difiere de lo tipeado es más probable que sea un
// error del apuro que un dato nuevo. Corregirlo es un acto deliberado, y pasa
// por acá.
// ============================================================================

/** Las cuatro condiciones del catálogo ARCA: la entidad puede ser un receptor
 *  de B (Exento / Consumidor Final), no sólo de A. */
const CONDICIONES: CondicionIvaReceptor[] = [
  ...condicionesValidasPara("factura_a"),
  ...condicionesValidasPara("factura_b").filter(
    (c) => !condicionesValidasPara("factura_a").includes(c),
  ),
];

export function EntidadFiscalDetalle({
  slug,
  entidad,
  invoices,
  count,
}: {
  slug: string;
  entidad: FiscalEntity;
  invoices: Invoice[];
  count: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cuit, setCuit] = useState(formatCuit(entidad.cuit));
  const [razonSocial, setRazonSocial] = useState(entidad.razon_social);
  const [condicionIva, setCondicionIva] = useState<CondicionIvaReceptor>(
    entidad.condicion_iva,
  );
  const [domicilio, setDomicilio] = useState(entidad.domicilio ?? "");
  const [localidad, setLocalidad] = useState(entidad.localidad ?? "");
  const [provincia, setProvincia] = useState(entidad.provincia ?? "");
  const [codPostal, setCodPostal] = useState(entidad.cod_postal ?? "");
  const [email, setEmail] = useState(entidad.email ?? "");
  const [phone, setPhone] = useState(entidad.phone ?? "");

  const guardar = () => {
    startTransition(async () => {
      const r = await actualizarEntidadFiscal({
        slug,
        id: entidad.id,
        cuit,
        razonSocial,
        condicionIva,
        domicilio,
        localidad,
        provincia,
        codPostal,
        email,
        phone,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Entidad actualizada.");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">CUIT</Label>
            <Input
              value={cuit}
              onChange={(e) => setCuit(e.target.value.replace(/[^\d\-]/g, ""))}
              placeholder="30-50023730-5"
              maxLength={13}
              inputMode="numeric"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">Razón social</Label>
            <Input
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-1">
          <Label className="text-xs text-zinc-600">Condición de IVA</Label>
          <div className="flex flex-wrap gap-2">
            {CONDICIONES.map((cond) => (
              <button
                key={cond}
                type="button"
                onClick={() => setCondicionIva(cond)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition ring-1",
                  condicionIva === cond
                    ? "bg-zinc-900 text-white ring-zinc-900"
                    : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
                )}
              >
                {CONDICION_IVA_LABEL[cond]}
              </button>
            ))}
          </div>
        </div>

        {/* Todo lo de abajo es opcional a propósito: de los 410 receptores con
            CUIT del backup de Golf, 390 no tienen teléfono y 3 tienen e-mail.
            Pedirlos dejaría afuera al 95 % de los casos reales. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">Domicilio (opcional)</Label>
            <Input value={domicilio} onChange={(e) => setDomicilio(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">Localidad (opcional)</Label>
            <Input value={localidad} onChange={(e) => setLocalidad(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">Provincia (opcional)</Label>
            <Input value={provincia} onChange={(e) => setProvincia(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">Código postal (opcional)</Label>
            <Input value={codPostal} onChange={(e) => setCodPostal(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">E-mail (opcional)</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-zinc-600">Teléfono (opcional)</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={guardar}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Guardar cambios
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-900">
            Comprobantes emitidos
          </h2>
          <span className="text-xs text-zinc-500">
            {count} {count === 1 ? "comprobante" : "comprobantes"}
          </span>
        </header>

        {invoices.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <FileText className="mx-auto size-7 text-zinc-300" />
            <p className="mt-3 text-sm text-zinc-500">
              Todavía no se le emitió ningún comprobante desde el sistema.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {invoices.map((inv) => {
              const meta = INVOICE_STATUS_META[inv.status];
              return (
                <li
                  key={inv.id}
                  className="flex items-center gap-3 px-5 py-3 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-zinc-900">
                      {tipoLabel(inv.tipo_comprobante)}{" "}
                      <span className="font-normal text-zinc-500">
                        {formatInvoiceNumber(inv.punto_venta, inv.numero)}
                      </span>
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {new Date(inv.created_at).toLocaleDateString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                      })}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-zinc-900">
                    {formatCurrency(inv.total_cents)}
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ring-1",
                      meta.bg,
                      meta.color,
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", meta.dotClass)} />
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
