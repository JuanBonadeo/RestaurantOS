/**
 * Qué modificadores arrastra un producto puesto dentro de un menú del día, y
 * cuáles de esos el combo ya pregunta por su cuenta (spec 148).
 *
 * La spec 083 le dio a los combos una capacidad grande: si el producto elegido
 * tiene `modifier_groups`, el asistente los pregunta sin que el menú declare
 * nada. Lo que nadie previó es que **quien arma el menú no ve eso en ninguna
 * parte**: elige «Milanesa» y no tiene forma de saber que arrastra un grupo
 * «Guarnición» propio. Si además le pone al combo un grupo «Guarnición», el
 * asistente pregunta dos veces — y eso se descubre en el salón, en hora pico,
 * no en el editor.
 *
 * Puro y sin JSX a propósito: la normalización de nombres es la parte
 * delicada —en golf-jcr conviven «Guarnición» y «Guarnicion»— y se testea acá.
 *
 * No prohíbe nada: la mayoría de los pares producto-con-modificador de
 * golf-jcr son legítimos (el Puré trae «Variante», las pastas «Salsa para
 * pasta»). El problema no era la colisión, era que el editor la escondía.
 */

/** Un grupo de modificadores del producto, como lo trae el catálogo. */
export type ProductModifierGroup = {
  id: string;
  name: string;
  is_required: boolean;
  sort_order?: number;
};

export type AvisoModificador = {
  id: string;
  /** El nombre tal como está cargado en el producto. */
  name: string;
  is_required: boolean;
  /**
   * El nombre —tal como está escrito en el combo— del grupo que ya pregunta lo
   * mismo. `null` cuando no se pisa con ninguno.
   */
  duplicaA: string | null;
};

/**
 * Nombre comparable: sin tildes, sin mayúsculas y sin espacios. En golf-jcr el
 * mismo concepto está escrito «Guarnición» en el producto y «Guarnicion» en el
 * combo, y son la misma pregunta hecha dos veces.
 */
export function normalizarNombreDeGrupo(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * Los grupos que el producto va a preguntar dentro del combo, en el orden en
 * que los pregunta, marcando cuáles duplican un grupo del propio menú.
 *
 * `gruposDelCombo` son los nombres de los grupos de opciones del menú — se
 * incluye el grupo al que pertenece la opción: si «Guarnición» ofrece un Puré
 * que a su vez pregunta «Guarnición», también se pregunta dos veces.
 */
export function avisosDeModificadores(
  groups: ProductModifierGroup[] | null | undefined,
  gruposDelCombo: string[] = [],
): AvisoModificador[] {
  // Un grupo sin nombre no puede duplicar nada: si no, dos grupos recién
  // agregados (los dos con el label vacío) darían conflicto entre sí.
  const porNombre = new Map<string, string>();
  for (const nombre of gruposDelCombo) {
    const clave = normalizarNombreDeGrupo(nombre);
    if (clave && !porNombre.has(clave)) porNombre.set(clave, nombre);
  }

  return [...(groups ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((g) => ({
      id: g.id,
      name: g.name,
      is_required: g.is_required,
      duplicaA: porNombre.get(normalizarNombreDeGrupo(g.name)) ?? null,
    }));
}

/**
 * Al revés que `avisosDeModificadores`: dado **un** grupo del combo, con qué
 * grupo del producto se pisa. Es lo que necesita el selector de disparadores
 * del grupo condicional (D3), donde el error se comete: se marca «Guarnición»
 * como condicional y se le eligen 12 productos, tres de los cuales ya traen la
 * suya.
 */
export function grupoQueDuplica(
  groups: ProductModifierGroup[] | null | undefined,
  nombreDelGrupoDelCombo: string,
): string | null {
  const clave = normalizarNombreDeGrupo(nombreDelGrupoDelCombo);
  if (!clave) return null;
  const hit = [...(groups ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .find((g) => normalizarNombreDeGrupo(g.name) === clave);
  return hit?.name ?? null;
}
