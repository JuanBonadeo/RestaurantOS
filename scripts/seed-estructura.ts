// @ts-nocheck
/**
 * seed-estructura.ts — Seed estructural completo para JCR Golf.
 *
 * SIEMPRE borra y recrea todo el negocio desde cero (FASE 0 cleanup).
 * Crea: business, horarios, catálogo, modificadores, planos, reservas,
 * equipo, ingredientes, recetas, stock de bebidas, chatbot config, menús.
 *
 * Uso: `npx tsx scripts/seed-estructura.ts [slug]`
 * Default slug: golf-jcr
 *
 * Usa service_role key → bypasea RLS.
 */

import { resolve } from "path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  slugify,
  rand,
  randInt,
  chunk,
  STATIONS,
  SUPER_CATEGORIES,
  CATEGORIES,
  PRODUCTS,
  SALON_TABLES,
  SALON_2_TABLES,
  RESERVATION_SCHEDULE,
  TEAM,
  TEAM_PASSWORD,
  INGREDIENTS,
  RECIPES,
} from "./seed-data";

// ════════════════════════════════════════════════════════════════════════════
// ENV + CLIENT
// ════════════════════════════════════════════════════════════════════════════

config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ════════════════════════════════════════════════════════════════════════════
// ARGS
// ════════════════════════════════════════════════════════════════════════════

const SLUG = process.argv[2] || "golf-jcr";
const NAME = process.argv[3] || "JCR Golf";

// ════════════════════════════════════════════════════════════════════════════
// COUNTERS
// ════════════════════════════════════════════════════════════════════════════

const counts: Record<string, number> = {};
function inc(key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function header(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

async function rpc<T>(
  fn: () => Promise<{ data: T; error: any }>,
  label: string,
): Promise<T> {
  const { data, error } = await fn();
  if (error) {
    console.error(`✗ ${label}:`, error.message ?? error);
    throw error;
  }
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 0 — CLEANUP (borra TODO del business, FK-safe order)
// ════════════════════════════════════════════════════════════════════════════

async function fase0_cleanup(businessId: string) {
  header("FASE 0 — Cleanup completo");

  const del = async (table: string, extra?: (q: any) => any) => {
    let q = sb.from(table).delete().eq("business_id", businessId);
    if (extra) q = extra(q);
    const { error, count } = await q;
    if (error) console.log(`  ⚠ ${table}: ${error.message}`);
    else console.log(`  ✓ ${table} limpio`);
  };

  // 1. Datos operativos que tienen RESTRICT FKs → borrar primero
  await del("invoices");
  await del("payments");
  await del("caja_movimientos");
  await del("caja_cortes");
  await del("stock_movimientos");
  await del("clock_entries");
  await del("notifications");
  await del("tables_audit_log");

  // 2. campaign_messages no tiene business_id, va vía campaigns
  const { data: camps } = await sb.from("campaigns").select("id").eq("business_id", businessId);
  if (camps?.length) {
    await sb.from("campaign_messages").delete().in("campaign_id", camps.map((c: any) => c.id));
    console.log("  ✓ campaign_messages limpio");
  }

  // 3. Reset tables FK a orders antes de borrar orders
  const { data: fps } = await sb.from("floor_plans").select("id").eq("business_id", businessId);
  if (fps?.length) {
    for (const fp of fps) {
      await sb.from("tables")
        .update({ current_order_id: null, mozo_id: null, operational_status: "libre", opened_at: null })
        .eq("floor_plan_id", fp.id);
    }
    console.log("  ✓ tables reset a libre");
  }

  // 4. Orders cascade → order_items, comandas, comanda_items, modifiers, splits, history
  await del("orders");

  // 5. Resto de datos operativos
  await del("reservations");
  await del("customers");       // cascade: customer_addresses
  await del("campaigns");
  await del("promo_codes");
  await del("cajas");

  // 6. Chatbot
  const { data: contacts } = await sb.from("chatbot_contacts").select("id").eq("business_id", businessId);
  if (contacts?.length) {
    for (const c of contacts) {
      await sb.from("chatbot_conversations").delete().eq("contact_id", c.id);
    }
    await sb.from("chatbot_contacts").delete().eq("business_id", businessId);
    console.log("  ✓ chatbot data limpio");
  }
  await sb.from("chatbot_configs").delete().eq("business_id", businessId);

  // 7. Estructura física — floor_plans cascade → tables
  await sb.from("floor_plans").delete().eq("business_id", businessId);
  console.log("  ✓ floor_plans + tables limpio");

  // 8. Menús del día
  await sb.from("daily_menus").delete().eq("business_id", businessId);
  console.log("  ✓ daily_menus limpio");

  // 9. Catálogo — products cascade → modifier_groups, modifiers, recipes, stock_items
  //    IMPORTANTE: products antes de ingredients porque recipes tiene RESTRICT en ingredient_id
  await del("products");
  console.log("  ✓ products limpio (cascade: modifiers, recipes, stock_items)");

  // 10. Ingredientes — ahora safe porque recipes ya cascadeó con products
  const { data: ings } = await sb.from("ingredients").select("id").eq("business_id", businessId);
  if (ings?.length) {
    const ingIds = ings.map((i: any) => i.id);
    // ingredient_recipes tiene RESTRICT en child_ingredient_id
    await sb.from("ingredient_recipes").delete().in("parent_ingredient_id", ingIds);
    await sb.from("ingredient_recipes").delete().in("child_ingredient_id", ingIds);
  }
  await del("ingredients"); // cascade: presentations, price_log
  console.log("  ✓ ingredients limpio");

  // 11. Resto catálogo
  await del("categories");
  await del("super_categories");
  await del("stations");
  console.log("  ✓ catálogo limpio");

  // 12. Config
  await del("reservation_settings");
  await del("payment_method_configs");
  await sb.from("business_hours").delete().eq("business_id", businessId);
  console.log("  ✓ config limpio");

  console.log("\n  ✓ Cleanup completo — business vacío\n");
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 1 — BUSINESS
// ════════════════════════════════════════════════════════════════════════════

async function fase1_business(): Promise<string> {
  header("FASE 1 — Business");

  const payload = {
    slug: SLUG,
    name: NAME,
    timezone: "America/Argentina/Buenos_Aires",
    currency: "ARS",
    is_active: true,
    phone: "+5493416123456",
    address: "Club JCR Golf, Rosario",
    delivery_fee_cents: 80000,
    min_order_cents: 500000,
    estimated_delivery_minutes: 40,
    settings: { tagline: "Cocina de club" },
  };

  const { data: existing } = await sb
    .from("businesses")
    .select("id")
    .eq("slug", SLUG)
    .maybeSingle();

  let businessId: string;

  if (existing) {
    // Update
    await rpc(
      () => sb.from("businesses").update(payload).eq("id", existing.id).select("id").single(),
      "update business",
    );
    businessId = existing.id;
    console.log(`✓ Business updated: ${SLUG} (${businessId})`);
  } else {
    const biz = await rpc(
      () => sb.from("businesses").insert(payload).select("id").single(),
      "insert business",
    );
    businessId = biz.id;
    console.log(`✓ Business created: ${SLUG} (${businessId})`);
  }

  inc("businesses");
  return businessId;
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 2 — BUSINESS HOURS
// ════════════════════════════════════════════════════════════════════════════

async function fase2_hours(businessId: string) {
  header("FASE 2 — Business Hours");

  // Schedule: [dow, opens_at, closes_at]
  const schedule: [number, string, string][] = [
    // Martes a Viernes: mediodía + noche
    [2, "08:00", "16:00"], [2, "20:00", "00:00"],
    [3, "08:00", "16:00"], [3, "20:00", "00:00"],
    [4, "08:00", "16:00"], [4, "20:00", "00:00"],
    [5, "08:00", "16:00"], [5, "20:00", "00:00"],
    // Sábado
    [6, "08:00", "16:00"], [6, "20:00", "01:00"],
    // Domingo
    [0, "08:00", "16:00"], [0, "20:00", "23:00"],
    // Lunes: cerrado (no rows)
  ];

  const rows = schedule.map(([dow, opens, closes]) => ({
    business_id: businessId,
    day_of_week: dow,
    opens_at: opens,
    closes_at: closes,
  }));

  await rpc(
    () => sb.from("business_hours").insert(rows),
    "insert business_hours",
  );

  inc("business_hours", rows.length);
  console.log(`✓ ${rows.length} business_hours rows (lunes cerrado)`);
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 3 — CATÁLOGO
// ════════════════════════════════════════════════════════════════════════════

async function fase3_catalogo(businessId: string) {
  header("FASE 3 — Catálogo");

  // ── Stations ──
  for (const st of STATIONS) {
    await rpc(
      () =>
        sb
          .from("stations")
          .upsert(
            { business_id: businessId, name: st.name, sort_order: st.sort_order },
            { onConflict: "business_id,name" },
          )
          .select("id")
          .single(),
      `upsert station ${st.name}`,
    );
  }
  inc("stations", STATIONS.length);
  console.log(`✓ ${STATIONS.length} stations`);

  // Build station map
  const { data: stationRows } = await sb
    .from("stations")
    .select("id, name")
    .eq("business_id", businessId);
  const stationMap = new Map(stationRows!.map((s: any) => [s.name, s.id]));

  // ── Super-categories ──
  for (const sc of SUPER_CATEGORIES) {
    await rpc(
      () =>
        sb
          .from("super_categories")
          .upsert(
            {
              business_id: businessId,
              name: sc.name,
              slug: sc.slug,
              icon: sc.icon,
              color: sc.color,
              sort_order: SUPER_CATEGORIES.indexOf(sc),
            },
            { onConflict: "business_id,slug" },
          )
          .select("id")
          .single(),
      `upsert super_category ${sc.slug}`,
    );
  }
  inc("super_categories", SUPER_CATEGORIES.length);
  console.log(`✓ ${SUPER_CATEGORIES.length} super-categories`);

  // Build super-category map
  const { data: scRows } = await sb
    .from("super_categories")
    .select("id, name")
    .eq("business_id", businessId);
  const scMap = new Map(scRows!.map((s: any) => [s.name, s.id]));

  // ── Categories ──
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    await rpc(
      () =>
        sb
          .from("categories")
          .upsert(
            {
              business_id: businessId,
              name: cat.name,
              slug: slugify(cat.name),
              sort_order: i,
              station_id: cat.default_station ? stationMap.get(cat.default_station) ?? null : null,
              super_category_id: scMap.get(cat.super_category) ?? null,
            },
            { onConflict: "business_id,slug" },
          )
          .select("id")
          .single(),
      `upsert category ${cat.name}`,
    );
  }
  inc("categories", CATEGORIES.length);
  console.log(`✓ ${CATEGORIES.length} categories`);

  // Build category map
  const { data: catRows } = await sb
    .from("categories")
    .select("id, name")
    .eq("business_id", businessId);
  const catMap = new Map(catRows!.map((c: any) => [c.name, c.id]));

  // ── Products ──
  // Track slugs to handle duplicates
  const usedSlugs = new Map<string, number>();

  const productPayloads = PRODUCTS.map((p, idx) => {
    let slug = slugify(p.name);
    const count = usedSlugs.get(slug) ?? 0;
    if (count > 0) {
      slug = `${slug}-${count}`;
    }
    usedSlugs.set(slugify(p.name), count + 1);

    return {
      business_id: businessId,
      name: p.name,
      slug,
      price_cents: p.price_cents,
      category_id: catMap.get(p.category) ?? null,
      station_id: p.station ? stationMap.get(p.station) ?? null : null,
      sort_order: idx,
      is_available: true,
      is_active: true,
    };
  });

  // Insert in chunks to avoid payload size limits
  for (const batch of chunk(productPayloads, 50)) {
    await rpc(
      () => sb.from("products").upsert(batch, { onConflict: "business_id,slug" }),
      "upsert products batch",
    );
  }
  inc("products", PRODUCTS.length);
  console.log(`✓ ${PRODUCTS.length} products`);

  return { stationMap, catMap };
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 4 — MODIFIER GROUPS
// ════════════════════════════════════════════════════════════════════════════

async function fase4_modifiers(businessId: string) {
  header("FASE 4 — Modifier Groups");

  // Fetch all products for matching
  const { data: allProducts } = await sb
    .from("products")
    .select("id, name, category_id")
    .eq("business_id", businessId);
  if (!allProducts) return;

  // Fetch categories for name lookup
  const { data: allCats } = await sb
    .from("categories")
    .select("id, name")
    .eq("business_id", businessId);
  const catNameById = new Map(allCats!.map((c: any) => [c.id, c.name]));

  // Helper: find products by exact name match
  function findProducts(names: string[]): typeof allProducts {
    return allProducts.filter((p) => names.includes(p.name));
  }

  // Helper: find products by category name + optional name filter
  function findByCat(catName: string, nameFilter?: (n: string) => boolean): typeof allProducts {
    return allProducts.filter((p) => {
      const pCat = catNameById.get(p.category_id);
      if (pCat !== catName) return false;
      return nameFilter ? nameFilter(p.name) : true;
    });
  }

  // ── Group definitions ──
  const groups = [
    {
      name: "Punto de cocción",
      min_selection: 1,
      max_selection: 1,
      options: [
        { name: "Jugoso", price_delta_cents: 0 },
        { name: "A punto", price_delta_cents: 0 },
        { name: "Cocido", price_delta_cents: 0 },
      ],
      products: findProducts([
        "Entrecot", "Lomo", "Ojo de Bife", "Petit Lomo",
        "Matambrito", "Entraña", "Angus",
      ]),
    },
    {
      name: "Salsa para pasta",
      min_selection: 1,
      max_selection: 1,
      options: [
        { name: "Bolognesa", price_delta_cents: 0 },
        { name: "Fileto", price_delta_cents: 0 },
        { name: "Cuatro Quesos", price_delta_cents: 45000 },
        { name: "Pesto", price_delta_cents: 45000 },
        { name: "Parisien", price_delta_cents: 55000 },
        { name: "Carbonara", price_delta_cents: 50000 },
      ],
      products: findProducts([
        "Ñoquis", "Tallarines", "Ravioles",
        "Sorrentinos Jamón y Queso", "Sorrentinos Calabaza",
        "Sorrentinos Salmón c/Tinta",
        "Crepes de Verdura", "Lasagna",
      ]),
    },
    {
      name: "Guarnición",
      min_selection: 0,
      max_selection: 1,
      options: [
        { name: "Papas fritas", price_delta_cents: 0 },
        { name: "Puré", price_delta_cents: 0 },
        { name: "Ensalada mixta", price_delta_cents: 0 },
        { name: "Papas rejilla", price_delta_cents: 10000 },
      ],
      products: [
        ...findProducts([
          "Milanesa", "Milanesa Napolitana", "Suprema", "Suprema Napolitana",
          "Lomo Reducción", "Entrecot Especial",
        ]),
        ...findByCat("Platos", (n) => n.includes("Sugerencia")),
      ],
    },
    {
      name: "Estilo de papas",
      min_selection: 0,
      max_selection: 1,
      options: [
        { name: "Bastón", price_delta_cents: 0 },
        { name: "Rejilla", price_delta_cents: 10000 },
        { name: "Española", price_delta_cents: 0 },
      ],
      products: findProducts(["Papas Fritas", "Papas c/Crema", "Papas Provenzal"]),
    },
  ];

  let totalGroups = 0;
  let totalModifiers = 0;

  for (const grp of groups) {
    // Deduplicate products (in case a product matches multiple criteria)
    const seen = new Set<string>();
    const uniqueProducts = grp.products.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (uniqueProducts.length === 0) {
      console.log(`  ⚠ No products matched for "${grp.name}", skipping`);
      continue;
    }

    // Create one modifier_group per product (schema has product_id on modifier_groups)
    for (const product of uniqueProducts) {
      const { data: mgData, error: mgErr } = await sb
        .from("modifier_groups")
        .insert({
          business_id: businessId,
          product_id: product.id,
          name: grp.name,
          min_selection: grp.min_selection,
          max_selection: grp.max_selection,
          is_required: grp.min_selection > 0,
        })
        .select("id")
        .single();

      if (mgErr) {
        // Skip if already exists (not resetting)
        console.log(`  ⚠ Modifier group "${grp.name}" for "${product.name}": ${mgErr.message}`);
        continue;
      }

      totalGroups++;

      // Insert modifier options
      const modRows = grp.options.map((opt, idx) => ({
        group_id: mgData.id,
        name: opt.name,
        price_delta_cents: opt.price_delta_cents,
        sort_order: idx,
        is_available: true,
      }));

      await rpc(
        () => sb.from("modifiers").insert(modRows),
        `insert modifiers for ${grp.name}/${product.name}`,
      );
      totalModifiers += modRows.length;
    }

    console.log(`✓ "${grp.name}": ${uniqueProducts.length} products linked`);
  }

  inc("modifier_groups", totalGroups);
  inc("modifiers", totalModifiers);
  console.log(`✓ ${totalGroups} modifier groups, ${totalModifiers} modifiers total`);
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 5 — FLOOR PLANS + TABLES
// ════════════════════════════════════════════════════════════════════════════

async function fase5_floor_plans(businessId: string) {
  header("FASE 5 — Floor Plans + Tables");

  const plans = [
    { name: "Salón principal", width: 760, height: 660, tables: SALON_TABLES },
    { name: "Salón 2", width: 700, height: 620, tables: SALON_2_TABLES },
  ];

  for (const plan of plans) {
    const fp = await rpc(
      () =>
        sb
          .from("floor_plans")
          .insert({
            business_id: businessId,
            name: plan.name,
            width: plan.width,
            height: plan.height,
          })
          .select("id")
          .single(),
      `insert floor_plan ${plan.name}`,
    );
    inc("floor_plans");

    for (const t of plan.tables) {
      await rpc(
        () =>
          sb.from("tables").insert({
            floor_plan_id: fp.id,
            label: t.label,
            seats: t.seats,
            shape: t.shape,
            x: t.x,
            y: t.y,
            width: t.width,
            height: t.height,
          }),
        `insert table ${t.label}`,
      );
    }

    inc("tables", plan.tables.length);
    console.log(`✓ ${plan.name}: ${plan.tables.length} tables`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 6 — RESERVATION SETTINGS
// ════════════════════════════════════════════════════════════════════════════

async function fase6_reservations(businessId: string) {
  header("FASE 6 — Reservation Settings");

  await rpc(
    () =>
      sb.from("reservation_settings").upsert(
        {
          business_id: businessId,
          schedule: RESERVATION_SCHEDULE,
          slot_duration_min: 90,
          buffer_min: 15,
          lead_time_min: 60,
          advance_days_max: 30,
          max_party_size: 12,
        },
        { onConflict: "business_id" },
      ),
    "upsert reservation_settings",
  );

  inc("reservation_settings");
  console.log("✓ Reservation settings upserted");
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 7 — TEAM
// ════════════════════════════════════════════════════════════════════════════

async function fase7_team(businessId: string) {
  header("FASE 7 — Team");

  const userIds: Map<string, string> = new Map();

  for (const member of TEAM) {
    // Check if auth user exists
    const { data: existingUsers } = await sb.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((u: any) => u.email === member.email);

    let userId: string;

    if (existing) {
      userId = existing.id;
      console.log(`  ✓ Auth user exists: ${member.email} (${userId})`);
    } else {
      const { data: newUser, error } = await sb.auth.admin.createUser({
        email: member.email,
        password: TEAM_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: member.name },
      });
      if (error) {
        console.error(`  ✗ Failed to create auth user ${member.email}: ${error.message}`);
        continue;
      }
      userId = newUser.user.id;
      console.log(`  ✓ Auth user created: ${member.email} (${userId})`);
    }

    userIds.set(member.email, userId);

    // Upsert into public.users
    await sb.from("users").upsert(
      { id: userId, email: member.email, full_name: member.name },
      { onConflict: "id" },
    );

    // Upsert business_users
    const { error: buErr } = await sb.from("business_users").upsert(
      {
        business_id: businessId,
        user_id: userId,
        role: member.role,
        pin: member.pin,
        full_name: member.name,
      },
      { onConflict: "business_id,user_id" },
    );

    if (buErr) {
      console.error(`  ✗ business_users for ${member.email}: ${buErr.message}`);
    }
  }

  inc("team_members", userIds.size);
  console.log(`✓ ${userIds.size} team members`);

  // ── Assign mozos to tables ──
  const pedroId = userIds.get("pedro@demo.test");
  const diegoId = userIds.get("diego@demo.test");
  const luciaId = userIds.get("lucia@demo.test");

  if (pedroId && diegoId && luciaId) {
    // Fetch salon principal tables
    const { data: fp1 } = await sb
      .from("floor_plans")
      .select("id")
      .eq("business_id", businessId)
      .eq("name", "Salón principal")
      .single();

    if (fp1) {
      const { data: tables1 } = await sb
        .from("tables")
        .select("id, label")
        .eq("floor_plan_id", fp1.id)
        .order("label");

      if (tables1) {
        const half = Math.ceil(tables1.length / 2);
        const pedroTables = tables1.slice(0, half);
        const diegoTables = tables1.slice(half);

        for (const t of pedroTables) {
          await sb.from("tables").update({ mozo_id: pedroId }).eq("id", t.id);
        }
        for (const t of diegoTables) {
          await sb.from("tables").update({ mozo_id: diegoId }).eq("id", t.id);
        }
        console.log(`✓ Pedro: ${pedroTables.length} tables, Diego: ${diegoTables.length} tables (Salón principal)`);
      }
    }

    // Fetch salon 2 tables
    const { data: fp2 } = await sb
      .from("floor_plans")
      .select("id")
      .eq("business_id", businessId)
      .eq("name", "Salón 2")
      .single();

    if (fp2) {
      const { data: tables2 } = await sb
        .from("tables")
        .select("id")
        .eq("floor_plan_id", fp2.id);

      if (tables2) {
        for (const t of tables2) {
          await sb.from("tables").update({ mozo_id: luciaId }).eq("id", t.id);
        }
        console.log(`✓ Lucía: ${tables2.length} tables (Salón 2)`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 8 — INGREDIENTS + RECIPES
// ════════════════════════════════════════════════════════════════════════════

async function fase8_ingredients_recipes(businessId: string) {
  header("FASE 8 — Ingredients + Recipes");

  const ingredientMap = new Map<string, string>(); // name -> id

  for (const ing of INGREDIENTS) {
    const { data: ingRow } = await sb
      .from("ingredients")
      .insert({
        business_id: businessId,
        name: ing.name,
        unit: ing.unit,
        waste_percent: ing.waste_percent,
        stock_quantity: ing.stock_quantity,
        stock_min_alert: ing.stock_min_alert,
      })
      .select("id")
      .single();

    if (!ingRow) {
      console.error(`  ✗ Failed to insert ingredient: ${ing.name}`);
      continue;
    }

    ingredientMap.set(ing.name, ingRow.id);

    // Insert presentations
    for (const pres of ing.presentations) {
      await sb.from("ingredient_presentations").insert({
        ingredient_id: ingRow.id,
        name: pres.name,
        net_quantity: pres.net_quantity,
        cost_cents: pres.cost_cents,
        is_default: pres.is_default,
      });
    }
  }

  inc("ingredients", INGREDIENTS.length);
  console.log(`✓ ${INGREDIENTS.length} ingredients with presentations`);

  // ── Recipes ──
  // Fetch products for matching
  const { data: allProducts } = await sb
    .from("products")
    .select("id, name")
    .eq("business_id", businessId);
  const productByName = new Map(allProducts!.map((p: any) => [p.name, p.id]));

  let recipeCount = 0;
  let lineCount = 0;

  for (const recipe of RECIPES) {
    const productId = productByName.get(recipe.product_name);
    if (!productId) {
      console.log(`  ⚠ Product not found for recipe: "${recipe.product_name}"`);
      continue;
    }

    // Insert recipe lines (recipes table is product_id + ingredient_id, no separate recipe row)
    for (const line of recipe.lines) {
      const ingredientId = ingredientMap.get(line.ingredient_name);
      if (!ingredientId) {
        console.log(`  ⚠ Ingredient not found: "${line.ingredient_name}" (recipe: ${recipe.product_name})`);
        continue;
      }

      const { error } = await sb.from("recipes").upsert(
        {
          product_id: productId,
          ingredient_id: ingredientId,
          quantity: line.quantity,
          notes: line.notes ?? null,
        },
        { onConflict: "product_id,ingredient_id" },
      );

      if (error) {
        console.error(`  ✗ Recipe line ${recipe.product_name}/${line.ingredient_name}: ${error.message}`);
      } else {
        lineCount++;
      }
    }
    recipeCount++;
  }

  inc("recipes", recipeCount);
  inc("recipe_lines", lineCount);
  console.log(`✓ ${recipeCount} recipes, ${lineCount} recipe lines`);
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 9 — STOCK DE BEBIDAS
// ════════════════════════════════════════════════════════════════════════════

async function fase9_stock(businessId: string) {
  header("FASE 9 — Stock de Bebidas");

  const beverageCategories = [
    "Aguas", "Gaseosas", "Cervezas", "Espumantes",
    "Whiskys", "Aperitivos", "Vinos", "Kiosko",
  ];

  // Fetch categories
  const { data: cats } = await sb
    .from("categories")
    .select("id, name")
    .eq("business_id", businessId);
  const bevCatIds = new Set(
    cats!.filter((c: any) => beverageCategories.includes(c.name)).map((c: any) => c.id),
  );

  // Fetch products in those categories
  const { data: allProducts } = await sb
    .from("products")
    .select("id, name, category_id")
    .eq("business_id", businessId);

  const bevProducts = allProducts!.filter((p: any) => bevCatIds.has(p.category_id));

  let stockCount = 0;

  for (const product of bevProducts) {
    // Set track_stock = true
    await sb.from("products").update({ track_stock: true }).eq("id", product.id);

    // 25% chance of low stock (1-3), rest normal (12-48)
    const isLow = Math.random() < 0.25;
    const currentQty = isLow ? randInt(1, 3) : randInt(12, 48);
    const minQty = isLow ? 5 : randInt(3, 10);

    // Check if stock_item exists
    const { data: existing } = await sb
      .from("stock_items")
      .select("id")
      .eq("business_id", businessId)
      .eq("product_id", product.id)
      .maybeSingle();

    let stockItemId: string;

    if (existing) {
      await sb
        .from("stock_items")
        .update({ current_qty: currentQty, min_qty: minQty })
        .eq("id", existing.id);
      stockItemId = existing.id;
    } else {
      const { data: si } = await sb
        .from("stock_items")
        .insert({
          business_id: businessId,
          product_id: product.id,
          current_qty: currentQty,
          min_qty: minQty,
          unit: "unidad",
        })
        .select("id")
        .single();
      stockItemId = si!.id;
    }

    // Insert initial "ingreso" movimiento
    await sb.from("stock_movimientos").insert({
      stock_item_id: stockItemId,
      business_id: businessId,
      kind: "ingreso",
      qty: currentQty,
      reason: "Stock inicial seed",
    });

    stockCount++;
  }

  inc("stock_items", stockCount);
  console.log(`✓ ${stockCount} beverage products with stock tracking enabled`);
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 10 — CHATBOT CONFIG
// ════════════════════════════════════════════════════════════════════════════

async function fase10_chatbot(businessId: string) {
  header("FASE 10 — Chatbot Config");

  await rpc(
    () =>
      sb.from("chatbot_configs").upsert(
        {
          business_id: businessId,
          system_prompt: "",
          enabled_tools: null,
        },
        { onConflict: "business_id" },
      ),
    "upsert chatbot_configs",
  );

  inc("chatbot_configs");
  console.log("✓ Chatbot config upserted (defaults)");
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 11 — DAILY MENUS
// ════════════════════════════════════════════════════════════════════════════

async function fase11_daily_menus(businessId: string) {
  header("FASE 11 — Daily Menus");

  const menus = [
    {
      name: "Menú Ejecutivo",
      slug: "menu-ejecutivo",
      price_cents: 3500000,
      available_days: [1, 2, 3, 4, 5], // Lun-Vie
      components: [
        "Entrada del día",
        "Plato principal",
        "Postre",
        "Bebida",
      ],
    },
    {
      name: "Menú de Fin de Semana",
      slug: "menu-fin-de-semana",
      price_cents: 4500000,
      available_days: [0, 6], // Dom, Sáb
      components: [
        "Entrada especial",
        "Plato premium",
        "Postre del chef",
        "Café",
      ],
    },
  ];

  for (const menu of menus) {
    const menuRow = await rpc(
      () =>
        sb
          .from("daily_menus")
          .insert({
            business_id: businessId,
            name: menu.name,
            slug: menu.slug,
            price_cents: menu.price_cents,
            is_active: true,
            is_available: true,
            available_days: menu.available_days,
          })
          .select("id")
          .single(),
      `insert daily_menu ${menu.name}`,
    );

    // Insert components
    const componentRows = menu.components.map((label, idx) => ({
      menu_id: menuRow.id,
      label,
      kind: "text" as const,
      sort_order: idx,
    }));

    await rpc(
      () => sb.from("daily_menu_components").insert(componentRows),
      `insert components for ${menu.name}`,
    );

    console.log(`✓ "${menu.name}": ${menu.components.length} components`);
  }

  inc("daily_menus", menus.length);
  console.log(`✓ ${menus.length} daily menus created`);
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 12 — CAJAS
// ════════════════════════════════════════════════════════════════════════════

async function fase12_cajas(businessId: string) {
  header("FASE 12 — Cajas");

  // spec 160 · la Caja Mayor va acá y no sólo en el trigger de la 0067: este
  // script hace `del("cajas")` antes de correr, y el trigger es `after insert on
  // businesses` — con el negocio ya creado no vuelve a dispararse. Sin esta fila,
  // después del primer reseed el pago a proveedor se queda sin caja de dónde salir.
  const cajas = [
    { name: "Caja Principal", sort_order: 0, is_administrative: false },
    { name: "Caja Bar", sort_order: 1, is_administrative: false },
    { name: "Caja Mayor", sort_order: 1000, is_administrative: true },
  ];

  for (const c of cajas) {
    await rpc(
      () =>
        sb.from("cajas").upsert(
          {
            business_id: businessId,
            name: c.name,
            sort_order: c.sort_order,
            is_active: true,
            is_administrative: c.is_administrative,
          },
          { onConflict: "business_id,name" },
        ),
      `upsert caja ${c.name}`,
    );
  }

  inc("cajas", cajas.length);
  console.log(`✓ ${cajas.length} cajas`);
}

// ════════════════════════════════════════════════════════════════════════════
// FASE 13 — PAYMENT METHOD CONFIGS
// ════════════════════════════════════════════════════════════════════════════

async function fase13_payment_methods(businessId: string) {
  header("FASE 13 — Payment Method Configs");

  const methods = [
    { method: "cash", label: "Efectivo", adjustment_percent: 0, sort_order: 0 },
    { method: "card_manual", label: "Tarjeta", adjustment_percent: 10, sort_order: 1 },
    { method: "transfer", label: "Transferencia", adjustment_percent: 0, sort_order: 2 },
    { method: "mp_qr", label: "Mercado Pago QR", adjustment_percent: 5, sort_order: 3 },
  ];

  for (const m of methods) {
    await rpc(
      () =>
        sb.from("payment_method_configs").upsert(
          {
            business_id: businessId,
            method: m.method,
            label: m.label,
            adjustment_percent: m.adjustment_percent,
            sort_order: m.sort_order,
            is_active: true,
          },
          { onConflict: "business_id,method" },
        ),
      `upsert payment_method ${m.method}`,
    );
  }

  inc("payment_method_configs", methods.length);
  console.log(`✓ ${methods.length} payment methods`);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SEED ESTRUCTURA — ${SLUG}`);
  console.log(`${"═".repeat(60)}`);

  let businessId: string;
  try {
    businessId = await fase1_business();
  } catch (err: any) {
    console.error(`\n✗ Seed failed at fase1_business: ${err.message ?? err}`);
    process.exit(1);
  }

  // Cada fase corre aislada: si una falla, se loguea y se sigue con el resto
  // (así un bug en, p.ej., daily_menus no impide seedear cajas / payment_methods).
  const phases: [string, (id: string) => Promise<unknown>][] = [
    ["fase0_cleanup", fase0_cleanup],
    ["fase2_hours", fase2_hours],
    ["fase3_catalogo", fase3_catalogo],
    ["fase4_modifiers", fase4_modifiers],
    ["fase5_floor_plans", fase5_floor_plans],
    ["fase6_reservations", fase6_reservations],
    ["fase7_team", fase7_team],
    ["fase8_ingredients_recipes", fase8_ingredients_recipes],
    ["fase9_stock", fase9_stock],
    ["fase10_chatbot", fase10_chatbot],
    ["fase11_daily_menus", fase11_daily_menus],
    ["fase12_cajas", fase12_cajas],
    ["fase13_payment_methods", fase13_payment_methods],
  ];

  const failed: string[] = [];
  for (const [name, fn] of phases) {
    try {
      await fn(businessId);
    } catch (err: any) {
      failed.push(name);
      console.error(`\n  ⚠ ${name} falló: ${err.message ?? err} — sigo con el resto`);
    }
  }

  // ── Summary ──
  header("RESUMEN");
  for (const [key, val] of Object.entries(counts).sort()) {
    console.log(`  ${key}: ${val}`);
  }
  if (failed.length) {
    console.log(`\n⚠ Seed completado con fases fallidas: ${failed.join(", ")}`);
  } else {
    console.log(`\n✓ Seed completed for ${SLUG}`);
  }
}

main();
