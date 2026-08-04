/**
 * Orden de los componentes del editor del menú del día (spec 076).
 *
 * El editor guarda una lista **plana** de componentes y el `sort_order` que se
 * persiste es la posición en esa lista (ver `syncComponents`). Ese orden manda
 * en todo lo de abajo: los pasos del asistente del mozo (spec 072) y qué grupos
 * puede condicionar una opción (spec 074, sólo hacia adelante).
 *
 * Acá vive la lógica de mover, borrar y limpiar, pura y sin React: el formulario
 * llama y hace `replace()`. La unidad que el usuario mueve no es el componente
 * suelto sino la **tarjeta**: un componente de texto/producto, o un grupo de
 * opciones **entero**.
 *
 * Invariante que sostienen todas las funciones de acá: las opciones de un grupo
 * quedan **contiguas** y en orden (FR-005). Sin eso, "subir" y "bajar" no
 * significan nada — y el array del editor era append-only, así que agregar una
 * opción a un grupo viejo la dejaba después de los grupos nuevos.
 */

import type { DailyMenuComponentInput } from "./schemas";

export type MenuCard =
  | { kind: "single"; component: DailyMenuComponentInput }
  | {
      kind: "group";
      groupId: string;
      label: string;
      options: DailyMenuComponentInput[];
    };

/** Regla «no lleva X» que se descartó por quedar mirando hacia atrás. */
export type DroppedRule = {
  /** La opción que la tenía puesta (ej. "Ravioles"). */
  optionLabel: string;
  /** El grupo de esa opción (ej. "Principal"). */
  ownerLabel: string;
  /** El grupo que ya no puede condicionar (ej. "Guarnición"). */
  blockedLabel: string;
};

const isChoice = (c: DailyMenuComponentInput): boolean =>
  c.kind === "choice" && !!c.choice_group_id;

/**
 * Agrupa la lista plana en tarjetas, en orden de primera aparición. Las
 * opciones de un mismo grupo caen todas en su tarjeta aunque en la lista
 * estuvieran intercaladas — eso **es** la normalización.
 *
 * Una opción sin `choice_group_id` (dato roto o a medio cargar) se muestra como
 * componente suelto en vez de desaparecer: el editor tiene que poder borrarla.
 */
export function toCards(components: DailyMenuComponentInput[]): MenuCard[] {
  const cards: MenuCard[] = [];
  const byGroup = new Map<string, Extract<MenuCard, { kind: "group" }>>();

  for (const component of components) {
    if (!isChoice(component)) {
      cards.push({ kind: "single", component });
      continue;
    }
    const groupId = component.choice_group_id as string;
    const existing = byGroup.get(groupId);
    if (existing) {
      existing.options.push(component);
      continue;
    }
    const card: Extract<MenuCard, { kind: "group" }> = {
      kind: "group",
      groupId,
      label: component.choice_group_label ?? "",
      options: [component],
    };
    byGroup.set(groupId, card);
    cards.push(card);
  }
  return cards;
}

/** Vuelve de tarjetas a la lista plana que consume el form. */
export function flattenCards(cards: MenuCard[]): DailyMenuComponentInput[] {
  return cards.flatMap((card) =>
    card.kind === "single" ? [card.component] : card.options,
  );
}

/** Lista plana con las opciones de cada grupo contiguas (FR-005). */
export function normalize(
  components: DailyMenuComponentInput[],
): DailyMenuComponentInput[] {
  return flattenCards(toCards(components));
}

/** Mueve el elemento `from` a la posición `to`. Fuera de rango: sin cambios. */
function moveWithin<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Mueve la tarjeta `from` a la posición `to` (FR-001). Un grupo viaja con todas
 * sus opciones porque la tarjeta **es** el grupo.
 */
export function moveCard(
  components: DailyMenuComponentInput[],
  from: number,
  to: number,
): DailyMenuComponentInput[] {
  return flattenCards(moveWithin(toCards(components), from, to));
}

/**
 * Mueve una opción dentro de su grupo (FR-002). No es cosmético: ese orden es
 * el que numera los atajos `1`–`9` del asistente del mozo (spec 072).
 */
export function moveOption(
  components: DailyMenuComponentInput[],
  groupId: string,
  from: number,
  to: number,
): DailyMenuComponentInput[] {
  const cards = toCards(components).map((card) =>
    card.kind === "group" && card.groupId === groupId
      ? { ...card, options: moveWithin(card.options, from, to) }
      : card,
  );
  return flattenCards(cards);
}

/** Borra un grupo entero, con todas sus opciones (FR-003). */
export function removeGroup(
  components: DailyMenuComponentInput[],
  groupId: string,
): DailyMenuComponentInput[] {
  return normalize(
    components.filter(
      (c) => !(isChoice(c) && c.choice_group_id === groupId),
    ),
  );
}

/**
 * Agrega una opción **al final de su grupo** (FR-005). Si el grupo todavía no
 * existe, abre una tarjeta nueva al final del menú.
 */
export function addOption(
  components: DailyMenuComponentInput[],
  groupId: string,
  option: DailyMenuComponentInput,
): DailyMenuComponentInput[] {
  const cards = toCards(components);
  const target = cards.find(
    (card) => card.kind === "group" && card.groupId === groupId,
  );
  if (target && target.kind === "group") {
    target.options.push(option);
    return flattenCards(cards);
  }
  return [...flattenCards(cards), option];
}

/**
 * Limpia las reglas «no lleva X» que dejaron de ser válidas (FR-004) y reporta
 * las que el encargado había cargado a mano.
 *
 * Se descartan tres casos:
 *
 * 1. **Hacia atrás** — el grupo condicionado se decide antes. Es inaplicable
 *    (spec 074, FR-002) y encima invisible: los checks del form sólo dibujan
 *    los grupos posteriores, así que no habría forma de destildarla y el menú
 *    quedaría imposible de guardar. **Se reporta**: es configuración cargada.
 * 2. **Grupo inexistente** — quedó el puntero de un grupo borrado. Silencioso:
 *    el grupo ya no está, no hay nada que decidir.
 * 3. **Auto-referencia** — un grupo condicionándose a sí mismo. Silencioso:
 *    nunca fue una regla, es un dato roto.
 *
 * No muta la lista que recibe.
 */
export function pruneBlocks(components: DailyMenuComponentInput[]): {
  components: DailyMenuComponentInput[];
  dropped: DroppedRule[];
} {
  const cards = toCards(normalize(components));
  const position = new Map<string, number>();
  const label = new Map<string, string>();
  cards.forEach((card, idx) => {
    if (card.kind !== "group") return;
    position.set(card.groupId, idx);
    label.set(card.groupId, card.label);
  });

  const dropped: DroppedRule[] = [];
  const next = flattenCards(cards).map((component) => {
    if (!isChoice(component)) return component;
    const blocks = component.blocks_choice_group_ids ?? [];
    if (blocks.length === 0) return component;

    const ownGroupId = component.choice_group_id as string;
    const ownPosition = position.get(ownGroupId) ?? -1;
    const kept = blocks.filter((blockedId) => {
      if (blockedId === ownGroupId) return false;
      const blockedPosition = position.get(blockedId);
      if (blockedPosition === undefined) return false;
      if (blockedPosition > ownPosition) return true;
      dropped.push({
        optionLabel: component.label,
        ownerLabel: label.get(ownGroupId) ?? "",
        blockedLabel: label.get(blockedId) ?? "",
      });
      return false;
    });
    return kept.length === blocks.length
      ? component
      : { ...component, blocks_choice_group_ids: kept };
  });

  return { components: next, dropped };
}
