import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminDailyMenuComponent = {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
  kind: "text" | "product" | "choice";
  product_id: string | null;
  choice_group_id: string | null;
  choice_group_label: string | null;
  product_name: string | null;
  product_image_url: string | null;
  /** Adicional de la opción en centavos (spec 29). 0 = incluida. */
  extra_price_cents: number;
  /** Grupos que esta opción NO habilita (spec 074). */
  blocks_choice_group_ids: string[];
};

export type AdminDailyMenu = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  available_days: number[];
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
  display_context: "delivery" | "salon" | "both";
  is_suggestion: boolean;
  components: AdminDailyMenuComponent[];
};

const SELECT =
  "id, name, slug, description, price_cents, image_url, available_days, is_active, is_available, sort_order, display_context, is_suggestion, daily_menu_components(id, label, description, sort_order, kind, product_id, choice_group_id, choice_group_label, extra_price_cents, blocks_choice_group_ids, products(id, name, image_url))";

function mapRow(
  row: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    price_cents: number;
    image_url: string | null;
    available_days: number[] | null;
    is_active: boolean;
    is_available: boolean;
    sort_order: number;
    display_context: string;
    is_suggestion: boolean;
    daily_menu_components:
      | {
          id: string;
          label: string;
          description: string | null;
          sort_order: number;
          kind?: string;
          product_id?: string | null;
          choice_group_id?: string | null;
          choice_group_label?: string | null;
          extra_price_cents?: number | null;
          blocks_choice_group_ids?: string[] | null;
          products?: { id: string; name: string; image_url: string | null } | null;
        }[]
      | null;
  },
): AdminDailyMenu {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    price_cents: Number(row.price_cents),
    image_url: row.image_url,
    available_days: (row.available_days ?? []).slice().sort((a, b) => a - b),
    is_active: row.is_active,
    is_available: row.is_available,
    sort_order: row.sort_order,
    display_context: row.display_context as "delivery" | "salon" | "both",
    is_suggestion: row.is_suggestion,
    components: (row.daily_menu_components ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        sort_order: c.sort_order,
        kind: (c.kind as "text" | "product" | "choice") ?? "text",
        product_id: c.product_id ?? null,
        choice_group_id: c.choice_group_id ?? null,
        choice_group_label: c.choice_group_label ?? null,
        product_name: c.products?.name ?? null,
        product_image_url: c.products?.image_url ?? null,
        extra_price_cents: Number(c.extra_price_cents ?? 0),
        blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
      })),
  };
}

export async function getAdminDailyMenus(
  businessId: string,
): Promise<AdminDailyMenu[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("daily_menus")
    .select(SELECT)
    .eq("business_id", businessId)
    .order("sort_order");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(mapRow);
}

export async function getAdminDailyMenu(
  id: string,
): Promise<AdminDailyMenu | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("daily_menus")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data ? mapRow(data as any) : null;
}
