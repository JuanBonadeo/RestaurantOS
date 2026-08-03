import type { FloorTable, OperationalStatus } from "@/lib/reservations/types";

/** Ventana en la que una reserva cuenta como "próxima" para subir la mesa. */
const DOS_HORAS_MS = 2 * 60 * 60 * 1000;

export type SalonTableGroup = {
  tone: OperationalStatus;
  title: string;
  tables: FloorTable[];
};

/**
 * En qué orden se listan las mesas en el panel lateral del salón.
 *
 * Primero las urgentes (pidió la cuenta), después las ocupadas, y al final las
 * libres — con las que tienen una reserva en las próximas dos horas arriba del
 * grupo. Dentro de cada grupo, por label.
 *
 * Vivía adentro de `ActiveTablesList`. La spec 075 lo sacó acá porque desde que
 * la lista se recorre con las flechas **el orden visual es también el orden del
 * teclado**: el panel necesita conocerlo para saber qué fila sigue, y dos
 * implementaciones del mismo orden serían dos recorridos distintos.
 *
 * `now === null` (SSR / primer render) ignora las reservas próximas, para que
 * el orden del server y el del cliente coincidan y no haya hydration mismatch.
 */
export function groupTablesForSidebar(
  tables: FloorTable[],
  reservationByTable: Record<string, { starts_at: string } | undefined>,
  now: number | null,
): SalonTableGroup[] {
  const sorted = tables.slice().sort((a, b) => a.label.localeCompare(b.label));
  const status = (t: FloorTable) => t.operational_status ?? "libre";

  const esProxima = (t: FloorTable) => {
    const r = reservationByTable[t.id];
    return (
      now != null && !!r && new Date(r.starts_at).getTime() - now < DOS_HORAS_MS
    );
  };

  const libres = sorted.filter((t) => status(t) === "libre");
  libres.sort((a, b) => {
    const pa = esProxima(a);
    const pb = esProxima(b);
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return a.label.localeCompare(b.label);
  });

  return [
    {
      tone: "pidio_cuenta",
      title: "Pidió la cuenta",
      tables: sorted.filter((t) => status(t) === "pidio_cuenta"),
    },
    {
      tone: "ocupada",
      title: "Ocupadas",
      tables: sorted.filter((t) => status(t) === "ocupada"),
    },
    { tone: "libre", title: "Libres", tables: libres },
  ];
}
