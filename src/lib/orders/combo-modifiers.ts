/**
 * Modificadores del producto elegido dentro de un menú del día (spec 083).
 *
 * Cargando unos ñoquis **sueltos** el mozo ya elige la salsa: el producto tiene
 * `modifier_groups` y el `ProductModal` los pregunta, valida y persiste. Dentro
 * del combo no preguntaba nada — `modifier_ids` viajaba vacío y nadie lo leía,
 * pese a que D-MDR-2 lo daba por hecho desde el principio.
 *
 * Puro y sin dependencias, como `combo-choices`: lo usan el asistente del mozo,
 * el sheet de la carta pública y los dos caminos de persistencia. La regla de
 * qué se pregunta y cuánto suma se escribe **una sola vez** (FR-007).
 *
 * Invariante de plata (spec 29): el delta se suma al ítem **padre** del combo y
 * los hijos siguen en $0. Y el precio se re-deriva siempre de la DB — el
 * cliente informa QUÉ eligió, nunca CUÁNTO sale.
 */

export type ComboModifier = {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
  sort_order: number;
};

export type ComboModifierGroup = {
  id: string;
  name: string;
  is_required: boolean;
  min_selection: number;
  max_selection: number;
  sort_order: number;
  modifiers: ComboModifier[];
};

export type ModifiersResult =
  | { ok: true; deltaCents: number; chosen: ComboModifier[] }
  | { ok: false; error: string };

/**
 * Grupos que hay que preguntar por una opción elegida, en orden.
 *
 * Se descartan los que quedaron sin modificadores disponibles: serían un paso
 * sin salida, igual que un `choice_group` vacío en `activeChoiceGroups`.
 */
export function askableModifierGroups(
  groups: ComboModifierGroup[] | null | undefined,
): ComboModifierGroup[] {
  return [...(groups ?? [])]
    .map((g) => ({
      ...g,
      modifiers: [...g.modifiers]
        .filter((m) => m.is_available)
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
    .filter((g) => g.modifiers.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Un grupo se resuelve solo —sin preguntar— cuando es obligatorio, de a uno y
 * tiene una sola opción posible. Preguntar «elegí entre esta única cosa» es un
 * paso vacío; el asistente lo saltea y lo da por elegido.
 */
export function isAutoResolved(group: ComboModifierGroup): boolean {
  return (
    group.is_required &&
    group.max_selection === 1 &&
    group.min_selection <= 1 &&
    group.modifiers.length === 1
  );
}

/**
 * ¿El paso se cierra solo al elegir, o hace falta confirmar? (FR-002 / FR-003)
 *
 * Obligatorio y de a uno se comporta como un grupo del menú: Enter elige y
 * avanza. Cualquier otro caso —opcional, o de varias— necesita un «Seguir»,
 * porque «ninguno» y «dos» son respuestas válidas que el auto-avance no puede
 * expresar.
 */
export function isSingleChoiceGroup(group: ComboModifierGroup): boolean {
  return group.is_required && group.max_selection === 1;
}

/** Cuántos faltan para poder seguir. 0 = el paso está completo. */
export function missingSelections(
  group: ComboModifierGroup,
  chosenIds: string[],
): number {
  const count = group.modifiers.filter((m) => chosenIds.includes(m.id)).length;
  return Math.max(0, group.min_selection - count);
}

/**
 * Resuelve los modificadores elegidos contra los grupos **del producto**
 * (leídos de la DB) y devuelve cuánto suman (FR-004 / FR-006).
 *
 * Rechaza, con mensaje concreto:
 * 1. un id que no pertenece a ningún grupo de ese producto — no se puede colar
 *    el modificador de otro plato;
 * 2. un grupo obligatorio sin cubrir su `min_selection`;
 * 3. un grupo por encima de su `max_selection`.
 *
 * Un modificador no disponible se trata como inexistente: si la cocina lo
 * apagó, no se puede pedir.
 */
export function resolveModifiers(
  groups: ComboModifierGroup[] | null | undefined,
  modifierIds: string[],
  /** Para el mensaje de error: «… en "Ñoquis"». */
  productName = "ese producto",
): ModifiersResult {
  const available = askableModifierGroups(groups);
  const byId = new Map<string, { modifier: ComboModifier; group: ComboModifierGroup }>();
  for (const group of available) {
    for (const modifier of group.modifiers) {
      byId.set(modifier.id, { modifier, group });
    }
  }

  const chosen: ComboModifier[] = [];
  const countByGroup = new Map<string, number>();
  // `Set` primero: dos veces el mismo id es un payload roto, no "dos porciones".
  for (const id of new Set(modifierIds)) {
    const hit = byId.get(id);
    if (!hit) {
      return {
        ok: false,
        error: `Una de las opciones elegidas no corresponde a "${productName}".`,
      };
    }
    chosen.push(hit.modifier);
    countByGroup.set(hit.group.id, (countByGroup.get(hit.group.id) ?? 0) + 1);
  }

  for (const group of available) {
    const count = countByGroup.get(group.id) ?? 0;
    if (count < group.min_selection) {
      return {
        ok: false,
        error: `Elegí ${group.min_selection} en "${group.name}" de ${productName}.`,
      };
    }
    if (count > group.max_selection) {
      return {
        ok: false,
        error: `Hasta ${group.max_selection} en "${group.name}" de ${productName}.`,
      };
    }
  }

  // El adicional nunca resta: un delta negativo cargado a mano no puede abaratar
  // el combo (misma defensa que `resolveComboUpcharge`).
  const deltaCents = chosen.reduce(
    (acc, m) => acc + Math.max(0, Number(m.price_delta_cents) || 0),
    0,
  );
  return { ok: true, deltaCents, chosen };
}
