// Render del ticket de comanda — spec 051 (print-agent como relay).
//
// Portado 1:1 desde `print-agent/agent.mjs` (las 3 funciones puras de formato)
// para que el "qué/cómo imprimir" viva en el server y un cambio de formato sea
// solo un deploy de Vercel, sin recompilar ni re-descargar el .exe. El agente
// pasa a imprimir los bytes que este módulo produce; conserva su copia local
// solo como fallback (ver plan 051, D1-D5).
//
// PARIDAD: este módulo DEBE producir exactamente los mismos bytes que el agente
// imprime hoy en golf (test de paridad en `ticket.test.ts` contra fixtures
// congelados). Única desviación intencional del código del agente: la fecha se
// formatea con `timeZone` explícito America/Argentina/Buenos_Aires (constitución
// + necesario para que el server, que corre en UTC, produzca la MISMA hora local
// que la PC de golf; en golf, que ya está en AR, el resultado es idéntico).
//
// NOTA (bug pre-existente, follow-up): `toLocaleString("es-AR")` usa reloj de
// 12h y muestra 18:30 como "06:30" (ambiguo). Se preserva por paridad; el fix
// (`hour12: false`) es un cambio server-only trivial una vez desacoplado — el
// payoff de esta spec. No se toca acá para no mezclar arreglo de formato con el
// desacople.

const ESC = "\x1b";
const GS = "\x1d";

// Tamaño de carácter (GS ! n): nibble alto = ancho, nibble bajo = alto.
//   sm   → normal          tall → doble alto (0x01)
//   xl   → doble alto Y doble ancho (0x11), reservado para los ítems.
const CHAR_SIZE: Record<Size, string> = { sm: "\x00", tall: "\x01", xl: "\x11" };

// Ancho útil en columnas por tamaño (58mm ≈ 384 pt de ancho de cabezal).
// Celda Font A = 12 pt + CHAR_RIGHT_SPACING → 16 pt ⇒ 24 col. En doble ancho la
// celda y el espaciado se duplican (24 + 8 = 32 pt) ⇒ 12 col; usamos 11 para
// dejar margen. Se usa para cortar por palabra en vez de que la impresora parta
// el nombre del producto a la mitad.
const COLS: Record<Size, number> = { sm: 24, tall: 24, xl: 11 };

// Espaciado lateral por carácter (ESC SP n) ≈ +33% de ancho sin duplicarlo.
const CHAR_RIGHT_SPACING = 4;

// Interlineado (ESC 3 n): más alto = más espaciado y evita que el doble alto se pise.
const LINE_SPACING = 64;

const RULE = "------------------------"; // 24 col (≈ ancho útil 58mm con el espaciado)

const TIMEZONE = "America/Argentina/Buenos_Aires";

export type TicketItem = {
  product_name: string;
  quantity: number;
  notes?: string | null;
  // Post-`.filter(Boolean)` el caller puede tipar esto laxo; en runtime son strings.
  modifiers?: ReadonlyArray<string | null | undefined> | null;
};

export type TicketComanda = {
  comanda_id: string;
  station_name: string;
  table_label: string;
  batch: number | string;
  emitted_at: string;
  cancelled?: boolean;
  cancelled_reason?: string | null;
  reprint?: boolean;
  items?: TicketItem[] | null;
};

type Size = "sm" | "tall" | "xl";
type Align = "left" | "center" | "right";
type Line = { text: string; size?: Size; bold?: boolean; align?: Align };

/**
 * Corta `text` por palabra a `cols` columnas. Una palabra más larga que el
 * ancho se parte a lo bruto (mejor cortada que desbordada). Devuelve al menos
 * una línea para no perder el renglón.
 */
function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > cols) {
      if (line) {
        out.push(line);
        line = "";
      }
      out.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!w) continue;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= cols) line += ` ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Arma el ticket como líneas con formato (tamaño/negrita/alineación). */
export function buildTicketLines(c: TicketComanda): Line[] {
  const L: Line[] = [];
  const push = (text: string, opts: Omit<Line, "text"> = {}) => L.push({ text, ...opts });

  // Spec 049: comanda anulada → ticket ANULADA destacado para que cocina
  // descarte lo que ya tenía impreso.
  if (c.cancelled) {
    push("*** ANULADA ***", { size: "tall", bold: true, align: "center" });
    push(RULE);
  } else if (c.reprint) {
    // Spec 35: reimpresión (por editar o reimprimir manual). Aviso a cocina de
    // que este ticket reemplaza a uno ya impreso, para que no prepare dos veces.
    push("*** REIMPRESION ***", { size: "tall", bold: true, align: "center" });
    push("reemplaza al anterior", { size: "sm", bold: true, align: "center" });
    push(RULE);
  }

  // Sector / estación + mesa: lo primero que lee la cocina, bien grande.
  push(String(c.station_name).toUpperCase(), { size: "tall", bold: true, align: "center" });
  push(`MESA ${c.table_label}`, { size: "tall", bold: true, align: "center" });
  push(`Tanda ${c.batch}`, { size: "sm", bold: true, align: "center" });

  // Metadata chica (referencia, no operativa).
  push(`Comanda #${String(c.comanda_id).slice(0, 8)}`);
  try {
    push(new Date(c.emitted_at).toLocaleString("es-AR", { timeZone: TIMEZONE }));
  } catch {
    /* fecha opcional */
  }
  if (c.cancelled && c.cancelled_reason) push(`Motivo: ${c.cancelled_reason}`, { bold: true });

  push(RULE);
  push(""); // aire entre el encabezado y el primer ítem

  // Ítems: el corazón de la comanda. Doble alto Y doble ancho, con un renglón
  // en blanco entre ítem e ítem — la cocina los lee de lejos y de un vistazo,
  // así que se prioriza legibilidad sobre ahorro de papel.
  const items = c.items ?? [];
  items.forEach((it, i) => {
    if (i > 0) push(""); // padding entre ítems
    const prefix = c.cancelled ? "ANULADO " : "";
    for (const l of wrap(`${prefix}${it.quantity}x ${it.product_name}`, COLS.xl))
      push(l, { size: "xl", bold: true });
    if (it.modifiers && it.modifiers.length)
      for (const l of wrap(`+ ${it.modifiers.join(", ")}`, COLS.tall)) push(l, { size: "tall" });
    if (it.notes)
      for (const l of wrap(`obs: ${it.notes}`, COLS.tall)) push(l, { size: "tall", bold: true });
  });
  if (items.length === 0) push("(sin items)");

  if (c.cancelled) {
    push(RULE);
    push("*** NO PREPARAR ***", { size: "tall", bold: true, align: "center" });
  }
  return L;
}

/** Renderiza las líneas como ESC/POS para térmica de red (producción). */
export function renderEscPos(lines: Line[]): string {
  let out = ESC + "@"; // init (resetea tamaño, énfasis, interlineado y espaciado)
  out += ESC + "3" + String.fromCharCode(LINE_SPACING); // interlineado espaciado
  out += ESC + " " + String.fromCharCode(CHAR_RIGHT_SPACING); // ancho extra (ESC SP)
  let align: Align | null = null;
  let size: Size | null = null;
  let bold: boolean | null = null;
  for (const ln of lines) {
    const a: Align = ln.align ?? "left";
    const s: Size = ln.size ?? "sm";
    const b = ln.bold ?? false;
    if (a !== align) {
      out += ESC + "a" + (a === "center" ? "\x01" : a === "right" ? "\x02" : "\x00");
      align = a;
    }
    if (s !== size) {
      out += GS + "!" + CHAR_SIZE[s];
      size = s;
    }
    if (b !== bold) {
      out += ESC + "E" + (b ? "\x01" : "\x00");
      bold = b;
    }
    out += (ln.text ?? "") + "\n";
  }
  // Reset de estilo + avance + corte parcial.
  out += GS + "!" + "\x00" + ESC + "E" + "\x00" + ESC + "a" + "\x00";
  out += "\n\n\n" + GS + "V" + "\x00";
  return out;
}

/** Renderiza las líneas como texto plano (transporte windows / dry-run). */
export function renderPlain(lines: Line[]): string {
  return lines.map((ln) => ln.text ?? "").join("\r\n") + "\r\n\r\n";
}

/**
 * SEGURIDAD: este módulo asume que los campos de texto (station_name, notes,
 * product_name, etc.) ya vienen **saneados** de bytes de control por el caller
 * (el `GET /api/print-agent` los pasa por `sanitizeTicketText`, security review
 * #8). Acá se agregan los códigos ESC/POS de confianza; no se re-sanea.
 *
 * Contenido pre-renderizado que el server manda al agente relay (spec 051, D1):
 * - `escpos_b64`: los bytes ESC/POS (los mismos que `renderEscPos`) en base64
 *   desde `latin1`, para viajar en JSON. El relay hace `Buffer.from(b64,'base64')`
 *   y los escribe al socket tal cual.
 * - `plain`: el texto de `renderPlain` para el transporte windows / dry-run.
 */
export function buildComandaContent(c: TicketComanda): {
  escpos_b64: string;
  plain: string;
} {
  const lines = buildTicketLines(c);
  return {
    escpos_b64: Buffer.from(renderEscPos(lines), "latin1").toString("base64"),
    plain: renderPlain(lines),
  };
}
