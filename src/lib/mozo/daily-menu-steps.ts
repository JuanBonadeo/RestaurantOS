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
import {
  askableModifierGroups,
  isAutoResolved,
  type ComboModifier,
  type ComboModifierGroup,
} from "@/lib/orders/combo-modifiers";

import type { DailyMenuChoiceGroup } from "./daily-menus-query";

/** Una opción elegida. Es exactamente lo que viaja en `selected_choices` del
 *  ítem del carrito y de `enviarComanda`. */
export type DailyMenuSelection = {
  choice_group_id: string;
  choice_group_label: string;
  product_id: string;
  product_name: string;
  extra_price_cents: number;
  /** Lo único que el server lee para re-derivar el precio (spec 083). */
  modifier_ids: string[];
  /**
   * Los mismos modificadores con nombre y adicional, para que el carrito y el
   * resumen puedan mostrar el desglose sin volver a buscarlos. El server los
   * **ignora**: el precio siempre sale de la DB.
   */
  modifiers?: ComboModifier[];
};

/** Elecciones en curso, indexadas por `choice_group_id`. */
export type DailyMenuSelections = Map<string, DailyMenuSelection>;

export type MenuStep =
  | { kind: "choice"; group: DailyMenuChoiceGroup }
  /**
   * Un grupo de modificadores del producto que se eligió en `choiceGroupId`
   * (spec 083): «Salsa para pasta» aparece porque el mozo eligió Ñoquis, y se
   * va si cambia a Milanesa.
   */
  | {
      kind: "modifiers";
      choiceGroupId: string;
      productName: string;
      group: ComboModifierGroup;
    }
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
  const steps: MenuStep[] = [];
  for (const group of activeChoiceGroups(groups, selections)) {
    steps.push({ kind: "choice", group });
    // Los modificadores del producto elegido acá van pegados a su grupo, antes
    // del siguiente del menú (spec 083, FR-001): la pregunta «¿con qué salsa?»
    // pertenece al plato, no al final del combo.
    const chosen = selections.get(group.choice_group_id);
    if (!chosen) continue;
    const option = group.options.find((o) => o.product_id === chosen.product_id);
    if (!option) continue;
    for (const modifierGroup of askableModifierGroups(option.modifier_groups)) {
      // Un obligatorio de una sola opción no se pregunta: sería un paso con una
      // sola salida. El asistente lo da por elegido al confirmar.
      if (isAutoResolved(modifierGroup)) continue;
      steps.push({
        kind: "modifiers",
        choiceGroupId: group.choice_group_id,
        productName: chosen.product_name,
        group: modifierGroup,
      });
    }
  }
  steps.push({ kind: "confirm" });
  return steps;
}

/**
 * Los modificadores que se resuelven solos (obligatorios de una sola opción) y
 * hay que dar por elegidos aunque nunca se hayan mostrado: si no, el validador
 * del server rechaza la orden por un grupo obligatorio sin cubrir.
 */
export function autoResolvedModifierIds(
  groups: DailyMenuChoiceGroup[],
  selections: DailyMenuSelections,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const group of activeChoiceGroups(groups, selections)) {
    const chosen = selections.get(group.choice_group_id);
    if (!chosen) continue;
    const option = group.options.find((o) => o.product_id === chosen.product_id);
    if (!option) continue;
    const ids = askableModifierGroups(option.modifier_groups)
      .filter(isAutoResolved)
      .map((g) => g.modifiers[0]!.id);
    if (ids.length > 0) out.set(group.choice_group_id, ids);
  }
  return out;
}

// El atajo "elegir la opción N con un dígito" nació acá (spec 072) y resultó
// genérico —lo usan también el walk-in y el selector de método de pago—, así
// que la spec 075 lo mudó a `lib/ui/roving.ts` como `indexFromDigit`.

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
    // Los modificadores también suman (spec 083, FR-004): Bolognesa +$4.500 en
    // un menú de $24.000 lo deja en $28.500. Esto es lo que se MUESTRA; el
    // cobro lo re-deriva el server de la DB.
    for (const m of sel.modifiers ?? []) {
      total += Math.max(0, m.price_delta_cents ?? 0);
    }
  }
  return total;
}
