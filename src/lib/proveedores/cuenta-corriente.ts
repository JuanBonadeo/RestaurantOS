/**
 * Cuenta corriente de proveedores — el saldo y su lectura (spec 158).
 *
 * Lógica pura, sin DB: la comparten la ficha del proveedor, la pantalla de pago
 * y el informe de vencimientos, así que el número que se ve antes de pagar es el
 * mismo que se descuenta después.
 *
 * **El saldo se DERIVA** (D3), igual que el de clientes de la spec 141:
 *
 *     saldo = Σ comprobantes vivos − Σ pagos vivos
 *
 * No hay libro de asientos ni columna `saldo`. Un comprobante anulado o un pago
 * anulado salen del saldo por no estar vivos, no porque alguien recalculó — la
 * única forma de que un saldo mienta es que tenga dos fuentes.
 *
 * Signo: **positivo = le debemos al proveedor**. Es el espejo del de clientes,
 * donde positivo es lo que el cliente nos debe a nosotros.
 */

/** Tipo de comprobante de compra. `interno` es el `Z` de MaxiRest: sin factura. */
export type DocumentType =
  | "factura_a"
  | "factura_b"
  | "factura_c"
  | "nota_credito"
  | "nota_debito"
  | "remito"
  | "ticket"
  | "interno";

/** Un comprobante de compra. La nota de crédito viene con `total_cents` negativo (D4). */
export type ComprobanteCompra = {
  id: string;
  total_cents: number;
  invoice_date: string;
  due_date?: string | null;
  document_type?: DocumentType;
  invoice_number?: string | null;
  /** El concepto de gasto (spec 158). La query ya lo traía; el tipo no lo decía. */
  expense_concept_id?: string | null;
  /** Anulado con motivo (spec 070): sigue en el libro, no cuenta para el saldo. */
  cancelled_at?: string | null;
};

/** Un pago al proveedor. */
export type PagoProveedor = {
  id: string;
  amount_cents: number;
  paid_at: string;
  method: string;
  cancelled_at?: string | null;
  /**
   * Correlativo por negocio de la orden de pago (spec 163, migración 0071).
   * `null` en los pagos anteriores a la spec: no se retro-numeran, igual que
   * los cortes viejos de `caja_cortes`.
   */
  numero?: number | null;
};

/** Cuánto de un pago se imputó a qué comprobante. Sin filas = pago a cuenta. */
export type ImputacionPago = {
  payment_id: string;
  invoice_id: string;
  amount_cents: number;
};

export type MovimientoProveedor = {
  tipo: "comprobante" | "pago";
  id: string;
  amount_cents: number;
  fecha: string;
  anulado: boolean;
  /** El número del comprobante, o el método para un pago. */
  detalle: string;
};

export type ComprobanteConSaldo = ComprobanteCompra & {
  pagado_cents: number;
  saldo_cents: number;
};

const vivo = (x: { cancelled_at?: string | null }) => !x.cancelled_at;

/**
 * El saldo con el proveedor, en centavos. Positivo = le debemos.
 *
 * Puede dar **negativo** y no es un bug: es un pago a cuenta, o un proveedor al
 * que se le anuló un comprobante después de pagárselo. Se muestra como saldo a
 * favor; clamparlo a cero escondería plata que el proveedor nos debe.
 */
export function calcularSaldoProveedor(
  comprobantes: ComprobanteCompra[],
  pagos: PagoProveedor[],
): number {
  const debe = comprobantes.filter(vivo).reduce((n, c) => n + c.total_cents, 0);
  const pago = pagos.filter(vivo).reduce((n, p) => n + p.amount_cents, 0);
  return debe - pago;
}

/**
 * Cuánto queda impago de cada comprobante, según lo que se le imputó.
 *
 * Las imputaciones de pagos anulados no cuentan: anular el pago devuelve la
 * deuda, que es exactamente lo que espera quien anuló.
 */
export function comprobantesConSaldo(
  comprobantes: ComprobanteCompra[],
  imputaciones: ImputacionPago[],
  pagos: PagoProveedor[],
): ComprobanteConSaldo[] {
  const pagoVivo = new Set(pagos.filter(vivo).map((p) => p.id));

  const pagadoPorComprobante = new Map<string, number>();
  for (const im of imputaciones) {
    if (!pagoVivo.has(im.payment_id)) continue;
    pagadoPorComprobante.set(
      im.invoice_id,
      (pagadoPorComprobante.get(im.invoice_id) ?? 0) + im.amount_cents,
    );
  }

  return comprobantes.map((c) => {
    const pagado = pagadoPorComprobante.get(c.id) ?? 0;
    return { ...c, pagado_cents: pagado, saldo_cents: c.total_cents - pagado };
  });
}

/**
 * Los comprobantes que todavía deben plata, del más viejo al más nuevo — el
 * orden en que se paga y el orden en que vencen.
 *
 * Un comprobante anulado no se debe. Una nota de crédito tampoco se "paga": su
 * saldo es negativo y queda fuera de esta lista (se aplica contra el saldo
 * general del proveedor).
 */
export function comprobantesImpagos(
  comprobantes: ComprobanteCompra[],
  imputaciones: ImputacionPago[],
  pagos: PagoProveedor[],
): ComprobanteConSaldo[] {
  return comprobantesConSaldo(comprobantes, imputaciones, pagos)
    .filter((c) => vivo(c) && c.saldo_cents > 0)
    .sort((a, b) => {
      const fa = a.due_date ?? a.invoice_date;
      const fb = b.due_date ?? b.invoice_date;
      return fa === fb ? a.id.localeCompare(b.id) : fa.localeCompare(fb);
    });
}

/**
 * El vencimiento que le corresponde a un comprobante: la fecha del comprobante
 * más los días de crédito del proveedor (`payment_terms_days`, el `dias_venc` de
 * MaxiRest). Con 0 días vence el mismo día — es contado, no un error.
 *
 * Fechas en `YYYY-MM-DD` y aritmética en UTC a propósito: sumar días sobre una
 * fecha sin hora no puede cruzar un cambio de huso ni un horario de verano.
 */
export function calcularVencimiento(
  invoiceDate: string,
  paymentTermsDays: number,
): string {
  const [y, m, d] = invoiceDate.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const venc = new Date(base + Math.max(0, paymentTermsDays) * 86_400_000);
  return venc.toISOString().slice(0, 10);
}

/** Días de atraso de un impago. Negativo = todavía no venció. */
export function diasVencido(comprobante: ComprobanteCompra, hoy: string): number {
  const venc = comprobante.due_date ?? comprobante.invoice_date;
  const [ay, am, ad] = venc.split("-").map(Number);
  const [by, bm, bd] = hoy.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/**
 * Reparte un pago entre los impagos, del más viejo al más nuevo — el criterio de
 * imputación de siempre: se cancela primero lo que vence antes.
 *
 * Lo que sobra después de cubrirlos todos **no se reparte**: queda como pago a
 * cuenta. Forzarlo contra un comprobante inventaría deuda que no existe.
 */
export function repartirPago(
  amountCents: number,
  impagos: ComprobanteConSaldo[],
): { imputaciones: Array<{ invoice_id: string; amount_cents: number }>; a_cuenta_cents: number } {
  let resto = amountCents;
  const imputaciones: Array<{ invoice_id: string; amount_cents: number }> = [];

  for (const c of impagos) {
    if (resto <= 0) break;
    const aplica = Math.min(resto, c.saldo_cents);
    if (aplica <= 0) continue;
    imputaciones.push({ invoice_id: c.id, amount_cents: aplica });
    resto -= aplica;
  }

  return { imputaciones, a_cuenta_cents: resto };
}

/**
 * El libro del proveedor: comprobantes y pagos mezclados, del más nuevo al más
 * viejo. Lo anulado **se muestra** —tachado, como en el libro de caja— porque un
 * movimiento que desaparece es un movimiento que nadie puede auditar.
 */
export function armarLibroProveedor(
  comprobantes: ComprobanteCompra[],
  pagos: PagoProveedor[],
): MovimientoProveedor[] {
  const items: MovimientoProveedor[] = [
    ...comprobantes.map((c) => ({
      tipo: "comprobante" as const,
      id: c.id,
      amount_cents: c.total_cents,
      fecha: c.invoice_date,
      anulado: !vivo(c),
      detalle: c.invoice_number?.trim()
        ? `#${c.invoice_number.trim()}`
        : etiquetaTipo(c.document_type ?? "interno"),
    })),
    ...pagos.map((p) => ({
      tipo: "pago" as const,
      id: p.id,
      amount_cents: p.amount_cents,
      fecha: p.paid_at,
      anulado: !vivo(p),
      // Spec 163 — antes decía sólo «Efectivo», y dos pagos en efectivo del
      // mismo monto el mismo día quedaban indistinguibles en el libro.
      detalle: p.numero
        ? `OP #${p.numero} · ${etiquetaMetodo(p.method)}`
        : etiquetaMetodo(p.method),
    })),
  ];

  return items.sort((a, b) =>
    a.fecha === b.fecha ? a.id.localeCompare(b.id) : b.fecha.localeCompare(a.fecha),
  );
}

export function etiquetaTipo(tipo: DocumentType): string {
  const nombres: Record<DocumentType, string> = {
    factura_a: "Factura A",
    factura_b: "Factura B",
    factura_c: "Factura C",
    nota_credito: "Nota de crédito",
    nota_debito: "Nota de débito",
    remito: "Remito",
    ticket: "Ticket",
    interno: "Sin comprobante",
  };
  return nombres[tipo] ?? tipo;
}

export function etiquetaMetodo(method: string): string {
  const nombres: Record<string, string> = {
    cash: "Efectivo",
    transfer: "Transferencia",
    card_manual: "Tarjeta",
    other: "Otro",
  };
  return nombres[method] ?? method;
}

/** Total gastado por concepto/rubro en un período — el informe que hoy no existe. */
export function totalizarPorClave<T extends { total_cents: number; cancelled_at?: string | null }>(
  comprobantes: T[],
  clave: (c: T) => string,
): Array<{ clave: string; total_cents: number; comprobantes: number }> {
  const map = new Map<string, { total_cents: number; comprobantes: number }>();

  for (const c of comprobantes.filter(vivo)) {
    const k = clave(c);
    const entry = map.get(k) ?? { total_cents: 0, comprobantes: 0 };
    entry.total_cents += c.total_cents;
    entry.comprobantes += 1;
    map.set(k, entry);
  }

  return Array.from(map.entries())
    .map(([k, v]) => ({ clave: k, ...v }))
    .sort((a, b) => b.total_cents - a.total_cents);
}

// ═══════════════════════════════════════════════════════════════════
// spec 159 · lo que hace falta para leer la cuenta como en MaxiRest
// ═══════════════════════════════════════════════════════════════════

/** Un pago, con cuánto de él fue a parar a un comprobante puntual. */
export type PagoImputado = PagoProveedor & { imputado_cents: number };

/**
 * Los pagos que cancelaron un comprobante — el panel derecho del master-detail.
 *
 * Devuelve **cuánto de cada pago** fue a ese comprobante, no el importe total del
 * pago: un pago de $100.000 repartido entre tres facturas tiene que mostrar lo
 * que le tocó a la que estás mirando, o los números de la fila no cierran con los
 * de la grilla de al lado.
 *
 * Los pagos anulados no figuran: su imputación ya no cancela nada.
 */
export function pagosDeComprobante(
  invoiceId: string,
  imputaciones: ImputacionPago[],
  pagos: PagoProveedor[],
): PagoImputado[] {
  const porId = new Map(pagos.filter(vivo).map((p) => [p.id, p]));

  return imputaciones
    .filter((im) => im.invoice_id === invoiceId && porId.has(im.payment_id))
    .map((im) => ({ ...porId.get(im.payment_id)!, imputado_cents: im.amount_cents }))
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at));
}

/** Las compras de un rango. Los bordes entran (`desde` y `hasta` inclusive). */
export function filtrarPorPeriodo<T extends { invoice_date: string }>(
  comprobantes: T[],
  desde?: string | null,
  hasta?: string | null,
): T[] {
  return comprobantes.filter(
    (c) =>
      (!desde || c.invoice_date >= desde) && (!hasta || c.invoice_date <= hasta),
  );
}

export type TotalesPeriodo = {
  total_cents: number;
  saldo_cents: number;
  pago_a_cuenta_cents: number;
};

/**
 * El pie de la grilla: total comprado en el período, cuánto de eso sigue impago,
 * y el pago a cuenta **aparte**.
 *
 * El pago a cuenta va separado a propósito: no cancela ningún comprobante, así
 * que sumarlo con el resto esconde por qué el saldo del proveedor no cierra
 * contra la lista que estás mirando.
 */
export function totalesDelPeriodo(
  comprobantes: ComprobanteCompra[],
  imputaciones: ImputacionPago[],
  pagos: PagoProveedor[],
): TotalesPeriodo {
  const conSaldo = comprobantesConSaldo(comprobantes, imputaciones, pagos);
  const vivos = conSaldo.filter(vivo);

  // Spec 163 — esto era un `Set` de payment_id y un `.filter(p => !imputado.has(p.id))`,
  // o sea: **una sola** imputación sacaba al pago entero de la cuenta. Pero
  // `repartirPago` produce el caso mixto —pagás $100.000, se imputan $60.000 y
  // $40.000 quedan a cuenta— y ahí el toast prometía «$40.000 quedaron a cuenta»
  // mientras el pie decía $0. Con un Map, lo a-cuenta es lo que sobra de cada
  // pago, que es la definición.
  const imputadoPorPago = new Map<string, number>();
  for (const im of imputaciones) {
    imputadoPorPago.set(
      im.payment_id,
      (imputadoPorPago.get(im.payment_id) ?? 0) + im.amount_cents,
    );
  }
  const aCuenta = pagos
    .filter(vivo)
    .reduce(
      (n, p) => n + Math.max(0, p.amount_cents - (imputadoPorPago.get(p.id) ?? 0)),
      0,
    );

  return {
    total_cents: vivos.reduce((n, c) => n + c.total_cents, 0),
    saldo_cents: vivos.reduce((n, c) => n + c.saldo_cents, 0),
    pago_a_cuenta_cents: aCuenta,
  };
}

export type DiaDeProyeccion = {
  /** `YYYY-MM-DD`. */
  fecha: string;
  total_cents: number;
  items: Array<ComprobanteConSaldo & { supplier_id?: string; atrasado: boolean }>;
};

/**
 * El calendario del mes: cuánta plata hay que pagar cada día.
 *
 * **Lo vencido se acumula en el día de hoy** y se marca como atrasado. Una
 * factura que venció el 28 y sigue impaga es plata que hace falta igual, y en el
 * calendario del mes que viene no caería en ninguna casilla: la proyección
 * mentiría hacia abajo justo en los meses en que uno se atrasó.
 *
 * `mes` es `YYYY-MM`. Sólo se devuelven los días que tienen algo.
 */
export function proyeccionPorDia(
  impagos: Array<ComprobanteConSaldo & { supplier_id?: string }>,
  mes: string,
  hoy: string,
): DiaDeProyeccion[] {
  const porDia = new Map<string, DiaDeProyeccion>();
  const hoyEnElMes = hoy.slice(0, 7) === mes;

  for (const c of impagos) {
    const vence = c.due_date ?? c.invoice_date;
    const atrasado = vence < hoy;

    // Lo atrasado se muestra en hoy, y sólo si hoy cae en el mes que se mira.
    const fecha = atrasado ? hoy : vence;
    if (atrasado && !hoyEnElMes) continue;
    if (!atrasado && fecha.slice(0, 7) !== mes) continue;

    const entry = porDia.get(fecha) ?? { fecha, total_cents: 0, items: [] };
    entry.total_cents += c.saldo_cents;
    entry.items.push({ ...c, atrasado });
    porDia.set(fecha, entry);
  }

  return Array.from(porDia.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
}
