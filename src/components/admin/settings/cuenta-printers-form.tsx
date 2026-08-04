"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setCuentaPrinter,
  setFloorPlanCuentaPrinter,
} from "@/lib/catalog/station-actions";

export type CuentaPrinterConfig = {
  cuenta_printer_ip: string | null;
  cuenta_printer_port: number;
  cuenta_printer_enabled: boolean;
};

export type FloorPlanPrinterRow = CuentaPrinterConfig & {
  id: string;
  name: string;
};

/**
 * Comanderas de cuentas (spec 080): la del negocio (default) y una fila por
 * salón que puede pisarla. Misma forma que `StationPrintersForm` — es lo que el
 * encargado ya sabe usar.
 */
export function CuentaPrintersForm({
  slug,
  business,
  floorPlans,
}: {
  slug: string;
  business: CuentaPrinterConfig;
  floorPlans: FloorPlanPrinterRow[];
}) {
  const businessHasPrinter = Boolean(
    business.cuenta_printer_ip?.trim() && business.cuenta_printer_enabled,
  );
  return (
    <div className="grid gap-3">
      <PrinterRow
        title="Todo el local"
        hint={
          business.cuenta_printer_ip?.trim()
            ? "Se usa en los salones que no tengan la suya."
            : "Sin comandera: los salones sin la suya no imprimen cuentas."
        }
        initial={business}
        onSave={(v) => setCuentaPrinter(slug, v)}
      />

      {floorPlans.length > 1 && (
        <p className="text-xs text-zinc-500">
          Un salón con IP propia imprime ahí. Vacío hereda la del local;
          apagado no imprime, aunque el local tenga una.
        </p>
      )}

      {floorPlans.map((fp) => (
        <PrinterRow
          key={fp.id}
          title={fp.name}
          hint={
            !fp.cuenta_printer_enabled
              ? "Apagado: este salón no imprime cuentas."
              : fp.cuenta_printer_ip?.trim()
                ? "Comandera propia."
                : businessHasPrinter
                  ? "Hereda la del local."
                  : "Sin comandera (el local tampoco tiene)."
          }
          initial={fp}
          onSave={(v) => setFloorPlanCuentaPrinter(slug, fp.id, v)}
        />
      ))}
    </div>
  );
}

function PrinterRow({
  title,
  hint,
  initial,
  onSave,
}: {
  title: string;
  hint: string;
  initial: CuentaPrinterConfig;
  onSave: (v: {
    printer_ip: string;
    printer_port: number | undefined;
    printer_enabled: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [ip, setIp] = useState(initial.cuenta_printer_ip ?? "");
  const [port, setPort] = useState(String(initial.cuenta_printer_port ?? 9100));
  const [enabled, setEnabled] = useState(initial.cuenta_printer_enabled);
  const [saving, startSave] = useTransition();

  const dirty =
    ip !== (initial.cuenta_printer_ip ?? "") ||
    port !== String(initial.cuenta_printer_port ?? 9100) ||
    enabled !== initial.cuenta_printer_enabled;

  const handleSave = () => {
    startSave(async () => {
      const r = await onSave({
        printer_ip: ip,
        printer_port: port.trim() === "" ? undefined : Number(port),
        printer_enabled: enabled,
      });
      if (r.ok) {
        toast.success(`Comandera de ${title} guardada.`);
        router.refresh();
      } else {
        toast.error(r.error ?? "No pudimos guardar.");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl px-4 py-3.5 ring-1 ring-zinc-200/60 sm:grid-cols-[1fr_minmax(0,2fr)_auto_auto] sm:items-end">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-900">{title}</p>
        <p className="text-xs text-zinc-500">{hint}</p>
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
        <Input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="192.168.10.70"
          aria-label={`IP de la comandera de cuentas de ${title}`}
        />
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="9100"
          inputMode="numeric"
          aria-label={`Puerto de la comandera de cuentas de ${title}`}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="size-4"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={`Comandera de cuentas de ${title} activa`}
        />
        Activa
      </label>

      <Button onClick={handleSave} disabled={saving || !dirty}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
