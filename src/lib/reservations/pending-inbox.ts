import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";

import { pendingExpiresAt } from "@/lib/reservations/pending-expiry";
import type { Reservation } from "@/lib/reservations/types";

/**
 * La bandeja de solicitudes (spec 135) — armado puro, sin DB.
 *
 * Lo que el encargado necesita para contestar sin salir de la pantalla:
 * cuándo, quién, cuántos, **cómo viene ese servicio** y **cuánto le queda antes
 * de vencer**. Las dos últimas son las que hoy no están en ningún lado y las que
 * convierten a la bandeja en algo más que una lista de nombres.
 */

/** Cuando falta menos que esto para vencer, la solicitud se marca como urgente. */
export const URGENTE_ANTES_DE_MS = 3 * 60 * 60 * 1000;

/**
 * Cómo viene el servicio al que entra la solicitud.
 *
 * Dos lecturas según el modo del negocio (D5): en **flexible** hay cupo de
 * verdad y se cuentan cubiertos; en **estricto** no hay `soft_capacity`
 * configurado, así que se dice lo único que ahí es cierto — cuántas mesas
 * quedan libres a esa hora. `null` cuando no se puede decir nada honesto.
 */
export type OcupacionContexto =
  | { tipo: "cubiertos"; usados: number; cupo: number | null; label: string; ratio: number | null }
  | { tipo: "mesas"; libres: number; total: number; label: string; ratio: number | null };

export type SolicitudEnBandeja = {
  reserva: Reservation & {
    tables?: { label: string; floor_plans?: { id: string; name: string } | null } | null;
  };
  /** Cuándo vence si nadie la contesta (spec 131). */
  venceEn: string;
  ocupacion: OcupacionContexto | null;
};

export type DiaDeBandeja = {
  /** `YYYY-MM-DD` en la TZ del negocio. */
  date: string;
  /** «Hoy», «Mañana» o «sáb 6 de sep». */
  label: string;
  solicitudes: SolicitudEnBandeja[];
};

/** El día local (`YYYY-MM-DD`) de un instante, en la TZ del negocio. */
export function localDate(iso: string, timezone: string): string {
  return formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd");
}

/**
 * Título del grupo. «Hoy» y «Mañana» se leen más rápido que la fecha, y son los
 * dos días donde el apuro es real.
 */
export function labelDelDia(date: string, timezone: string, now: Date): string {
  const hoy = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const manana = formatInTimeZone(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
    timezone,
    "yyyy-MM-dd",
  );
  if (date === hoy) return "Hoy";
  if (date === manana) return "Mañana";
  return formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", "EEE d 'de' MMM", {
    locale: es,
  });
}

/** «vence en 2 h» · «vence en 25 min» · «vencida». Corto: es una alarma, no un texto. */
export function labelDeVencimiento(venceEn: string, now: Date): string {
  const restanteMin = Math.round(
    (new Date(venceEn).getTime() - now.getTime()) / 60_000,
  );
  if (restanteMin <= 0) return "vencida";
  if (restanteMin < 60) return `vence en ${restanteMin} min`;
  const horas = Math.round(restanteMin / 60);
  if (horas < 24) return `vence en ${horas} h`;
  return `vence en ${Math.round(horas / 24)} d`;
}

/** ¿Falta poco? Es lo que decide si la tarjeta grita. */
export function esUrgente(venceEn: string, now: Date): boolean {
  return new Date(venceEn).getTime() - now.getTime() <= URGENTE_ANTES_DE_MS;
}

/** El texto y la barra de la ocupación por cubiertos (modo flexible). */
export function ocupacionPorCubiertos(
  servicio: string | null,
  usados: number,
  cupo: number | null,
): OcupacionContexto {
  const nombre = servicio?.trim() || "Servicio";
  return {
    tipo: "cubiertos",
    usados,
    cupo,
    label: cupo == null ? `${nombre} · ${usados} cubiertos` : `${nombre} · ${usados}/${cupo}`,
    ratio: cupo && cupo > 0 ? Math.min(1, usados / cupo) : null,
  };
}

/** El texto y la barra de las mesas libres (modo estricto). */
export function ocupacionPorMesas(libres: number, total: number): OcupacionContexto {
  return {
    tipo: "mesas",
    libres,
    total,
    label:
      libres === 0
        ? "sin mesas libres a esa hora"
        : `${libres} de ${total} mesas libres`,
    ratio: total > 0 ? Math.min(1, (total - libres) / total) : null,
  };
}

/**
 * Agrupa por día y ordena: los días de más cerca a más lejos y, dentro de cada
 * día, la que vence primero — el orden del apuro real, no el de llegada.
 */
export function agruparPorDia(
  solicitudes: SolicitudEnBandeja[],
  timezone: string,
  now: Date,
): DiaDeBandeja[] {
  const porDia = new Map<string, SolicitudEnBandeja[]>();
  for (const s of solicitudes) {
    const date = localDate(s.reserva.starts_at, timezone);
    const lista = porDia.get(date);
    if (lista) lista.push(s);
    else porDia.set(date, [s]);
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, lista]) => ({
      date,
      label: labelDelDia(date, timezone, now),
      solicitudes: lista.sort(
        (a, b) => new Date(a.venceEn).getTime() - new Date(b.venceEn).getTime(),
      ),
    }));
}

/** Re-exporta el cálculo del vencimiento para que el caller no importe dos módulos. */
export { pendingExpiresAt };
