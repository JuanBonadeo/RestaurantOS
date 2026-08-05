import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ComboModifierGroup } from "@/lib/orders/combo-modifiers";

export type { ComboModifierGroup };

export type DailyMenuComponent = {
  id: string;
  label: string;
  description: string | null;
  kind: "text" | "product" | "choice";
  product_id: string | null;
  product_name: string | null;
  choice_group_id: string | null;
  choice_group_label: string | null;
  /** Adicional de la opción (spec 29). 0 en `text`/`product` y opciones incluidas. */
  extra_price_cents: number;
  /**
   * Grupos que NO aplican si se elige esta opción (spec 074) — «los ravioles no
   * llevan guarnición». Vacío = todos los grupos del menú aplican.
   */
  blocks_choice_group_ids: string[];
  /** `sort_order` del componente: define el orden de los grupos, y el orden ES
   *  la regla de resolución (sólo se puede bloquear hacia adelante). */
  sort_order: number;
  /**
   * Grupos de modificadores del producto de esta opción (spec 083). Los mismos
   * que el mozo ve al cargar el producto suelto: «Salsa para pasta» de los
   * ñoquis, «Punto de cocción» del bife. Vacío si el producto no tiene.
   */
  modifier_groups: ComboModifierGroup[];
};

export type DailyMenuChoiceGroup = {
  choice_group_id: string;
  label: string;
  options: DailyMenuComponent[];
  /**
   * Condición del grupo (spec 087): NULL = aplica siempre; si no, el grupo del
   * que depende. Sale de `daily_menu_choice_groups`, que desde la migración
   * `0036` es la fuente de verdad — antes el grupo no era una entidad.
   */
  applies_when_group_id: string | null;
  /** Las opciones (por producto) del grupo fuente que habilitan a éste. */
  applies_when_product_ids: string[];
};

export type DailyMenuForMozo = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  components: DailyMenuComponent[];
  choice_groups: DailyMenuChoiceGroup[];
  has_choices: boolean;
};

/**
 * Menús del día disponibles HOY para mostrar al mozo en la pantalla de
 * toma de pedido. `todayDow` es 0..6 (0 = domingo) y debe calcularse en el
 * page para no caer en hydration mismatch ni mezclar TZs.
 *
 * En MVP esta vista es **solo informativa** — el mozo lee al cliente y, si
 * el cliente pide el menú del día, carga los productos individualmente. No
 * mandamos el menú entero como item porque `daily_menu_components` son
 * labels, no productos reales (no tienen station_id ni precio individual).
 * Cuando aparezca un caso real de "el mozo quiere mandarlo en un toque",
 * se mapea cada componente a un producto real (deuda eventual).
 */
export async function getDailyMenusForToday(
  businessId: string,
  todayDow: number,
): Promise<DailyMenuForMozo[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("daily_menus")
    .select(
      // Los `modifier_groups` del producto de cada opción (spec 083) son los
      // mismos que ve el mozo al cargar el producto suelto: el asistente los
      // pregunta en un paso propio y el server re-deriva de ahí el adicional.
      "id, name, description, price_cents, image_url, sort_order, daily_menu_choice_groups(id, name, sort_order, applies_when_group_id, applies_when_product_ids), daily_menu_components(id, label, description, sort_order, kind, product_id, choice_group_id, extra_price_cents, products(id, name, image_url, modifier_groups(id, name, is_required, min_selection, max_selection, sort_order, modifiers(id, name, price_delta_cents, is_available, sort_order))))",
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .eq("is_available", true)
    .contains("available_days", [todayDow])
    .in("display_context", ["salon", "both"])
    .order("sort_order");

  if (error) {
    console.error("getDailyMenusForToday", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((m) => {
    const components: DailyMenuComponent[] = (m.daily_menu_components ?? [])
      .slice()
      .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
      .map((c: any) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        kind: c.kind ?? "text",
        product_id: c.product_id ?? null,
        product_name: c.products?.name ?? null,
        choice_group_id: c.choice_group_id ?? null,
        choice_group_label: c.choice_group_label ?? null,
        extra_price_cents: Number(c.extra_price_cents ?? 0),
        blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
        sort_order: Number(c.sort_order ?? 0),
        modifier_groups: (c.products?.modifier_groups ?? []).map((g: any) => ({
          id: g.id,
          name: g.name,
          is_required: !!g.is_required,
          min_selection: Number(g.min_selection ?? 0),
          max_selection: Number(g.max_selection ?? 1),
          sort_order: Number(g.sort_order ?? 0),
          modifiers: (g.modifiers ?? []).map((mod: any) => ({
            id: mod.id,
            name: mod.name,
            price_delta_cents: Number(mod.price_delta_cents ?? 0),
            is_available: mod.is_available !== false,
            sort_order: Number(mod.sort_order ?? 0),
          })),
        })),
      }));

    // Los grupos salen de `daily_menu_choice_groups` (spec 087): ahí viven el
    // nombre, el orden y la condición. Se cae al scan de componentes sólo si el
    // menú todavía no tiene grupos en la tabla — un clon hecho con
    // `cloneBusiness`, que copia los componentes y no los grupos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filas: any[] = m.daily_menu_choice_groups ?? [];
    const porId = new Map(filas.map((g) => [g.id as string, g]));

    const groupMap = new Map<string, DailyMenuChoiceGroup>();
    for (const c of components) {
      if (c.kind === "choice" && c.choice_group_id) {
        let group = groupMap.get(c.choice_group_id);
        if (!group) {
          const fila = porId.get(c.choice_group_id);
          group = {
            choice_group_id: c.choice_group_id,
            label: fila?.name ?? c.choice_group_label ?? "Elegí una opción",
            options: [],
            applies_when_group_id: fila?.applies_when_group_id ?? null,
            applies_when_product_ids: fila?.applies_when_product_ids ?? [],
          };
          groupMap.set(c.choice_group_id, group);
        }
        group.options.push(c);
      }
    }

    return {
      id: m.id,
      name: m.name,
      description: m.description,
      price_cents: Number(m.price_cents),
      image_url: m.image_url,
      components,
      choice_groups: [...groupMap.values()],
      has_choices: groupMap.size > 0,
    };
  });
}
