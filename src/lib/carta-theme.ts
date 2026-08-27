/**
 * Tema de la carta visual del QR de mesa (`/[slug]/carta`, spec 44).
 *
 * La spec 44 migró la identidad de golf-house tal cual estaba en su menufacil,
 * pero hardcodeada. Spec 129 la mueve a `businesses.settings.carta`: es
 * presentación pura, así que no hace falta tabla ni migración — `settings` ya
 * es jsonb.
 *
 * **El default es el Golf.** Un negocio sin `settings.carta` ve exactamente lo
 * que veía antes, y el merge es por campo: un tenant puede cambiar sólo el
 * color y heredar el resto del arte.
 *
 * Las URLs pueden ser rutas de `public/` (`/carta/kcc/wordmark.svg`, que es lo
 * que se usa hoy) o absolutas — el `<Image unoptimized>` sirve las dos, así que
 * el día que haya UI de admin + Storage sólo cambia el origen del string.
 */

/** Script dorado (Golf) o serif itálica (KCC). Las fuentes se cargan con
 *  `next/font` en `app/layout.tsx`, así que el set es cerrado a propósito. */
export type CartaTitleStyle = "script" | "serif-italic";
export type CartaBodyStyle = "sans" | "serif";

export type CartaTheme = {
  /** Fondo del cover a pantalla. */
  cover_bg: string;
  /** Textura sobre el fondo del cover (lino, papel). */
  cover_texture_url: string | null;
  /** Velo oscuro sobre la textura: hace legible el wordmark sobre una foto o
   *  un lino claro. Sobre un color plano tapa el color, así que va apagado. */
  cover_scrim: boolean;
  /** Silueta detrás del wordmark (el golfista). Sin figura, el wordmark se
   *  centra solo a su tamaño natural. */
  figure_url: string | null;
  wordmark_url: string | null;
  /** ancho/alto del wordmark, para reservar su espacio sin salto de layout. */
  wordmark_ratio: number;
  /** Versalitas bajo el wordmark («RESTAURANTE»). */
  label: string | null;

  /** Fondo del menú. */
  paper: string;
  paper_texture_url: string | null;
  ink: string;
  ink_2: string;
  /** Líderes punteados, estado «abierto», acentos. */
  accent: string;
  /** Cenefa bajo el título de sección. Sin ornamento no se dibuja el hueco. */
  ornament_url: string | null;

  title_style: CartaTitleStyle;
  body_style: CartaBodyStyle;
};

/** Identidad de golf-house (spec 44). Default para todo negocio sin tema. */
export const CARTA_THEME_GOLF: CartaTheme = {
  cover_bg: "#2b2f38",
  cover_texture_url: "/carta/golf/linen.png",
  cover_scrim: true,
  figure_url: "/carta/golf/golfista.svg",
  wordmark_url: "/carta/golf/wordmark-blanco.svg",
  wordmark_ratio: 333 / 88,
  label: "RESTAURANTE",

  paper: "#ffffff",
  paper_texture_url: null,
  ink: "#333333",
  ink_2: "#6b6b6b",
  accent: "#b0956b",
  ornament_url: "/carta/golf/ornamento.svg",

  title_style: "script",
  body_style: "sans",
};

const TITLE_STYLES: readonly CartaTitleStyle[] = ["script", "serif-italic"];
const BODY_STYLES: readonly CartaBodyStyle[] = ["sans", "serif"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
/** `null` explícito significa «esta pieza no va» (KCC no tiene ornamento), y hay
 *  que distinguirlo de «no configurado», que hereda el Golf. */
function nullableStr(v: unknown, fallback: string | null): string | null {
  if (v === null) return null;
  return str(v) ?? fallback;
}

/**
 * Merge de `settings.carta` sobre el default del Golf, campo por campo.
 *
 * `settings` es jsonb sin validar, así que cada campo se chequea por tipo: un
 * valor basura hereda el default en vez de romper la carta del comensal.
 */
export function resolveCartaTheme(settings: unknown): CartaTheme {
  const raw = (settings as { carta?: unknown } | null)?.carta;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return CARTA_THEME_GOLF;
  }
  const c = raw as Record<string, unknown>;
  const d = CARTA_THEME_GOLF;

  const ratio = typeof c.wordmark_ratio === "number" && c.wordmark_ratio > 0
    ? c.wordmark_ratio
    : d.wordmark_ratio;

  return {
    cover_bg: str(c.cover_bg) ?? d.cover_bg,
    cover_texture_url: nullableStr(c.cover_texture_url, d.cover_texture_url),
    cover_scrim:
      typeof c.cover_scrim === "boolean" ? c.cover_scrim : d.cover_scrim,
    figure_url: nullableStr(c.figure_url, d.figure_url),
    wordmark_url: nullableStr(c.wordmark_url, d.wordmark_url),
    wordmark_ratio: ratio,
    label: nullableStr(c.label, d.label),

    paper: str(c.paper) ?? d.paper,
    paper_texture_url: nullableStr(c.paper_texture_url, d.paper_texture_url),
    ink: str(c.ink) ?? d.ink,
    ink_2: str(c.ink_2) ?? d.ink_2,
    accent: str(c.accent) ?? d.accent,
    ornament_url: nullableStr(c.ornament_url, d.ornament_url),

    title_style: TITLE_STYLES.includes(c.title_style as CartaTitleStyle)
      ? (c.title_style as CartaTitleStyle)
      : d.title_style,
    body_style: BODY_STYLES.includes(c.body_style as CartaBodyStyle)
      ? (c.body_style as CartaBodyStyle)
      : d.body_style,
  };
}
