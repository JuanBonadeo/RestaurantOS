/**
 * Los grupos de opciones de un menú, derivados de los componentes (spec 087).
 *
 * Hasta la migración `0036` el grupo no era una entidad: era un uuid repetido
 * en N filas de `daily_menu_components`, con el nombre denormalizado y la
 * condición escrita al revés (en la opción, en negativo, «qué grupos NO
 * habilita»). Ahora es una fila en `daily_menu_choice_groups`.
 *
 * Mientras el editor siga hablando el modelo viejo, la action mantiene la tabla
 * sincronizada **derivándola** de los componentes en cada guardado. Así el
 * editor actual sigue funcionando y la tabla nunca queda vieja, que es lo que
 * permite que los lectores pasen a usarla sin coordinar un deploy.
 *
 * Es la misma traducción que hizo el backfill de la migración, escrita en TS y
 * testeada: si las dos no coinciden, el menú cambia de comportamiento al
 * guardarlo.
 */

import type { DailyMenuComponentInput } from "./schemas";

export type DerivedChoiceGroup = {
  id: string;
  name: string;
  sort_order: number;
  /** NULL = aplica siempre. */
  applies_when_group_id: string | null;
  /** Las opciones (por producto) del grupo fuente que lo habilitan. */
  applies_when_product_ids: string[];
};

const NOMBRE_POR_DEFECTO = "Elegí una opción";

/**
 * Traduce la lista plana del editor a filas de grupo.
 *
 * El `sort_order` de cada grupo es el índice de su primera opción, igual que el
 * backfill: así los grupos conservan su lugar en el mismo espacio numérico que
 * los componentes sueltos y no hay que renumerar nada.
 *
 * La condición se arma por complemento: si algunas opciones de un grupo P
 * bloquean a G, entonces G aplica cuando en P se eligió **alguna de las otras**.
 * Sólo se traduce cuando P es uno solo y viene antes; con dos fuentes haría
 * falta un AND que este modelo no expresa, y hacia atrás la regla ya era
 * inaplicable en runtime.
 */
/**
 * La inversa: de la condición positiva del grupo al `blocks_choice_group_ids`
 * de cada opción (spec 087).
 *
 * Se sigue escribiendo la columna vieja mientras exista, para que un rollback
 * de código deje los menús funcionando y para que el validador del server —que
 * todavía la lee— siga viendo lo mismo que la UI. Devuelve, por opción (clave
 * `grupo::producto`), qué grupos bloquea.
 */
export function deriveBlocks(
  groups: Pick<
    DerivedChoiceGroup,
    "id" | "applies_when_group_id" | "applies_when_product_ids"
  >[],
  components: DailyMenuComponentInput[],
): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  for (const grupo of groups) {
    const fuente = grupo.applies_when_group_id;
    if (!fuente) continue;
    const habilitan = new Set(grupo.applies_when_product_ids);
    for (const c of components) {
      if (c.kind !== "choice" || c.choice_group_id !== fuente || !c.product_id) {
        continue;
      }
      // Las opciones de la fuente que NO habilitan a este grupo son,
      // exactamente, las que lo bloqueaban en el modelo viejo.
      if (habilitan.has(c.product_id)) continue;
      const key = `${fuente}::${c.product_id}`;
      blocks.set(key, [...(blocks.get(key) ?? []), grupo.id]);
    }
  }
  return blocks;
}

export function deriveChoiceGroups(
  components: DailyMenuComponentInput[],
): DerivedChoiceGroup[] {
  const grupos: DerivedChoiceGroup[] = [];
  const posicion = new Map<string, number>();
  const opcionesPorGrupo = new Map<string, DailyMenuComponentInput[]>();

  components.forEach((c, idx) => {
    if (c.kind !== "choice" || !c.choice_group_id) return;
    const id = c.choice_group_id;
    if (!posicion.has(id)) {
      posicion.set(id, idx);
      grupos.push({
        id,
        name: (c.choice_group_label ?? "").trim() || NOMBRE_POR_DEFECTO,
        sort_order: idx,
        applies_when_group_id: null,
        applies_when_product_ids: [],
      });
    } else if (grupos.find((g) => g.id === id)?.name === NOMBRE_POR_DEFECTO) {
      // La primera opción podía no tener el label cargado; vale el primero que
      // lo tenga (el editor viejo los escribe en todas, pero el dato lo permite).
      const g = grupos.find((x) => x.id === id)!;
      const label = (c.choice_group_label ?? "").trim();
      if (label) g.name = label;
    }
    const arr = opcionesPorGrupo.get(id) ?? [];
    arr.push(c);
    opcionesPorGrupo.set(id, arr);
  });

  for (const grupo of grupos) {
    // Qué grupos bloquean a éste, y desde dónde.
    const fuentes = new Set<string>();
    for (const [fuenteId, opciones] of opcionesPorGrupo) {
      if (fuenteId === grupo.id) continue;
      const bloquea = opciones.some((o) =>
        (o.blocks_choice_group_ids ?? []).includes(grupo.id),
      );
      if (bloquea) fuentes.add(fuenteId);
    }
    if (fuentes.size !== 1) continue;

    const fuenteId = [...fuentes][0];
    const fuentePos = posicion.get(fuenteId) ?? -1;
    if (fuentePos >= grupo.sort_order) continue; // sólo hacia adelante

    const habilitan = (opcionesPorGrupo.get(fuenteId) ?? [])
      .filter((o) => !(o.blocks_choice_group_ids ?? []).includes(grupo.id))
      .map((o) => o.product_id)
      .filter((id): id is string => !!id);

    grupo.applies_when_group_id = fuenteId;
    grupo.applies_when_product_ids = [...new Set(habilitan)];
  }

  return grupos;
}
