/**
 * Cuánto lleva esperando un pedido, y cuándo eso ya molesta (spec 139).
 *
 * La tarjeta del board siempre mostró el tiempo desde que entró, con el mismo
 * umbral para todos los estados. Pero no es lo mismo: 15 minutos **en cocina**
 * son normales, y 15 minutos **sin que nadie lo mire** son un cliente que pidió
 * comida y no sabe si alguien la va a hacer.
 *
 * Por eso el pedido que espera una decisión tiene su propia escala, más corta.
 */

/** A partir de acá, un pedido sin confirmar ya se hizo esperar. */
export const ESPERA_QUE_MOLESTA_MIN = 10;
/** Y acá ya es un problema. */
export const ESPERA_GRAVE_MIN = 20;

export type TonoDeEspera = "normal" | "demorado" | "grave";

/**
 * El tono del contador. `esperandoDecision` = pedido online que todavía nadie
 * confirmó ni rechazó.
 */
export function tonoDeEspera(input: {
  minutos: number;
  esperandoDecision: boolean;
  terminal: boolean;
}): TonoDeEspera {
  if (input.terminal) return "normal";
  if (input.esperandoDecision) {
    if (input.minutos >= ESPERA_GRAVE_MIN) return "grave";
    if (input.minutos >= ESPERA_QUE_MOLESTA_MIN) return "demorado";
    return "normal";
  }
  // El resto del ciclo mantiene la escala de siempre.
  if (input.minutos >= 30) return "grave";
  if (input.minutos >= 15) return "demorado";
  return "normal";
}
