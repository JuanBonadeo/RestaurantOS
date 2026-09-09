"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  estadoDePruebaDeComandera,
  imprimirPruebaDeComandera,
} from "@/lib/print/test-print-actions";

/**
 * «Probar» — spec 176. Manda un papel de prueba a la IP que está TIPEADA en la
 * fila, guardada o no: en la instalación del local la pregunta es «¿esta IP es
 * la de la parrilla?», y contestarla no debería obligar a guardar una config
 * que quizás está mal.
 *
 * Después de encolar, pollea el estado hasta que el agente confirma. Sin eso el
 * encargado no distingue «la comandera no imprime» de «el agente está caído», y
 * son dos problemas distintos.
 */
const POLL_MS = 1500;
/** Lo mismo que la ventana del endpoint: pasado eso, el papel ya no sale. */
const TIMEOUT_MS = 45_000;

export function TestPrintButton({
  slug,
  label,
  ip,
  port,
}: {
  slug: string;
  label: string;
  ip: string;
  port: string;
}) {
  const [probando, setProbando] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );

  const esperar = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.current.push(setTimeout(resolve, ms));
    });

  const handleTest = async () => {
    setProbando(true);
    const t = toast.loading(`Mandando prueba a ${label}…`);
    try {
      const r = await imprimirPruebaDeComandera(slug, {
        printer_ip: ip,
        printer_port: port.trim() === "" ? 9100 : Number(port),
        label,
      });
      if (!r.ok) {
        toast.error(r.error, { id: t });
        return;
      }

      toast.loading(
        `Prueba en camino a ${r.data.printer_ip}:${r.data.printer_port}…`,
        { id: t },
      );

      const hasta = Date.now() + TIMEOUT_MS;
      while (Date.now() < hasta) {
        await esperar(POLL_MS);
        const e = await estadoDePruebaDeComandera(slug, r.data.print_job_id);
        if (!e.ok) {
          toast.error(e.error, { id: t });
          return;
        }
        if (e.data.status === "impreso") {
          toast.success(`Salió el papel en ${label}.`, { id: t });
          return;
        }
        if (e.data.failed) {
          toast.error(
            `${label}: el agente no pudo imprimir${e.data.error ? ` — ${e.data.error}` : ""}.`,
            { id: t, duration: 12_000 },
          );
          return;
        }
      }
      // Nadie la levantó: el problema no es la impresora, es el agente.
      toast.error(
        `Nadie levantó la prueba de ${label}. Revisá que el print-agent de la PC del local esté corriendo.`,
        { id: t, duration: 12_000 },
      );
    } finally {
      setProbando(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleTest}
      disabled={probando || ip.trim() === ""}
      title={
        ip.trim() === ""
          ? "Cargá la IP para poder probar."
          : `Imprime un papel de prueba en ${ip}`
      }
    >
      {probando ? "Probando…" : "Probar"}
    </Button>
  );
}
