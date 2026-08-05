/**
 * Qué grupos de opciones de un menú del día aplican, y si lo que eligió el
 * cliente es legal (spec 074).
 *
 * Puro y sin dependencias: lo usan el asistente del mozo, el formulario de la
 * carta pública y los dos caminos de persistencia (`enviarComanda` y
 * `persist-order`). Una sola implementación — FR-005.
 *
 * El modelo asumía que todos los grupos aplican siempre. No es cierto: los
 * ravioles no llevan guarnición. Cada opción declara en
 * `blocks_choice_group_ids` qué grupos NO aplican si se la elige.
 */

export type ComboChoiceComponent = {
  kind: string;
  choice_group_id: string | null;
  product_id: string | null;
  sort_order: number;
  extra_price_cents: number;
  blocks_choice_group_ids: string[];
};

export type SelectedChoiceRef = {
  choice_group_id: string;
  product_id: string;
};

/** La condición de un grupo, tal como sale de `daily_menu_choice_groups`. */
export type ComboChoiceGroupCondition = {
  id: string;
  applies_when_group_id: string | null;
  applies_when_product_ids: string[];
};

export type ComboChoicesResult =
  | { ok: true; activeGroupIds: string[] }
  | { ok: false; error: string };

/**
 * Los `choice_group_id` del menú, en el orden en que el encargado los definió
 * (`sort_order` del primer componente de cada grupo). El orden **es** la regla:
 * ver `resolveActiveGroupIds`.
 */
export function orderedChoiceGroupIds(
  components: ComboChoiceComponent[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const c of [...components].sort((a, b) => a.sort_order - b.sort_order)) {
    if (c.kind !== "choice" || !c.choice_group_id) continue;
    if (seen.has(c.choice_group_id)) continue;
    seen.add(c.choice_group_id);
    ids.push(c.choice_group_id);
  }
  return ids;
}

/**
 * Grupos que siguen aplicando, dado lo elegido hasta ahora.
 *
 * `blocksBySelectedGroup` mapea cada grupo YA RESUELTO al `blocks_choice_group_ids`
 * de la opción que se eligió en él. Los grupos sin elegir todavía no aportan
 * bloqueos, así que a mitad del asistente los posteriores siguen activos.
 *
 * Es **una pasada hacia adelante**, no un punto fijo iterativo, y eso lo
 * habilita D-GCM-3: una opción sólo puede bloquear grupos POSTERIORES. Al
 * recorrer en orden, cuando llegamos a un grupo ya sabemos si algún grupo
 * anterior *activo* lo sacó del juego. Un bloqueo emitido por un grupo que
 * quedó inactivo nunca se aplica —su elección no existe— y eso resuelve solo
 * el caso encadenado (A saca a B, y la opción de B sacaba a C ⇒ C vuelve).
 *
 * Consecuencia buena: termina siempre y no puede oscilar. Un bloqueo "hacia
 * atrás" (dato viejo o corrupto) simplemente no tiene efecto, en vez de
 * desarmar la resolución.
 */
export function resolveActiveGroupIds(
  orderedGroupIds: string[],
  blocksBySelectedGroup: Map<string, string[]>,
): string[] {
  const active: string[] = [];
  const blocked = new Set<string>();
  for (const groupId of orderedGroupIds) {
    if (blocked.has(groupId)) continue;
    active.push(groupId);
    for (const target of blocksBySelectedGroup.get(groupId) ?? []) {
      // Un grupo no puede bloquearse a sí mismo: sería un paso que se borra al
      // resolverlo, sin salida.
      if (target !== groupId) blocked.add(target);
    }
  }
  return active;
}

/** Lo mínimo que necesita una opción para participar de la regla. */
export type ChoiceOptionLike = {
  product_id: string | null;
  blocks_choice_group_ids: string[];
};

/** Lo mínimo que necesita un grupo. */
export type ChoiceGroupLike = {
  choice_group_id: string;
  options: ChoiceOptionLike[];
  /**
   * Condición del grupo (spec 087): NULL = aplica siempre; si no, el grupo del
   * que depende. `undefined` = el menú no la trae (dato viejo o un caller que
   * todavía no la lee) y se resuelve con el modelo anterior, el `blocks` de la
   * opción.
   */
  applies_when_group_id?: string | null;
  /** Las opciones (por producto) del grupo fuente que habilitan a éste. */
  applies_when_product_ids?: string[];
};

/**
 * Grupos que siguen aplicando con lo elegido hasta ahora, sobre las estructuras
 * agrupadas que usan las dos UIs (el asistente del mozo y el sheet de la carta
 * pública). Genérica en `G` para devolver los mismos objetos que recibió.
 *
 * `groups` tiene que venir en orden de `sort_order` —así los arman `menu.ts` y
 * `daily-menus-query`— porque el orden es la regla de resolución.
 *
 * Los grupos vacíos se descartan: serían un paso sin salida.
 */
export function activeChoiceGroups<G extends ChoiceGroupLike>(
  groups: G[],
  chosenByGroup: Map<string, { product_id: string }>,
): G[] {
  const withOptions = groups.filter((g) => g.options.length > 0);

  // Los que traen la condición del grupo (spec 087) se resuelven con ella; los
  // que no, con el `blocks` de la opción. Conviven mientras dure la transición:
  // la traducción entre las dos formas es exacta, así que un menú da lo mismo
  // por cualquiera de los dos caminos.
  const blocksBySelectedGroup = new Map<string, string[]>();
  for (const group of withOptions) {
    const chosen = chosenByGroup.get(group.choice_group_id);
    if (!chosen) continue;
    const option = group.options.find((o) => o.product_id === chosen.product_id);
    // Si lo elegido ya no está en el grupo (el admin editó el menú con el panel
    // abierto), no aporta bloqueos en vez de romper la resolución.
    if (option) {
      blocksBySelectedGroup.set(
        group.choice_group_id,
        option.blocks_choice_group_ids ?? [],
      );
    }
  }

  // Una sola pasada hacia adelante, igual que antes: cuando llegamos a un grupo
  // ya sabemos si su fuente quedó activa y qué se eligió en ella.
  const activos: G[] = [];
  const activeIds = new Set<string>();
  const bloqueadosPorOpcion = new Set<string>();

  for (const group of withOptions) {
    const condicionado = group.applies_when_group_id != null;

    if (condicionado) {
      const fuente = group.applies_when_group_id as string;
      // Fuente que no aplica ⇒ nunca se va a elegir nada ahí, así que la
      // condición no se puede satisfacer.
      if (!activeIds.has(fuente)) continue;
      const elegido = chosenByGroup.get(fuente);
      // Todavía sin elegir en la fuente: el grupo sigue en pie. Es lo que hace
      // que al abrir el asistente se vean todos los pasos, como siempre.
      if (elegido && !(group.applies_when_product_ids ?? []).includes(elegido.product_id)) {
        continue;
      }
    } else if (bloqueadosPorOpcion.has(group.choice_group_id)) {
      continue;
    }

    activos.push(group);
    activeIds.add(group.choice_group_id);
    for (const target of blocksBySelectedGroup.get(group.choice_group_id) ?? []) {
      // Un grupo no puede bloquearse a sí mismo: sería un paso que se borra al
      // resolverlo, sin salida.
      if (target !== group.choice_group_id) bloqueadosPorOpcion.add(target);
    }
  }

  return activos;
}

/**
 * Borra las elecciones que quedaron en un grupo que ya no aplica (FR-004).
 *
 * Se corre después de cada elección: si se eligió «Milanesa» → «Papas» y
 * después se cambia el principal a «Ravioles», la guarnición se **descarta** en
 * vez de quedar estacionada (D-GCM-4). Es la invariante que hace que el
 * resumen, el precio y el payload sean consistentes sin chequeos extra: nunca
 * hay una elección de un grupo inactivo.
 *
 * Idempotente: una elección inactiva no aporta bloqueos, así que borrarla no
 * cambia qué grupos están activos.
 */
export function pruneBlockedSelections<S extends { product_id: string }>(
  groups: ChoiceGroupLike[],
  selections: Map<string, S>,
): Map<string, S> {
  const activeIds = new Set(
    activeChoiceGroups(groups, selections).map((g) => g.choice_group_id),
  );
  const pruned = new Map<string, S>();
  for (const [groupId, selection] of selections) {
    if (activeIds.has(groupId)) pruned.set(groupId, selection);
  }
  return pruned;
}

/**
 * Valida lo que llegó del cliente contra los componentes leídos de la DB.
 *
 * Tres reglas, en orden de especificidad del mensaje:
 *
 * 1. cada opción elegida existe y pertenece al grupo que dice (ya existía en
 *    `resolveComboUpcharge`);
 * 2. ninguna elección corresponde a un grupo bloqueado por otra elección (la
 *    regla nueva, FR-006);
 * 3. cada grupo **activo** tiene exactamente una elección — esto cierra un
 *    hueco preexistente: D-MDR-4 ("cada grupo requiere una selección") la
 *    sostenía **sólo el cliente**, y como las opciones llevan
 *    `extra_price_cents` (spec 29) un payload armado a mano podía omitir un
 *    grupo caro o mandar dos del mismo. Ver D-GCM-5.
 *
 * Devuelve los grupos activos para que el llamador no los recalcule.
 */
export function validateComboChoices(
  components: ComboChoiceComponent[],
  selectedChoices: SelectedChoiceRef[],
  /**
   * Los grupos con su condición (spec 087). Si vienen, la resolución sale de
   * ellos; si no, del `blocks` de la opción. Es el mismo `activeChoiceGroups`
   * que usan las dos UIs, así que server y cliente no pueden divergir.
   */
  groups?: ComboChoiceGroupCondition[],
): ComboChoicesResult {
  const optionByKey = new Map<string, ComboChoiceComponent>();
  for (const c of components) {
    if (c.kind !== "choice" || !c.choice_group_id || !c.product_id) continue;
    optionByKey.set(`${c.choice_group_id}::${c.product_id}`, c);
  }

  // (1) + duplicados.
  const elegidoPorGrupo = new Map<string, { product_id: string }>();
  for (const sc of selectedChoices) {
    const option = optionByKey.get(`${sc.choice_group_id}::${sc.product_id}`);
    if (!option) {
      return {
        ok: false,
        error: "Una de las opciones elegidas no es válida para este menú.",
      };
    }
    if (elegidoPorGrupo.has(sc.choice_group_id)) {
      return {
        ok: false,
        error: "Hay dos opciones elegidas para el mismo grupo.",
      };
    }
    elegidoPorGrupo.set(sc.choice_group_id, { product_id: sc.product_id });
  }

  const condicionPorGrupo = new Map(
    (groups ?? []).map((g) => [g.id, g] as const),
  );
  const armados: ChoiceGroupLike[] = orderedChoiceGroupIds(components).map(
    (groupId) => {
      const condicion = condicionPorGrupo.get(groupId);
      return {
        choice_group_id: groupId,
        options: components
          .filter((c) => c.kind === "choice" && c.choice_group_id === groupId)
          .map((c) => ({
            product_id: c.product_id,
            blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
          })),
        ...(condicion
          ? {
              applies_when_group_id: condicion.applies_when_group_id,
              applies_when_product_ids: condicion.applies_when_product_ids,
            }
          : {}),
      };
    },
  );

  const activeGroupIds = activeChoiceGroups(armados, elegidoPorGrupo).map(
    (g) => g.choice_group_id,
  );
  const activeSet = new Set(activeGroupIds);

  // (2) elecciones de un grupo que no aplica.
  for (const sc of selectedChoices) {
    if (!activeSet.has(sc.choice_group_id)) {
      return {
        ok: false,
        error:
          "Una de las opciones elegidas no corresponde a este menú con lo que elegiste.",
      };
    }
  }

  // (3) grupos activos sin elegir.
  for (const groupId of activeGroupIds) {
    if (!elegidoPorGrupo.has(groupId)) {
      return { ok: false, error: "Falta elegir una opción del menú." };
    }
  }

  return { ok: true, activeGroupIds };
}
