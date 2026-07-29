// Render del "control de pedido" — spec 063.
//
// El otro papel que sale al marchar un delivery o un retiro. La comanda de
// cocina va sin precios, partida por sector y sin cliente; ésta es al revés:
// el pedido entero, con plata, destino y horario, para el que reparte.
//
// Reusa los primitivos de `ticket.ts` (ASCII, wrap, ESC/POS, ancho de columna)
// para que los dos tickets salgan con el mismo espaciado en la misma térmica.
// Lo único propio es qué se imprime y con qué jerarquía.
//
// Referencia de formato: el «Control de Pedido» de MaxiRest del Restaurant del
// Golf, que es lo que el local viene usando.

import {
  COLS,
  renderEscPos,
  renderPlain,
  RULE,
  TIMEZONE,
  toAscii,
  wrap,
  type Line,
} from "./ticket";

export type ControlTicketItem = {
  product_name: string;
  quantity: number;
  /** Precio de la línea (unitario × cantidad), en centavos. */
  line_total_cents: number;
  notes?: string | null;
  modifiers?: ReadonlyArray<string | null | undefined> | null;
};

export type ControlTicketData = {
  control_ticket_id: string;
  business_name: string;
  business_address?: string | null;
  business_phone?: string | null;
  order_number: number | string;
  delivery_type: "delivery" | "pickup";
  emitted_at: string;
  /** `orders.scheduled_at`. Null = "lo antes posible". */
  scheduled_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_notes?: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  payment_method?: string | null;
  /** `orders.payment_status`. `paid` ⇒ el repartidor no cobra nada. */
  payment_status?: string | null;
  reprint?: boolean;
  items?: ControlTicketItem[] | null;
};

/** Centavos → "110500.00". Sin símbolo de moneda: la térmica es ASCII. */
function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * "28/07 19:16" en el TZ del local, hora de 24h.
 *
 * Se arma desde `formatToParts` y no desde `format`: con un skeleton de
 * día+mes, `es-AR` ignora el `2-digit` del mes y devuelve "28/7, 20:30". Las
 * partes sí respetan el ancho pedido, y de paso evitan el separador variable.
 */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // `hour12:false` puede emitir "24" a medianoche en algunos entornos.
  const hh = pick("hour") === "24" ? "00" : pick("hour");
  return `${pick("day")}/${pick("month")} ${hh}:${pick("minute")}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Efectivo",
  mp: "Mercado Pago",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
};

/**
 * Alinea `label` a la izquierda y `value` a la derecha dentro del ancho útil.
 * Si no entran juntos, el valor se va al renglón de abajo pegado a la derecha
 * (mejor eso que una línea desbordada que la impresora parte donde quiere).
 */
function row(label: string, value: string, cols = COLS.sm): string {
  const l = toAscii(label);
  const v = toAscii(value);
  const gap = cols - l.length - v.length;
  if (gap >= 1) return l + " ".repeat(gap) + v;
  return l + "\n" + v.padStart(cols);
}

/** Arma el control de pedido como líneas con formato. */
export function buildControlTicketLines(c: ControlTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, opts: Omit<Line, "text"> = {}) => {
    // `row()` puede devolver dos renglones; los separamos para no mandar un
    // "\n" crudo dentro de una línea ESC/POS.
    for (const part of toAscii(text).split("\n")) L.push({ text: part, ...opts });
  };

  const isDelivery = c.delivery_type === "delivery";

  if (c.reprint) {
    push("*** REIMPRESION ***", { size: "tall", bold: true, align: "center" });
    push(RULE);
  }

  // ── Cabecera del negocio ──────────────────────────────────────────────────
  push(String(c.business_name).toUpperCase(), { bold: true, align: "center" });
  if (c.business_address)
    for (const l of wrap(c.business_address, COLS.sm)) push(l, { align: "center" });
  if (c.business_phone) push(c.business_phone, { align: "center" });
  push(RULE);

  // ── Qué es y de qué pedido ────────────────────────────────────────────────
  push("Control de Pedido", { align: "center" });
  push(`${isDelivery ? "DELIVERY" : "RETIRO"} #${c.order_number}`, {
    size: "tall",
    bold: true,
    align: "center",
  });
  push(RULE);

  // ── Cuándo ────────────────────────────────────────────────────────────────
  // La hora de entrega es el dato operativo: es la que decide si el repartidor
  // sale ya o espera. Por eso va en negrita, arriba de todo lo demás.
  push(`Emitido: ${stamp(c.emitted_at)}`);
  push(
    c.scheduled_at
      ? `ENTREGA: ${stamp(c.scheduled_at)}`
      : "ENTREGA: lo antes posible",
    { bold: true },
  );
  if (isDelivery) push("Repartidor: ______________");
  push(RULE);

  // ── Ítems con precio ──────────────────────────────────────────────────────
  const items = c.items ?? [];
  for (const it of items) {
    for (const l of wrap(`${it.quantity}x ${it.product_name}`, COLS.sm))
      push(l, { bold: true });
    // Sin sangría: `wrap` corta por palabra y se come los espacios de la
    // izquierda, así que el prefijo tiene que ser un carácter visible.
    if (it.modifiers && it.modifiers.length)
      for (const l of wrap(`+ ${it.modifiers.join(", ")}`, COLS.sm)) push(l);
    if (it.notes) for (const l of wrap(`obs: ${it.notes}`, COLS.sm)) push(l);
    push(row("", money(it.line_total_cents)));
  }
  if (items.length === 0) push("(sin items)");
  push(RULE);

  // ── Plata ─────────────────────────────────────────────────────────────────
  push(row("Subtotal:", money(c.subtotal_cents)));
  if (c.delivery_fee_cents > 0) push(row("Envio:", money(c.delivery_fee_cents)));
  if (c.discount_cents > 0)
    push(row("Descuento:", `-${money(c.discount_cents)}`));
  push(row("TOTAL:", money(c.total_cents)), { size: "tall", bold: true });
  push(RULE);

  // ── Lo que más importa: cuánto cobrar ─────────────────────────────────────
  // Cobrar de más o de menos es plata del local, así que el estado del pago va
  // en el tamaño más grande del ticket y sin ambigüedad.
  if (c.payment_status === "paid") {
    push("PAGADO", { size: "tall", bold: true, align: "center" });
    push("NO COBRAR", { size: "tall", bold: true, align: "center" });
  } else {
    push(row("A COBRAR:", money(c.total_cents)), { size: "tall", bold: true });
    if (c.payment_method)
      push(`Metodo: ${PAYMENT_LABELS[c.payment_method] ?? c.payment_method}`);
  }
  push(RULE);

  // ── A dónde y para quién ──────────────────────────────────────────────────
  if (c.customer_name)
    for (const l of wrap(`Cliente: ${c.customer_name}`, COLS.sm)) push(l);
  if (c.customer_phone) push(`Tel: ${c.customer_phone}`);
  if (isDelivery && c.delivery_address)
    for (const l of wrap(`Direccion: ${c.delivery_address}`, COLS.sm))
      push(l, { bold: true });
  if (c.delivery_notes)
    for (const l of wrap(`Obs: ${c.delivery_notes}`, COLS.sm)) push(l, { bold: true });

  push(RULE);
  push("DOCUMENTO NO VALIDO", { align: "center" });
  push("COMO FACTURA", { align: "center" });

  return L;
}

/**
 * Contenido pre-renderizado para el agente relay (spec 051, mismo contrato que
 * `buildComandaContent`): ESC/POS en base64 desde latin1 + texto plano.
 *
 * SEGURIDAD: como en `ticket.ts`, este módulo asume que los campos de texto de
 * origen externo (nombre del cliente, dirección, observaciones, nombres de
 * producto) ya vienen saneados de bytes de control por el caller
 * (`sanitizeTicketText` en el endpoint del print-agent).
 */
export function buildControlTicketContent(c: ControlTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildControlTicketLines(c);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
