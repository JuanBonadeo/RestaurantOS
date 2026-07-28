import "server-only";

import { cache } from "react";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type MenuModifier = {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
  sort_order: number;
};

export type MenuModifierGroup = {
  id: string;
  name: string;
  min_selection: number;
  max_selection: number;
  is_required: boolean;
  sort_order: number;
  modifiers: MenuModifier[];
};

export type MenuProduct = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  is_available: boolean;
  sort_order: number;
  modifier_groups: MenuModifierGroup[];
};

export type MenuCategory = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  super_category_id: string | null;
  products: MenuProduct[];
};

export type MenuDailyMenuComponent = {
  id: string;
  label: string;
  description: string | null;
  kind: "text" | "product" | "choice";
  product_id: string | null;
  product_name: string | null;
  product_image_url: string | null;
  choice_group_id: string | null;
  choice_group_label: string | null;
  /** Adicional de la opción (spec 29). 0 en `text`/`product` y opciones incluidas. */
  extra_price_cents: number;
};

export type MenuDailyMenuChoiceGroup = {
  choice_group_id: string;
  label: string;
  options: MenuDailyMenuComponent[];
};

export type MenuDailyMenu = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  components: MenuDailyMenuComponent[];
  choice_groups: MenuDailyMenuChoiceGroup[];
  has_choices: boolean;
  is_suggestion: boolean;
};

export type BusinessHour = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
};

export type MenuSuperCategory = {
  id: string;
  name: string;
  sort_order: number;
};

export type MenuData = {
  categories: MenuCategory[];
  hours: BusinessHour[];
  todaysMenus: MenuDailyMenu[];
  beverageSuperCategoryId: string | null;
  superCategories: MenuSuperCategory[];
};

/**
 * Catálogo público. `todayDow` es el día de la semana actual (0..6) en el
 * TZ del negocio y se usa para filtrar los menús del día. Se pasa desde el
 * server component para evitar hydration mismatch — nunca calculamos `Date`
 * en el cliente acá.
 */
export const getMenu = cache(
  async (businessId: string, todayDow: number): Promise<MenuData> => {
    const supabase = createSupabaseServiceClient();

    const [
      { data: categories },
      { data: products },
      { data: hours },
      { data: dailyMenus },
      { data: superCategories },
    ] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name, slug, sort_order, super_category_id")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("products")
        .select(
          "id, category_id, name, slug, description, price_cents, image_url, is_available, sort_order, modifier_groups(id, name, min_selection, max_selection, is_required, sort_order, modifiers(id, name, price_delta_cents, is_available, sort_order))",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        // spec 0021 — la carta online muestra un subconjunto curado del catálogo.
        // El mozo (mozo/catalog-query.ts) NO filtra por acá: sigue viendo todo.
        .eq("show_online", true)
        .order("sort_order"),
      supabase
        .from("business_hours")
        .select("day_of_week, opens_at, closes_at")
        .eq("business_id", businessId),
      supabase
        .from("daily_menus")
        .select(
          "id, name, description, price_cents, image_url, available_days, is_suggestion, daily_menu_components(id, label, description, sort_order, kind, product_id, choice_group_id, choice_group_label, extra_price_cents, products(id, name, image_url))",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        .eq("is_available", true)
        .contains("available_days", [todayDow])
        .in("display_context", ["delivery", "both"])
        .order("sort_order"),
      supabase
        .from("super_categories")
        .select("id, slug, sort_order, name")
        .eq("business_id", businessId)
        .order("sort_order"),
    ]);

  const productsList: MenuProduct[] = (products ?? []).map((p) => ({
    id: p.id,
    category_id: p.category_id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    price_cents: Number(p.price_cents),
    image_url: p.image_url,
    is_available: p.is_available,
    sort_order: p.sort_order,
    modifier_groups: (p.modifier_groups ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        id: g.id,
        name: g.name,
        min_selection: g.min_selection,
        max_selection: g.max_selection,
        is_required: g.is_required,
        sort_order: g.sort_order,
        modifiers: (g.modifiers ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => ({
            id: m.id,
            name: m.name,
            price_delta_cents: Number(m.price_delta_cents),
            is_available: m.is_available,
            sort_order: m.sort_order,
          })),
      })),
  }));

  const cats: MenuCategory[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    sort_order: c.sort_order,
    super_category_id: (c as any).super_category_id ?? null,
    products: productsList.filter((p) => p.category_id === c.id),
  }));

  // Orden por super-categoría (como el mozo): las categorías se agrupan por el
  // sort_order de su super-categoría; dentro de cada una, por su propio
  // sort_order. Sin super-categoría → al final.
  const superOrderById = new Map<string, number>(
    (superCategories ?? []).map((s) => [s.id, s.sort_order] as const),
  );
  const superRank = (superCategoryId: string | null): number =>
    superCategoryId != null
      ? (superOrderById.get(superCategoryId) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
  cats.sort((a, b) => {
    const diff = superRank(a.super_category_id) - superRank(b.super_category_id);
    return diff !== 0 ? diff : a.sort_order - b.sort_order;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todaysMenus: MenuDailyMenu[] = (dailyMenus ?? []).map((m: any) => {
    const components: MenuDailyMenuComponent[] = (m.daily_menu_components ?? [])
      .slice()
      .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
      .map((c: any) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        kind: c.kind ?? "text",
        product_id: c.product_id ?? null,
        product_name: c.products?.name ?? null,
        product_image_url: c.products?.image_url ?? null,
        choice_group_id: c.choice_group_id ?? null,
        choice_group_label: c.choice_group_label ?? null,
        extra_price_cents: Number(c.extra_price_cents ?? 0),
      }));

    const groupMap = new Map<string, MenuDailyMenuChoiceGroup>();
    for (const c of components) {
      if (c.kind === "choice" && c.choice_group_id) {
        let group = groupMap.get(c.choice_group_id);
        if (!group) {
          group = {
            choice_group_id: c.choice_group_id,
            label: c.choice_group_label ?? "Elegí una opción",
            options: [],
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
      is_suggestion: m.is_suggestion ?? false,
    };
  });

  return {
    categories: cats,
    hours: (hours ?? []) as BusinessHour[],
    todaysMenus,
    beverageSuperCategoryId:
      (superCategories ?? []).find((s) => s.slug === "bebidas")?.id ?? null,
    superCategories: (superCategories ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      sort_order: s.sort_order,
    })),
  };
});
