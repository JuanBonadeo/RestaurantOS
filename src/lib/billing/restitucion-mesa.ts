/**
 * Restitución de la mesa al anular un cobro (spec 100).
 *
 * Cobrar una mesa la deja `libre`, con `opened_at` y `current_order_id` en
 * null. Anular ese cobro tiene que **devolver la mesa al plano tal como
 * estaba**, porque el caso real que dispara la anulación es que el mozo cobró
 * la mesa equivocada: la gente sigue sentada comiendo y la mesa desapareció.
 *
 * Acá vive sólo la decisión (pura y testeable); el I/O queda en
 * `cobro-actions.ts`.
 */

export type OperationalStatus = "libre" | "ocupada" | "pidio_cuenta";

export type MesaActual = {
  /** Estado operativo de la mesa hoy, después del cobro que se anula. */
  operationalStatus: OperationalStatus;
  /** A qué orden apunta la mesa hoy. El cobro lo deja en `null`. */
  currentOrderId: string | null;
};

export type OrdenRestituida = {
  id: string;
  /** Cuándo se abrió la cuenta de verdad — vuelve como `opened_at` de la mesa. */
  createdAt: string;
  /** Si la cuenta ya había sido pedida ANTES del cobro. */
  billRequestedAt: string | null;
};

export type RestitucionMesa =
  | {
      kind: "patch";
      operationalStatus: Exclude<OperationalStatus, "libre">;
      openedAt: string;
      currentOrderId: string;
    }
  | { kind: "skip"; reason: "otra-cuenta" };

/**
 * Qué escribirle a la mesa cuando se anula el cobro de `orden`.
 *
 * - **El puntero vuelve siempre.** Antes esto corría sólo si la mesa había
 *   quedado `libre`; con la mesa en cualquier otro estado la orden se reabría
 *   con todos sus ítems y **sin mesa que la muestre** — huérfana en el plano.
 * - **El estado sale de la orden, no de un default.** Volvía siempre a
 *   `pidio_cuenta`, que es falso justo en el caso que motiva la anulación: esa
 *   mesa nunca pidió la cuenta, la cobraron por error. `pidio_cuenta` sólo si
 *   la orden traía `bill_requested_at` de antes del cobro.
 * - **`opened_at` es el de la cuenta, no `now()`.** Con `now()` la mesa
 *   arrancaba de cero y el color por demora (spec 30) mentía: gente sentada
 *   hace dos horas aparecía recién llegada.
 *
 * La única razón para no tocar la mesa es que ya tenga otra cuenta encima.
 */
export function restitucionMesa(
  mesa: MesaActual,
  orden: OrdenRestituida,
): RestitucionMesa {
  if (mesa.currentOrderId != null && mesa.currentOrderId !== orden.id) {
    return { kind: "skip", reason: "otra-cuenta" };
  }

  return {
    kind: "patch",
    operationalStatus: orden.billRequestedAt ? "pidio_cuenta" : "ocupada",
    openedAt: orden.createdAt,
    currentOrderId: orden.id,
  };
}
