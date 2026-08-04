/**
 * Resolución de la comandera donde sale la cuenta de una mesa (spec 080, D2).
 * Lógica pura, sin DB ni I/O: la comparte el action que encola el job con el
 * endpoint del print-agent que lo entrega, así que lo que se le promete al mozo
 * ("sale en la comandera de la terraza") es lo que efectivamente pasa.
 */

export type PrinterTarget = {
  ip: string;
  port: number;
};

/**
 * Comandera donde sale la cuenta de una mesa (spec 080, D2).
 *
 * El salón manda y el negocio es el fallback, para que un local chico configure
 * una sola y ande, y uno con terraza + salón interno le ponga una a cada uno:
 *
 *  1. Salón apagado → **no imprime**. El "off" explícito gana; si cayera al
 *     fallback, apagar la comandera del salón no serviría de nada.
 *  2. Salón con IP → imprime ahí.
 *  3. Salón sin IP → hereda la del negocio (si está prendida).
 *  4. Ninguna → null.
 */
export function resolveCuentaPrinter(
  floorPlan: {
    cuenta_printer_ip?: string | null;
    cuenta_printer_port?: number | null;
    cuenta_printer_enabled?: boolean | null;
  } | null,
  business: {
    cuenta_printer_ip?: string | null;
    cuenta_printer_port?: number | null;
    cuenta_printer_enabled?: boolean | null;
  } | null,
): PrinterTarget | null {
  if (floorPlan?.cuenta_printer_enabled === false) return null;

  const salonIp = floorPlan?.cuenta_printer_ip?.trim();
  if (salonIp) {
    return { ip: salonIp, port: floorPlan?.cuenta_printer_port ?? 9100 };
  }

  if (business?.cuenta_printer_enabled === false) return null;
  const bizIp = business?.cuenta_printer_ip?.trim();
  if (bizIp) {
    return { ip: bizIp, port: business?.cuenta_printer_port ?? 9100 };
  }

  return null;
}
