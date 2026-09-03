/**
 * La ventana de un cierre (spec 149) — lógica pura, sin DB.
 *
 * Un corte no guarda qué turno cerró: lo define por dónde cae entre los otros
 * cortes de su misma caja. Acá vive ese cálculo, aparte de las queries, porque
 * es donde viviría un off-by-one — y un off-by-one acá mueve plata de un turno
 * al otro sin que ninguna suma dé mal.
 */

export type CorteEncadenable = {
  id: string;
  caja_id: string;
  created_at: string;
};

/**
 * Para cada corte, el arranque del turno que cerró: el `created_at` del corte
 * anterior **de su misma caja**.
 *
 * Recibe la lista tal como la devuelve el historial (más nuevo primero) y la
 * encadena por caja. El más viejo de cada caja queda sin predecesor en la
 * lista: su piso está antes del rango pedido y lo tiene que resolver el caller
 * (con una consulta, o con el alta de la caja si es el primer corte de todos).
 *
 * Las cajas no se mezclan: dos cortes seguidos en la lista pueden ser de cajas
 * distintas, y encadenarlos daría un turno que nunca existió.
 */
export function encadenarPeriodos<T extends CorteEncadenable>(
  cortesDescendentes: T[],
): { desdePorCorte: Map<string, string>; sinPredecesor: T[] } {
  const desdePorCorte = new Map<string, string>();
  const ultimoVistoPorCaja = new Map<string, string>();

  for (const corte of cortesDescendentes) {
    const masNuevoDeLaMismaCaja = ultimoVistoPorCaja.get(corte.caja_id);
    // Vamos de nuevo a viejo: este corte es el piso del que vimos antes.
    if (masNuevoDeLaMismaCaja) {
      desdePorCorte.set(masNuevoDeLaMismaCaja, corte.created_at);
    }
    ultimoVistoPorCaja.set(corte.caja_id, corte.id);
  }

  return {
    desdePorCorte,
    sinPredecesor: cortesDescendentes.filter((c) => !desdePorCorte.has(c.id)),
  };
}

export type VentanaDelCorte = {
  /** Exclusivo: `created_at > desde`. */
  desde: string;
  /** Inclusivo: `created_at <= hasta`. */
  hasta: string;
  /** Lo contado por el corte anterior; entra como arrastre bruto. */
  arrastreBrutoCents: number;
};

/**
 * De dónde a dónde va el turno que cerró un corte.
 *
 * El piso es **exclusivo** y el techo **inclusivo**, igual que el período vivo
 * (`created_at > ultimo_corte.created_at`). Esa asimetría es la que hace que
 * dos turnos consecutivos no compartan ni se pierdan un solo cobro: el corte
 * anterior es el techo de su propio turno y no vuelve a entrar en el siguiente.
 */
export function ventanaDelCorte(
  corte: { created_at: string },
  anterior: { created_at: string; closing_cash_cents: number } | null,
  cajaCreatedAt: string,
): VentanaDelCorte {
  return {
    desde: anterior?.created_at ?? cajaCreatedAt,
    hasta: corte.created_at,
    arrastreBrutoCents: anterior?.closing_cash_cents ?? 0,
  };
}
