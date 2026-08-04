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
export const COLS: Record<Size, number> = { sm: 24, tall: 24, xl: 11 };

// Espaciado lateral por carácter (ESC SP n) ≈ +33% de ancho sin duplicarlo.
const CHAR_RIGHT_SPACING = 4;

// Interlineado (ESC 3 n): más alto = más espaciado y evita que el doble alto se pise.
const LINE_SPACING = 64;

export const RULE = "------------------------"; // 24 col (≈ ancho útil 58mm con el espaciado)

// Renglones en blanco arriba y abajo del bloque de ítems (entre ítem e ítem va
// uno solo). Despega la lista de la línea separadora y del corte del papel.
const EDGE_PADDING = 3;

export const TIMEZONE = "America/Argentina/Buenos_Aires";

export type TicketItem = {
  product_name: string;
  quantity: number;
  notes?: string | null;
  // Post-`.filter(Boolean)` el caller puede tipar esto laxo; en runtime son strings.
  modifiers?: ReadonlyArray<string | null | undefined> | null;
};

/** Lo que el MISMO pedido lleva en otro sector. */
export type TicketSectorHermano = {
  station_name: string;
  items: TicketItem[];
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
  /**
   * `orders.delivery_type`. Ausente ⇒ salón (encabezado «MESA x», el de
   * siempre). Campo aditivo: los fixtures congelados no lo traen.
   */
  delivery_type?: "dine_in" | "delivery" | "pickup" | null;
  /**
   * Con qué combina: los items del mismo pedido que se preparan en OTROS
   * sectores. Sin esto la parrilla no sabe que el entrecot sale con las papas de
   * fritera, y cada sector cocina a destiempo. Campo aditivo.
   */
  otros_sectores?: TicketSectorHermano[] | null;
};

export type Size = "sm" | "tall" | "xl";
export type Align = "left" | "center" | "right";
export type Line = { text: string; size?: Size; bold?: boolean; align?: Align };

// Reemplazos de los caracteres no-ASCII más comunes. La térmica no recibe
// codepage, así que todo lo que pase de 0x7e sale como el símbolo que tenga
// cargado la impresora en su tabla — o sea, basura.
const ASCII_MAP: Record<string, string> = {
  "\u00a0": " ", // nbsp / espacio fino / narrow-nbsp (los mete el formato de hora)
  "\u202f": " ",
  "\u2009": " ",
  "\u2013": "-", // – — ‒ −
  "\u2014": "-",
  "\u2012": "-",
  "\u2212": "-",
  "\u201c": '"', // “ ” „ « »
  "\u201d": '"',
  "\u201e": '"',
  "\u00ab": '"',
  "\u00bb": '"',
  "\u2018": "'", // ‘ ’ ‚
  "\u2019": "'",
  "\u201a": "'",
  "\u2026": "...",
  "\u2022": "*", // •
  "\u00b7": "-", // ·
  "\u00b0": "o", // ° º ª
  "\u00ba": "o",
  "\u00aa": "a",
  "\u00bf": "", // ¿ ¡
  "\u00a1": "",
  "\u20ac": "EUR",
  "\u00d7": "x",
  "\u00df": "ss",
  "\u00c6": "AE",
  "\u00e6": "ae",
  "\u0152": "OE",
  "\u0153": "oe",
  "\u00d8": "O",
  "\u00f8": "o",
};

/**
 * Deja el texto en ASCII imprimible: traduce los símbolos del mapa, saca
 * tildes y diéresis vía NFD (Ñoquis → Noquis, Café → Cafe) y descarta
 * cualquier resto fuera de 0x20–0x7e (emoji, alfabetos no latinos).
 */
export function toAscii(text: string): string {
  return String(text)
    .replace(/[^\x20-\x7e]/g, (ch) => ASCII_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacríticos sueltos que dejó el NFD
    .replace(/[^\x20-\x7e]/g, "");
}

/**
 * Corta `text` por palabra a `cols` columnas. Una palabra más larga que el
 * ancho se parte a lo bruto (mejor cortada que desbordada). Devuelve al menos
 * una línea para no perder el renglón.
 */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = "";
  // Se traduce acá también (es idempotente con el `push`): algunos reemplazos
  // cambian el largo (… → ...), así que hay que contar los caracteres finales.
  for (const word of toAscii(text).split(/\s+/).filter(Boolean)) {
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
  // Todo el texto del ticket pasa por `toAscii`: la térmica solo imprime ASCII.
  const push = (text: string, opts: Omit<Line, "text"> = {}) =>
    L.push({ text: toAscii(text), ...opts });
  const pad = (n: number) => {
    for (let i = 0; i < n; i++) push("");
  };

  // Los avisos y el encabezado van en el tamaño más grande (doble alto Y doble
  // ancho, wrap a `COLS.xl`): son lo que la cocina lee de lejos, antes de
  // acercarse al papel. Los `***` se sacaron — a doble ancho no entran en el
  // renglón y el texto solo ya grita bastante.
  const banner = (text: string) => {
    for (const l of wrap(text, COLS.xl)) push(l, { size: "xl", bold: true, align: "center" });
  };

  // Spec 049: comanda anulada → ticket ANULADA destacado para que cocina
  // descarte lo que ya tenía impreso.
  if (c.cancelled) {
    banner("ANULADA");
    push(RULE);
  } else if (c.reprint) {
    // Spec 35: reimpresión (por editar o reimprimir manual). Aviso a cocina de
    // que este ticket reemplaza a uno ya impreso, para que no prepare dos veces.
    banner("REIMPRESION");
    push("reemplaza al anterior", { size: "tall", bold: true, align: "center" });
    push(RULE);
  }

  // Sector / estación + destino: lo primero que lee la cocina, bien grande.
  banner(String(c.station_name).toUpperCase());
  // El destino manda: un pedido de delivery no tiene mesa (salía «MESA —») y la
  // cocina necesita ver de una que ese plato se lo lleva el repartidor, no un
  // mozo al salón. `dine_in` / ausente = comportamiento de siempre.
  // Los subtítulos van cortos a propósito: entran en un renglón de `COLS.tall`
  // (24 col). «pasa a buscarlo el cliente» son 26 y salía partido, con un «te»
  // suelto y centrado en doble alto.
  const subtitulo = (text: string) => {
    for (const l of wrap(text, COLS.tall))
      push(l, { size: "tall", bold: true, align: "center" });
  };
  if (c.delivery_type === "delivery") {
    banner("DELIVERY");
    subtitulo("lo lleva el repartidor");
  } else if (c.delivery_type === "pickup") {
    banner("RETIRA");
    subtitulo("lo retira el cliente");
  } else if (!c.table_label || c.table_label === "—" || c.table_label === "-") {
    // Venta de mostrador: se persiste `dine_in` SIN mesa (venta-mostrador.ts),
    // así que caía en el else y salía «MESA —».
    banner("MOSTRADOR");
  } else {
    banner(`MESA ${c.table_label}`);
  }
  push(`Tanda ${c.batch}`, { size: "tall", bold: true, align: "center" });

  // Metadata de referencia (no operativa): la más chica del ticket, pero igual
  // en doble alto — nada sale en cuerpo normal salvo las líneas separadoras.
  push(`Comanda #${String(c.comanda_id).slice(0, 8)}`, { size: "tall" });
  try {
    push(new Date(c.emitted_at).toLocaleString("es-AR", { timeZone: TIMEZONE }), {
      size: "tall",
    });
  } catch {
    /* fecha opcional */
  }
  if (c.cancelled && c.cancelled_reason)
    for (const l of wrap(`Motivo: ${c.cancelled_reason}`, COLS.tall))
      push(l, { size: "tall", bold: true });

  push(RULE);
  pad(EDGE_PADDING); // aire entre la línea y el primer ítem

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
  if (items.length === 0) banner("(sin items)");

  // ── Con qué combina ──────────────────────────────────────────────────────
  // Los items del mismo pedido que salen de otros sectores. Es referencia, no
  // trabajo de este sector: va en `tall` (no `xl`) y con sangría, para que no
  // compita con la lista de arriba. En una comanda anulada no se imprime — no
  // hay nada que coordinar.
  const otros = (c.otros_sectores ?? []).filter((s) => s.items.length > 0);
  if (otros.length > 0 && !c.cancelled) {
    pad(1);
    push(RULE);
    push("COMBINA CON", { size: "tall", bold: true, align: "center" });
    for (const sector of otros) {
      for (const l of wrap(String(sector.station_name).toUpperCase(), COLS.tall))
        push(l, { size: "tall", bold: true });
      for (const it of sector.items)
        for (const l of wrap(`- ${it.quantity}x ${it.product_name}`, COLS.tall))
          push(l, { size: "tall" });
    }
  }

  pad(EDGE_PADDING); // aire entre el último ítem y el corte (o la línea del pie)

  if (c.cancelled) {
    push(RULE);
    banner("NO PREPARAR");
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
  // Init final: DEJAR LA IMPRESORA COMO ESTABA. `ESC 3` (interlineado) y
  // `ESC SP` (espaciado lateral) son estados que quedan pegados en la comandera
  // después del corte, así que el siguiente que imprima los hereda. En golf la
  // misma comandera la comparte MaxiRest, que no manda `ESC @` al empezar: sus
  // tickets salían con nuestro interlineado y nuestro ancho. Con esto, cada job
  // devuelve la impresora a fábrica al terminar.
  out += ESC + "@";
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
