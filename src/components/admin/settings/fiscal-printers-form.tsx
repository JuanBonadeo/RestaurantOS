"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setCajaFiscalPrinter } from "@/lib/catalog/station-actions";

export type CajaFiscalPrinterRow = {
  id: string;
  name: string;
  is_default: boolean;
  fiscal_printer_ip: string | null;
  fiscal_printer_port: number;
  fiscal_printer_enabled: boolean;
};

/**
 * Comanderas fiscales (spec 084): una fila por caja. Sin fallback al negocio a
 * propósito — la factura tiene que salir donde está parado el que cobra.
 */
export function FiscalPrintersForm({
  slug,
  cajas,
}: {
  slug: string;
  cajas: CajaFiscalPrinterRow[];
}) {
  if (cajas.length === 0) {
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200/60">
        Todavía no hay cajas. Creá al menos una para poder asignarle una
        comandera fiscal.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200/60">
      {cajas.map((c) => (
        <CajaRow key={c.id} slug={slug} caja={c} />
      ))}
    </ul>
  );
}

function CajaRow({ slug, caja }: { slug: string; caja: CajaFiscalPrinterRow }) {
  const router = useRouter();
  const [ip, setIp] = useState(caja.fiscal_printer_ip ?? "");
  const [port, setPort] = useState(String(caja.fiscal_printer_port ?? 9100));
  const [enabled, setEnabled] = useState(caja.fiscal_printer_enabled);
  const [saving, startSave] = useTransition();

  const dirty =
    ip !== (caja.fiscal_printer_ip ?? "") ||
    port !== String(caja.fiscal_printer_port ?? 9100) ||
    enabled !== caja.fiscal_printer_enabled;

  const handleSave = () => {
    startSave(async () => {
      const r = await setCajaFiscalPrinter(slug, caja.id, {
        printer_ip: ip,
        printer_port: port.trim() === "" ? undefined : Number(port),
        printer_enabled: enabled,
      });
      if (r.ok) {
        toast.success(`Comandera fiscal de ${caja.name} guardada.`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <li className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:grid-cols-[1fr_minmax(0,2fr)_auto_auto] sm:items-end">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {caja.name}
          {caja.is_default && (
            <span className="ml-2 text-xs font-normal text-zinc-500">
              (por defecto)
            </span>
          )}
        </p>
        <p className="text-xs text-zinc-500">
          {ip.trim() === ""
            ? "Sin comandera: esta caja no imprime facturas"
            : enabled
              ? "Imprime acá"
              : "Configurada pero apagada"}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
        <Input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="192.168.10.80"
          aria-label={`IP de la comandera fiscal de ${caja.name}`}
        />
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="9100"
          inputMode="numeric"
          aria-label={`Puerto de la comandera fiscal de ${caja.name}`}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="size-4"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={`Comandera fiscal de ${caja.name} activa`}
        />
        Activa
      </label>

      <Button onClick={handleSave} disabled={saving || !dirty}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </li>
  );
}
