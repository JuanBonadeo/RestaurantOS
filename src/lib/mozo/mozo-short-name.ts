/**
 * Cómo se llama un mozo en el plano del salón.
 *
 * En la mesa entra un nombre, no un legajo: el encargado mira el plano y quiere
 * leer «Juan», no descifrar «JB» contra una leyenda de colores. Sólo cuando dos
 * mozos comparten el nombre de pila hace falta más, y ahí se agrega la inicial
 * del apellido con punto —«Juan B.» / «Juan C.»—, que es exactamente como se
 * los nombra en el salón.
 *
 * El desempate es **progresivo y por grupo**: agrega lo mínimo necesario para
 * que dos mozos no se llamen igual. Si hay un solo Juan dice «Juan», aunque el
 * apellido esté cargado.
 */

export type MozoLike = { user_id: string; full_name?: string | null };

/**
 * Escalones de desempate. Se sube uno sólo si el anterior dejó a dos mozos con
 * el mismo rótulo:
 *
 *   0 → «Juan»            1 → «Juan B.»
 *   2 → «Juan B. P.»      3 → «Juan Bonadeo Pérez» (y si igual coinciden, es
 *                             que son dos nombres idénticos: no hay más que
 *                             hacer sin inventar datos)
 */
const MAX_LEVEL = 3;

type Entry = { user_id: string; parts: string[] };

function words(fullName: string): string[] {
  return fullName.trim().split(/\s+/).filter(Boolean);
}

/**
 * Arregla el grito («JUAN») y el todo-minúscula («juan») que deja un alta
 * apurada, sin tocar el mixto: «McDonald» o «DiPaolo» los escribió alguien así
 * a propósito.
 */
function pretty(word: string): string {
  const grito = word === word.toUpperCase();
  const plano = word === word.toLowerCase();
  if (!grito && !plano) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Inicial con punto, siempre en mayúscula: «bonadeo» → «B.». */
function initial(word: string): string {
  return `${word.charAt(0).toUpperCase()}.`;
}

function labelAt(parts: string[], level: number): string {
  const first = pretty(parts[0]);
  const rest = parts.slice(1);
  // Sin apellido cargado no hay con qué desempatar: se queda en el nombre.
  if (level <= 0 || rest.length === 0) return first;
  if (level === 1) return `${first} ${initial(rest[0])}`;
  if (level === 2) return `${first} ${rest.map(initial).join(" ")}`;
  return [first, ...rest.map(pretty)].join(" ");
}

/**
 * Reparte rótulos dentro de un grupo que ya viene empatado. Cada subgrupo que
 * queda solo se queda con el rótulo de este nivel; el que sigue empatado baja
 * un escalón más. Nunca se cruzan grupos distintos: todos los de acá comparten
 * el mismo rótulo del nivel anterior.
 */
function assign(
  entries: Entry[],
  level: number,
  out: Map<string, string>,
): void {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const label = labelAt(e.parts, level);
    const g = groups.get(label);
    if (g) g.push(e);
    else groups.set(label, [e]);
  }
  for (const [label, group] of groups) {
    if (group.length === 1 || level >= MAX_LEVEL) {
      for (const e of group) out.set(e.user_id, label);
      continue;
    }
    assign(group, level + 1, out);
  }
}

/**
 * `user_id` → cómo se rotula ese mozo en el plano.
 *
 * Los mozos sin nombre cargado quedan **afuera** del mapa: mejor una mesa sin
 * rótulo que una que diga «?».
 *
 * Se calcula sobre el equipo completo del negocio (no sobre los que hoy tienen
 * mesas), así el rótulo de un mozo no cambia a mitad del turno porque el otro
 * Juan se quedó sin mesas.
 */
export function buildMozoShortNames(mozos: MozoLike[]): Map<string, string> {
  const vistos = new Set<string>();
  const entries: Entry[] = [];
  for (const m of mozos) {
    if (vistos.has(m.user_id)) continue;
    const parts = words(m.full_name ?? "");
    if (parts.length === 0) continue;
    vistos.add(m.user_id);
    entries.push({ user_id: m.user_id, parts });
  }
  const out = new Map<string, string>();
  assign(entries, 0, out);
  return out;
}
