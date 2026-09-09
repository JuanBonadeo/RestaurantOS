"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TestPrintButton } from "@/components/admin/settings/test-print-button";
import { setControlPrinter } from "@/lib/catalog/station-actions";

export type ControlPrinterRow = {
  control_printer_ip: string | null;
  control_printer_port: number;
  control_printer_enabled: boolean;
};

/**
 * Comandera de control (spec 063). Misma forma que una fila de
 * `StationPrintersForm` — es lo que el encargado ya sabe usar — pero apunta al
 * negocio en vez de a un sector.
 */
export function ControlPrinterForm({
  slug,
  initial,
}: {
  slug: string;
  initial: ControlPrinterRow;
}) {
  const router = useRouter();
  const [ip, setIp] = useState(initial.control_printer_ip ?? "");
  const [port, setPort] = useState(String(initial.control_printer_port ?? 9100));
  const [enabled, setEnabled] = useState(initial.control_printer_enabled);
  const [saving, startSave] = useTransition();

  const dirty =
    ip !== (initial.control_printer_ip ?? "") ||
    port !== String(initial.control_printer_port ?? 9100) ||
    enabled !== initial.control_printer_enabled;

  const handleSave = () => {
    const portNum = port.trim() === "" ? undefined : Number(port);
    startSave(async () => {
      const r = await setControlPrinter(slug, {
        printer_ip: ip,
        printer_port: portNum,
        printer_enabled: enabled,
      });
      if (r.ok) {
        toast.success("Comandera de control guardada.");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="rounded-xl ring-1 ring-zinc-200/60">
      <div className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:grid-cols-[1fr_minmax(0,2fr)_auto_auto] sm:items-end">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">
            Control de pedido
          </p>
          <p className="text-xs text-zinc-500">
            {ip.trim() === ""
              ? "Sin comandera: no se imprimen controles"
              : enabled
                ? "Imprime acá"
                : "Configurada pero apagada"}
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
          <Input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="192.168.10.60"
            aria-label="IP de la comandera de control"
          />
          <Input
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="9100"
            inputMode="numeric"
            aria-label="Puerto de la comandera de control"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="size-4"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="Comandera de control activa"
          />
          Activa
        </label>

        <div className="flex items-center gap-2">
          <TestPrintButton
            slug={slug}
            label="Control de pedido"
            ip={ip}
            port={port}
          />
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
