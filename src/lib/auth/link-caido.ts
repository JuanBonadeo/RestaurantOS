/**
 * A dónde cae alguien cuyo magic link no verificó (spec 171 · D3).
 *
 * El link dura ~1 h. Cuando vence, `/auth/confirm` mandaba a `next` —que es
 * `/{slug}/admin/bienvenida` o `/{slug}/admin`, páginas cerradas— con el error
 * en la query. Sin sesión, el gate rebota al login y se come el parámetro: la
 * persona veía la pantalla de login pelada, sin ninguna explicación de por qué
 * el link que le mandaron no hizo nada.
 *
 * Así que el redirect va derecho al login del negocio, con el slug sacado del
 * propio `next`, y con el motivo.
 */

/** Código, no texto: lo que se pinta lo elige el login, no la URL (D4). */
export const MOTIVO_LINK_VENCIDO = "link_vencido";

export function destinoDeLinkCaido(next: string): string {
  const slug = /^\/([^/]+)\/admin(?:\/|$)/.exec(next)?.[1];
  // Sin negocio en el `next` no hay pantalla de login a la que mandarlo: lo
  // dejamos donde iba en vez de inventar un slug.
  if (!slug) return next;
  return `/${slug}/admin/login?reason=${MOTIVO_LINK_VENCIDO}`;
}
