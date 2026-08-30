/** Un dueño del efectivo esperado: el cajón, o un mozo que todavía no rindió. */
export type EfectivoDeMozo = {
  mozo_id: string;
  mozo_name: string;
  efectivo_cents: number;
};

export type RepartoEfectivo = {
  /** Lo que tiene que estar físicamente en el cajón. */
  en_cajon_cents: number;
  /** Mozos con efectivo encima, de mayor a menor. Los de $0 no entran. */
  mozos: EfectivoDeMozo[];
  /**
   * Cuánto de lo no rendido no tiene respaldo en el esperado. Normalmente $0:
   * pasa cuando ya se sangró plata que un mozo todavía no entregó.
   */
  descuadre_cents: number;
};

/**
 * Parte el efectivo esperado por **dueño** (spec 130 · D5).
 *
 * El total no cambia: rendir no mueve plata, la pasa de la columna del mozo a
 * la del cajón. El efectivo ya se contó cuando el mozo cobró — por eso
 * `registrarRendicionMozo` no genera movimiento de caja y no debe generarlo.
 *
 * Sirve para que la diferencia del arqueo ya esté explicada antes de contar:
 * si faltan $71.200 y arriba dice «Nacho · sin rendir $71.200», no hay
 * misterio que resolver a la 1 de la mañana.
 */
export function repartirEfectivoEsperado(input: {
  expected_cash_cents: number;
  mozos_sin_rendir: EfectivoDeMozo[];
}): RepartoEfectivo {
  const mozos = input.mozos_sin_rendir
    .filter((m) => m.efectivo_cents > 0)
    .sort((a, b) => b.efectivo_cents - a.efectivo_cents);

  const enManos = mozos.reduce((acc, m) => acc + m.efectivo_cents, 0);
  if (enManos === 0) {
    // Sin nadie a quien restarle, el esperado es el cajón tal cual — negativo
    // incluido: si el arqueo da en rojo, la pantalla lo dice.
    return { en_cajon_cents: input.expected_cash_cents, mozos: [], descuadre_cents: 0 };
  }

  const resto = input.expected_cash_cents - enManos;
  return resto >= 0
    ? { en_cajon_cents: resto, mozos, descuadre_cents: 0 }
    : { en_cajon_cents: 0, mozos, descuadre_cents: -resto };
}
