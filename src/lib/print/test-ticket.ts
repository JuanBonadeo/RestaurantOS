// El papel de prueba de una comandera — spec 176.
//
// Es el ticket más chico del sistema y el único que no habla de un pedido: sólo
// tiene que salir. Lo que imprime es lo que hace falta para saber, con el papel
// en la mano y cuatro comanderas alrededor, CUÁL de todas lo escupió: el nombre
// que tiene en Ajustes, la IP a la que se mandó y la hora.
//
// Mismo perfil que la comanda (Font A, 24 col): la prueba tiene que salir con
// la misma tipografía y el mismo ancho que va a tener el ticket real, o no
// prueba nada — un papel condensado que sale bien no garantiza que la comanda
// entre a lo ancho del cabezal.

import {
  COLS,
  RULE,
  TIMEZONE,
  renderEscPos,
  renderPlain,
  toAscii,
  wrap,
  type Line,
} from "./ticket";

export type TestTicketData = {
  /** Cómo se llama esta comandera en Ajustes: «Parrilla», «Cuentas · Terraza». */
  label: string;
  /** El destino al que se mandó, tal cual lo tipeó el encargado. */
  printer_ip: string;
  printer_port: number;
  /** ISO. Cuándo se pidió la prueba. */
  emitted_at: string;
  business_name: string;
  /** Quién apretó el botón. Se omite si no se pudo resolver el nombre. */
  requested_by_name?: string | null;
};

function horaLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function buildTestTicketLines(d: TestTicketData): Line[] {
  const L: Line[] = [];
  const push = (text: string, opts: Omit<Line, "text"> = {}) =>
    L.push({ text: toAscii(text), ...opts });

  for (const l of wrap("PRUEBA", COLS.xl))
    push(l, { size: "xl", bold: true, align: "center" });
  push(RULE);

  // El nombre de la comandera va grande: es el dato que se lee de lejos cuando
  // se están probando cuatro y hay que emparejar papel con impresora.
  for (const l of wrap(d.label, COLS.tall))
    push(l, { size: "tall", bold: true, align: "center" });
  push("");
  push(`${d.printer_ip}:${d.printer_port}`, { align: "center" });
  push(RULE);

  // La frase entera, en el ancho real del ticket: si la comandera parte una
  // palabra o se come el final del renglón, se ve acá y no en hora pico.
  for (const l of wrap("Si estas leyendo esto, la comandera imprime bien.", COLS.sm))
    push(l);
  push("");
  for (const l of wrap(d.business_name, COLS.sm)) push(l);
  push(horaLocal(d.emitted_at));
  if (d.requested_by_name?.trim()) {
    for (const l of wrap(`Pidio: ${d.requested_by_name.trim()}`, COLS.sm))
      push(l);
  }
  return L;
}

export function buildTestTicketContent(d: TestTicketData): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildTestTicketLines(d);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
