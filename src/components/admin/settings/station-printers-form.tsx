"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TestPrintButton } from "@/components/admin/settings/test-print-button";
import { setStationPrinter } from "@/lib/catalog/station-actions";

export type StationPrinterRow = {
  id: string;
  name: string;
  is_active: boolean;
  printer_ip: string | null;
  printer_port: number;
  printer_enabled: boolean;
};

export function StationPrintersForm({
  slug,
  stations,
}: {
  slug: string;
  stations: StationPrinterRow[];
}) {
  if (stations.length === 0) {
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200/60">
        Todavía no hay sectores. Creá los sectores (cocina, parrilla, bar…) desde
        el catálogo para poder asignarles una comandera.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200/60">
      {stations.map((s) => (
        <StationPrinterRowItem key={s.id} slug={slug} station={s} />
      ))}
    </ul>
  );
}

function StationPrinterRowItem({
  slug,
  station,
}: {
  slug: string;
  station: StationPrinterRow;
}) {
  const router = useRouter();
  const [ip, setIp] = useState(station.printer_ip ?? "");
  const [port, setPort] = useState(String(station.printer_port ?? 9100));
  const [enabled, setEnabled] = useState(station.printer_enabled);
  const [saving, startSave] = useTransition();

  const dirty =
    ip !== (station.printer_ip ?? "") ||
    port !== String(station.printer_port ?? 9100) ||
    enabled !== station.printer_enabled;

  const handleSave = () => {
    const portNum = port.trim() === "" ? undefined : Number(port);
    startSave(async () => {
      const r = await setStationPrinter(slug, station.id, {
        printer_ip: ip,
        printer_port: portNum,
        printer_enabled: enabled,
      });
      if (r.ok) {
        toast.success(`Comandera de ${station.name} guardada.`);
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
          {station.name}
        </p>
        {!station.is_active ? (
          <p className="text-xs text-zinc-400">Sector inactivo</p>
        ) : (
          <p className="text-xs text-zinc-500">
            {ip.trim() === "" ? "Sin impresora" : "Imprime acá"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
        <Input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="192.168.10.50"
          aria-label={`IP de la comandera de ${station.name}`}
        />
        <Input
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="9100"
          inputMode="numeric"
          aria-label={`Puerto de la comandera de ${station.name}`}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="size-4"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={`Comandera de ${station.name} activa`}
        />
        Activa
      </label>

      <div className="flex items-center gap-2">
        <TestPrintButton
          slug={slug}
          label={station.name}
          ip={ip}
          port={port}
        />
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </li>
  );
}
