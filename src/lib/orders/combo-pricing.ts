/**
 * Cálculo del adicional de un combo de menú del día (spec 29).
 *
 * Puro y testeable. La **fuente de verdad** del precio es `components`
 * (cargados de la DB), nunca el payload del cliente: éste sólo informa QUÉ
 * eligió (`choice_group_id` + `product_id`), jamás CUÁNTO cuesta.
 *
 * El delta resultante se suma al `order_item` **padre** del combo; los hijos
 * quedan en $0 (invariante de `is_combo_component`). Ver
 * `wiki/specs/29-menu-del-dia-opciones-con-adicional/design.md`.
 */

import {
  validateComboChoices,
  type ComboChoiceComponent,
  type SelectedChoiceRef,
} from "./combo-choices";

export type { ComboChoiceComponent, SelectedChoiceRef };

export type ResolvedChoice = {
  choice_group_id: string;
  product_id: string;
  extra_price_cents: number;
};

export type ComboUpchargeResult =
  | { ok: true; deltaCents: number; choices: ResolvedChoice[] }
  | { ok: false; error: string };

/**
 * Valida la selección y suma los `extra_price_cents` de cada opción elegida.
 *
 * La validación (spec 074, `validateComboChoices`) va **adentro** y no como
 * llamada aparte a propósito: es el único punto por el que pasan los dos
 * caminos de persistencia, así que ningún call-site puede saltearla y cobrar
 * un combo mal armado. De ahí salen las tres garantías —opción válida, ningún
 * grupo bloqueado, exactamente una por grupo activo— antes de tocar un peso.
 */
export function resolveComboUpcharge(
  components: ComboChoiceComponent[],
  selectedChoices: SelectedChoiceRef[],
): ComboUpchargeResult {
  const valid = validateComboChoices(components, selectedChoices);
  if (!valid.ok) return { ok: false, error: valid.error };

  let deltaCents = 0;
  const choices: ResolvedChoice[] = [];
  for (const sc of selectedChoices) {
    // `validateComboChoices` ya garantizó que existe y es de ese grupo.
    const match = components.find(
      (c) =>
        c.kind === "choice" &&
        c.choice_group_id === sc.choice_group_id &&
        c.product_id === sc.product_id,
    )!;
    // Defensa: el adicional nunca resta (la opción base va en $0).
    const extra = Math.max(0, Number(match.extra_price_cents) || 0);
    deltaCents += extra;
    choices.push({
      choice_group_id: sc.choice_group_id,
      product_id: sc.product_id,
      extra_price_cents: extra,
    });
  }
  return { ok: true, deltaCents, choices };
}
