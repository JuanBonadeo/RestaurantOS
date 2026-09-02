/**
 * Paleta determinística para mozos. Compartida entre el overlay de
 * distribución, el plano del salón (dot SVG) y los chips de mozo del drawer
 * de la mesa.
 *
 * Diseño: 8 colores curados de la paleta Tailwind (sky, indigo, violet,
 * fuchsia, pink, cyan, blue, purple) — TODOS cool / cool-warm. Se evitan
 * deliberadamente:
 *   - Verde / esmeralda → es el color del estado "ocupada".
 *   - Amber → es el color del estado "pidio_cuenta".
 *   - Zinc → es el color del estado "libre".
 *   - Rose / red → reservado para danger / cancelado.
 *
 * Resultado: el color de un mozo nunca se confunde con un estado de mesa.
 */

export type MozoPalette = {
  /** Color CSS string — para fills/strokes en SVG y estilos inline. */
  solid: string;
  /** Tailwind class para fondo sólido del dot/avatar (bg-sky-500). */
  dot: string;
  /** Background suave para chip (bg-sky-100). */
  bg: string;
  /** Color de texto sobre `bg` (text-sky-800). */
  text: string;
  /** Ring class para chip outline (ring-sky-300). */
  ring: string;
  /**
   * Variante oscura (nivel 700) del mismo color, para TEXTO sobre fondo claro:
   * el nombre del mozo debajo de la mesa en el plano. El `solid` es un 500 —
   * alcanza para un punto o un relleno, no para una letra chica.
   */
  ink: string;
};

const MOZO_PALETTES: MozoPalette[] = [
  {
    solid: "#0ea5e9",
    dot: "bg-sky-500",
    bg: "bg-sky-100",
    text: "text-sky-800",
    ring: "ring-sky-300",
    ink: "#0369a1",
  },
  {
    solid: "#6366f1",
    dot: "bg-indigo-500",
    bg: "bg-indigo-100",
    text: "text-indigo-800",
    ring: "ring-indigo-300",
    ink: "#4338ca",
  },
  {
    solid: "#8b5cf6",
    dot: "bg-violet-500",
    bg: "bg-violet-100",
    text: "text-violet-800",
    ring: "ring-violet-300",
    ink: "#6d28d9",
  },
  {
    solid: "#d946ef",
    dot: "bg-fuchsia-500",
    bg: "bg-fuchsia-100",
    text: "text-fuchsia-800",
    ring: "ring-fuchsia-300",
    ink: "#a21caf",
  },
  {
    solid: "#ec4899",
    dot: "bg-pink-500",
    bg: "bg-pink-100",
    text: "text-pink-800",
    ring: "ring-pink-300",
    ink: "#be185d",
  },
  {
    solid: "#06b6d4",
    dot: "bg-cyan-500",
    bg: "bg-cyan-100",
    text: "text-cyan-800",
    ring: "ring-cyan-300",
    ink: "#0e7490",
  },
  {
    solid: "#3b82f6",
    dot: "bg-blue-500",
    bg: "bg-blue-100",
    text: "text-blue-800",
    ring: "ring-blue-300",
    ink: "#1d4ed8",
  },
  {
    solid: "#a855f7",
    dot: "bg-purple-500",
    bg: "bg-purple-100",
    text: "text-purple-800",
    ring: "ring-purple-300",
    ink: "#7e22ce",
  },
];

function hashUserId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function mozoPalette(userId: string): MozoPalette {
  const h = hashUserId(userId);
  return MOZO_PALETTES[h % MOZO_PALETTES.length];
}

/**
 * Back-compat: consumidores SVG (floor-plan-viewer, asignar-mozos-panel)
 * pasan colores como strings inline. Devolvemos el `solid` del palette
 * para que automáticamente migren a la paleta curada.
 */
export function mozoColor(userId: string): string {
  return mozoPalette(userId).solid;
}

/**
 * Color del NOMBRE del mozo en el plano. Mismo color que su punto en la
 * leyenda, dos escalones más oscuro para que una letra chica se lea sobre el
 * fondo del salón.
 */
export function mozoInkColor(userId: string): string {
  return mozoPalette(userId).ink;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
