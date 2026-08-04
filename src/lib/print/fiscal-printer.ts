/**
 * Resolución de la comandera donde sale una factura impresa (spec 084, D3).
 * Lógica pura, sin DB ni I/O: la comparten el action que encola el job y el
 * endpoint del print-agent que lo entrega.
 */

import type { PrinterTarget } from "./cuenta-printer";

export type { PrinterTarget };

export type CajaFiscalPrinter = {
  id: string;
  name: string;
  fiscal_printer_ip?: string | null;
  fiscal_printer_port?: number | null;
  fiscal_printer_enabled?: boolean | null;
};

/**
 * Comandera fiscal de una caja. A diferencia de la cuenta (spec 080), acá **no
 * hay fallback al negocio**: la comandera es por caja porque el papel fiscal
 * tiene que salir donde está parado el que cobra, y mandarlo a otro puesto
 * sería peor que no imprimirlo.
 */
export function resolveFiscalPrinter(
  caja: CajaFiscalPrinter | null,
): PrinterTarget | null {
  if (!caja) return null;
  if (caja.fiscal_printer_enabled === false) return null;
  const ip = caja.fiscal_printer_ip?.trim();
  if (!ip) return null;
  return { ip, port: caja.fiscal_printer_port ?? 9100 };
}
