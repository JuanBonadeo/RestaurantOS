import type { FloorTable } from "@/lib/reservations/types";

/**
 * Elegir mesa para una reserva (spec 138) — la regla, compartida.
 *
 * El gesto existe desde la spec 059 en el plano de Operación: se toca «Asignar
 * mesa», el plano queda esperando y el tap asigna. Esta spec lo lleva al plano
 * del día, y para eso la regla y el copy salen de donde vivían —sueltos dentro
 * del handler de `salon-desktop`— a un lugar que usan los dos.
 *
 * El server (`updateReservationDetails`) sigue siendo la autoridad: valida
 * ventana, cupo y GIST. Esto adelanta lo único que se ve en la mesa —si
 * entran— para no hacer ir y volver por algo evidente.
 */

export type AsignacionIntent = "assign" | "seat";

export type ChequeoDeMesa = { ok: true } | { ok: false; motivo: string };

/** ¿Entra este grupo en esta mesa? */
export function mesaSirveParaReserva(input: {
  mesa: Pick<FloorTable, "label" | "seats" | "status">;
  partySize: number;
}): ChequeoDeMesa {
  const { mesa, partySize } = input;
  if (mesa.status !== "active") {
    return { ok: false, motivo: `La mesa ${mesa.label} está deshabilitada.` };
  }
  if (mesa.seats < partySize) {
    return {
      ok: false,
      motivo: `Mesa ${mesa.label} tiene ${mesa.seats} ${
        mesa.seats === 1 ? "lugar" : "lugares"
      } para ${partySize} ${partySize === 1 ? "persona" : "personas"}.`,
    };
  }
  return { ok: true };
}

/** El texto del banner mientras el plano espera el tap. */
export function textoDelModo(input: {
  intent: AsignacionIntent;
  nombre: string;
  partySize: number;
}): string {
  const quien = `${input.nombre} · ${input.partySize}p`;
  return input.intent === "seat"
    ? `Tocá dónde sentar a ${quien}`
    : `Tocá una mesa para ${quien}`;
}

/** El aviso de que salió bien. */
export function textoDeAsignacion(input: {
  intent: AsignacionIntent;
  etiquetaMesa: string;
  nombre: string;
}): string {
  return input.intent === "seat"
    ? `${input.nombre} sentado en ${input.etiquetaMesa}.`
    : `Mesa ${input.etiquetaMesa} asignada a ${input.nombre}.`;
}
