import type { InvoiceStatus, TipoComprobante } from "./types";

export function formatInvoiceNumber(
  pv: number,
  numero: number | null,
): string {
  // Los comprobantes pending/failed todavía no tienen número fiscal asignado.
  if (numero == null) return `${String(pv).padStart(4, "0")}-—`;
  return `${String(pv).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

const TIPO_LABELS: Record<TipoComprobante, string> = {
  factura_a: "Factura A",
  factura_b: "Factura B",
  nota_credito_a: "NC A",
  nota_credito_b: "NC B",
};

const TIPO_SHORT: Record<TipoComprobante, string> = {
  factura_a: "Fact A",
  factura_b: "Fact B",
  nota_credito_a: "NC A",
  nota_credito_b: "NC B",
};

export function tipoLabel(tipo: TipoComprobante): string {
  return TIPO_LABELS[tipo] ?? tipo;
}

export function tipoShortLabel(tipo: TipoComprobante): string {
  return TIPO_SHORT[tipo] ?? tipo;
}

export type StatusMeta = {
  label: string;
  color: string;
  bg: string;
  dotClass: string;
};

/**
 * Minutos a partir de los cuales una factura `pending` deja de leerse como
 * "está saliendo" y pasa a "demorada" (spec 088).
 *
 * El gateway reintenta con backoff 1→5→15→60 min y sobre los jobs reales tardó
 * ~28 min en promedio hasta el desenlace. A los 10 minutos ya no es normal,
 * pero tampoco está perdida: decirlo evita que alguien la re-emita creyendo
 * que se colgó y termine con dos comprobantes.
 */
export const INVOICE_DEMORADA_MIN = 10;

export function isDemorada(createdAt: string, now: number = Date.now()): boolean {
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t > INVOICE_DEMORADA_MIN * 60_000;
}

export const INVOICE_STATUS_META: Record<InvoiceStatus, StatusMeta> = {
  authorized: { label: "Autorizada", color: "text-emerald-700", bg: "bg-emerald-50 ring-emerald-200/60", dotClass: "bg-emerald-500" },
  failed: { label: "Fallida", color: "text-rose-700", bg: "bg-rose-50 ring-rose-200/60", dotClass: "bg-rose-500" },
  pending: { label: "Pendiente", color: "text-amber-700", bg: "bg-amber-50 ring-amber-200/60", dotClass: "bg-amber-500" },
  cancelled: { label: "Anulada", color: "text-zinc-500", bg: "bg-zinc-50 ring-zinc-200/60", dotClass: "bg-zinc-400" },
};
