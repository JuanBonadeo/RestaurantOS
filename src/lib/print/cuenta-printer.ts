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

/**
 * Comandera donde sale el papel del cierre de caja (spec 139 · Parte B).
 *
 * Juan (2026-09-03): *"debería de salir por la misma comandera que por la que
 * salen los tickets para las mesas"*. En los dos locales reales **esa comandera
 * y la de control son la misma máquina** — golf `192.168.100.210`, kcc
 * `192.168.10.210` — así que esto no contradice la D12 original, la precisa.
 *
 * Por qué hay fallback y no basta con la de la cuenta: la cuenta se configura
 * **por salón** (un local con terraza le pone una a cada uno) y un cierre es de
 * una **caja**, no de un salón. En golf la IP está cargada por salón en la
 * cuenta y por negocio en control: sin el fallback, `resolveCuentaPrinter(null,
 * biz)` da `null` y el papel del cierre **no saldría nunca**, en silencio.
 *
 * El orden expresa la intención igual: primero la de la cuenta si el negocio la
 * tiene a nivel local, y si no la de control, que es la misma térmica del
 * mostrador. Un `enabled: false` explícito en la de la cuenta apaga las dos:
 * apagarla y que igual saliera por la otra sería no poder apagarla.
 */
export function resolveCierrePrinter(
  business: {
    cuenta_printer_ip?: string | null;
    cuenta_printer_port?: number | null;
    cuenta_printer_enabled?: boolean | null;
    control_printer_ip?: string | null;
    control_printer_port?: number | null;
    control_printer_enabled?: boolean | null;
  } | null,
): PrinterTarget | null {
  if (business?.cuenta_printer_enabled === false) return null;

  const cuenta = resolveCuentaPrinter(null, business);
  if (cuenta) return cuenta;

  if (business?.control_printer_enabled === false) return null;
  const controlIp = business?.control_printer_ip?.trim();
  if (controlIp) {
    return { ip: controlIp, port: business?.control_printer_port ?? 9100 };
  }

  return null;
}
