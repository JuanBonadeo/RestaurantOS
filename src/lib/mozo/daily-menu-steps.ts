/**
 * Lógica pura del asistente de carga del menú del día (spec 072). Aislada de
 * React/DOM para poder testearla: el componente mantiene el paso actual, el
 * índice de la opción enfocada y las elecciones, y usa esto para decidir.
 *
 * El menú del día es, por modelo de datos, un asistente disfrazado de
 * formulario: cada `choice_group` es **una** decisión obligatoria de
 * exactamente una opción (D-MDR-4 / D-MDR-6). Un paso por grupo, en el orden
 * que definió el encargado, y un paso final para confirmar.
 *
 * El movimiento con ↓/↑ no vive acá: es el mismo `moveSelection` de
 * `product-search.ts` (clamp, sin wrap-around) que usa el buscador.
 */

import {
  activeChoiceGroups,
  pruneBlockedSelections,
} from "@/lib/orders/combo-choices";

import type { DailyMenuChoiceGroup } from "./daily-menus-query";

/** Una opción elegida. Es exactamente lo que viaja en `selected_choices` del
 *  ítem del carrito y de `enviarComanda`. */
export type DailyMenuSelection = {
  choice_group_id: string;
  choice_group_label: string;
  product_id: string;
  product_name: string;
  extra_price_cents: number;
  modifier_ids: string[];
};

/** Elecciones en curso, indexadas por `choice_group_id`. */
export type DailyMenuSelections = Map<string, DailyMenuSelection>;

export type MenuStep =
  | { kind: "choice"; group: DailyMenuChoiceGroup }
  | { kind: "confirm" };

/**
 * Grupos activos y descarte de lo que dejó de aplicar (spec 074).
 *
 * Se re-exportan desde `lib/orders/combo-choices` —donde también vive el
 * validador del server— para que la regla se escriba **una sola vez**: el
 * asistente del mozo, el sheet de la carta pública y los dos caminos de
 * persistencia resuelven idéntico (FR-005).
 */
export { activeChoiceGroups, pruneBlockedSelections };

/**
 * Pasos del asistente: uno por grupo **activo**, más el de confirmación al
 * final. Un menú sin grupos (todo fijo) es un solo paso: no hay nada que
 * decidir.
 *
 * Depende de `selections` porque una elección puede sacar un paso del medio
 * (FR-003): la lista se recalcula en vivo y `Paso N de M` se mueve con ella.
 * Sin elecciones (el estado inicial) todos los grupos están activos, que es
 * exactamente el comportamiento previo a la spec 074.
 */
export function buildMenuSteps(
  groups: DailyMenuChoiceGroup[],
  selections: DailyMenuSelections = new Map(),
): MenuStep[] {
  const steps: MenuStep[] = activeChoiceGroups(groups, selections).map(
    (group) => ({ kind: "choice" as const, group }),
  );
  steps.push({ kind: "confirm" });
  return steps;
}

/**
 * Índice de la opción que activa una tecla de dígito (`1`–`9` → 0–8), o `null`
 * si la tecla no es un dígito nuestro o se pasa de la cantidad de opciones.
 *
 * Mismo criterio que los dígitos del walk-in (`partySizeFromKey`, spec 066):
 * el atajo es la posición que el usuario ve escrita en la fila.
 */
export function optionIndexFromKey(key: string, length: number): number | null {
  if (key.length !== 1 || key < "1" || key > "9") return null;
  const index = Number(key) - 1;
  return index < length ? index : null;
}

/**
 * Con qué opción se entra a un paso: la que ya estaba elegida si el usuario
 * vuelve atrás (FR-002), si no la primera. Si lo elegido ya no pertenece al
 * grupo —el admin editó el menú mientras el panel estaba abierto—, la primera.
 */
export function initialOptionIndex(
  group: DailyMenuChoiceGroup,
  selections: DailyMenuSelections,
): number {
  const chosen = selections.get(group.choice_group_id);
  if (!chosen) return 0;
  const index = group.options.findIndex(
    (o) => o.product_id === chosen.product_id,
  );
  return index >= 0 ? index : 0;
}

/** Suma de los adicionales elegidos (spec 29). Se suma al precio del menú
 *  antes de multiplicar por la cantidad. */
export function choicesDeltaCents(selections: DailyMenuSelections): number {
  let total = 0;
  for (const sel of selections.values()) {
    total += sel.extra_price_cents ?? 0;
  }
  return total;
}
