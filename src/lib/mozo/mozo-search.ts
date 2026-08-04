/**
 * Búsqueda de mozos por nombre (spec 079). Pura y sin DOM para poder testearla,
 * igual que `product-search.ts`.
 *
 * La usa el modal «Transferir mozo», que lista a todos los miembros que operan
 * salón (mozos + encargados + admins): con el equipo real de golf-house esa
 * lista no entra en pantalla y hay que scrollearla a ciegas en hora pico.
 */

import type { MozoMember } from "./queries";

/** A partir de cuántos candidatos vale la pena mostrar el buscador (FR-002). */
const MOZO_SEARCH_MIN = 7;

/**
 * Minúsculas y sin diacríticos: lo que se tipea en el teléfono casi nunca lleva
 * tilde, y «Román» tiene que aparecer igual. Va en los dos lados de la
 * comparación, así tipearla tampoco falla.
 */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Filtra por nombre. Todos los tokens de la búsqueda tienen que aparecer en el
 * nombre, en cualquier orden — «perez juan» encuentra a «Juan Pérez», que es
 * como uno tipea cuando duda de cuál es el nombre y cuál el apellido.
 *
 * No matchea el rol: se ve en la fila, pero «mozo» es un filtro por categoría,
 * no una búsqueda, y devolvería medio equipo sin que se entienda por qué.
 *
 * Búsqueda vacía → la lista entera (incluido quien no tenga nombre cargado: no
 * lo escondemos, simplemente no hay con qué encontrarlo).
 */
export function filterMozos(mozos: MozoMember[], query: string): MozoMember[] {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return mozos;

  return mozos.filter((m) => {
    const name = normalize(m.full_name ?? "");
    return tokens.every((t) => name.includes(t));
  });
}

/**
 * Con un equipo chico entran todos en pantalla y el input es ruido que empuja
 * la lista hacia abajo — en el modal del mozo, que es un bottom sheet, se nota.
 */
export function shouldShowMozoSearch(candidateCount: number): boolean {
  return candidateCount >= MOZO_SEARCH_MIN;
}
