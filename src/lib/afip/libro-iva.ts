/**
 * Cómo se suman los comprobantes de un período. Una sola vez.
 *
 * La regla existía escrita dos veces: `getInvoiceKPIs` (panel de Facturación y
 * mail de cierre) la arregló en el issue #274·5, y `getFiscalSummary` —el
 * reporte fiscal de /admin/reportes, que alimenta el ratio facturado/ventas—
 * quedó con el bug original: agregaba por `status === 'authorized'` sin mirar
 * `tipo_comprobante`, así que **cada nota de crédito sumaba en vez de restar**,
 * en el importe y en el IVA.
 *
 * Es el patrón que esta ronda encontró seis veces: la misma regla en dos
 * archivos, arreglada de un lado nomás. Por eso el fix no es copiar el `if` al
 * otro lado sino sacarlo de los dos y dejarlo acá, en una función pura que no
 * sabe de Supabase ni de qué cliente la llama.
 *
 * Las dos decisiones que hereda de #274·5, que no son obvias:
 *
 * · **Una factura `cancelled` cuenta en el neto.** `anularFactura` sólo la marca
 *   así después de que la NC quedó autorizada, y anular no borra nada ante ARCA:
 *   el comprobante sigue en Mis Comprobantes y en la declaración. Excluirla
 *   mientras se incluye su NC da cero donde el neto correcto es un ticket.
 *
 * · **Los conteos no siguen al importe.** Responden otra pregunta —«cuántos
 *   comprobantes vigentes tengo»— así que ahí la anulada no entra.
 *
 * El neto puede dar NEGATIVO (un período donde se anuló más de lo que se
 * facturó, típico del primer día del mes). Es un dato, no un error: taparlo con
 * un `Math.max(0, …)` sería volver a maquillar el número.
 */

export type FilaComprobante = {
  total_cents: number;
  /** Opcional: `getInvoiceKPIs` no lo lee porque su panel no muestra IVA. */
  iva_cents?: number | null;
  status: string;
  tipo_comprobante: string;
};

export type LibroIva = {
  /** Neto del período: facturas con CAE menos notas de crédito. Puede ser negativo. */
  netoCents: number;
  /** IVA del neto, con el mismo criterio de signo. */
  ivaCents: number;
  /** Notas de crédito autorizadas, en valor absoluto (lo que se restó). */
  notasCreditoCents: number;
  countNotasCredito: number;
  /** Comprobantes (A + B) autorizados. Las NC y las anuladas no cuentan acá. */
  count: number;
  countA: number;
  countB: number;
  countFailed: number;
  countPending: number;
};

export function esNotaDeCredito(tipo: string): boolean {
  return tipo === "nota_credito_a" || tipo === "nota_credito_b";
}

export function acumularLibroIva(filas: FilaComprobante[]): LibroIva {
  let netoCents = 0;
  let ivaCents = 0;
  let notasCreditoCents = 0;
  let notasCreditoIvaCents = 0;
  let countNotasCredito = 0;
  let count = 0;
  let countA = 0;
  let countB = 0;
  let countFailed = 0;
  let countPending = 0;

  for (const fila of filas) {
    const total = Number(fila.total_cents) || 0;
    const iva = Number(fila.iva_cents ?? 0) || 0;

    if (fila.status === "authorized" && esNotaDeCredito(fila.tipo_comprobante)) {
      // El importe de la NC se guarda positivo en la fila (es el mismo total que
      // la factura que anula); el signo lo pone la lectura, acá.
      notasCreditoCents += total;
      notasCreditoIvaCents += iva;
      countNotasCredito++;
      continue;
    }

    if (fila.status === "authorized" || fila.status === "cancelled") {
      netoCents += total;
      ivaCents += iva;
    }

    if (fila.status === "authorized") {
      count++;
      if (fila.tipo_comprobante === "factura_a") countA++;
      else countB++;
    } else if (fila.status === "failed") {
      countFailed++;
    } else if (fila.status === "pending") {
      countPending++;
    }
  }

  return {
    netoCents: netoCents - notasCreditoCents,
    ivaCents: ivaCents - notasCreditoIvaCents,
    notasCreditoCents,
    countNotasCredito,
    count,
    countA,
    countB,
    countFailed,
    countPending,
  };
}
