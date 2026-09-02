/**
 * Shared seed data constants and helper functions.
 *
 * Extracted from seed-all.ts so they can be reused by both seed-all.ts and
 * seed-demo.ts without duplicating definitions. This file has NO imports —
 * it is pure data and utility functions.
 */

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickWeighted<T>(items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.weight; if (r <= 0) return it.value; }
  return items[0]!.value;
}

export function minsAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

export type CategoryDef = { name: string; default_station: string | null; super_category: string };

export type ProductDef = { name: string; price_cents: number; category: string; station?: string };

// ════════════════════════════════════════════════════════════════════════════
// CATÁLOGO
// ════════════════════════════════════════════════════════════════════════════

export const STATIONS = [
  { name: "Cocina", sort_order: 0 },
  { name: "Parrilla", sort_order: 1 },
  { name: "Fritera", sort_order: 2 },
  { name: "Postres y Café", sort_order: 3 },
] as const;

export const SUPER_CATEGORIES: { name: string; slug: string; icon: string; color: string }[] = [
  { name: "Bebidas", slug: "bebidas", icon: "glass-water", color: "sky" },
  { name: "Picar y Ensaladas", slug: "picar-y-ensaladas", icon: "salad", color: "lime" },
  { name: "Cafetería", slug: "cafeteria", icon: "coffee", color: "amber" },
  { name: "Entradas y Minutas", slug: "entradas-y-minutas", icon: "utensils-crossed", color: "orange" },
  { name: "Pastas", slug: "pastas", icon: "soup", color: "yellow" },
  { name: "Parrilla", slug: "parrilla", icon: "flame", color: "red" },
  { name: "Pescados", slug: "pescados", icon: "fish", color: "cyan" },
  { name: "Platos", slug: "platos", icon: "chef-hat", color: "violet" },
  { name: "Postres", slug: "postres", icon: "cake-slice", color: "pink" },
  { name: "Vinos", slug: "vinos", icon: "wine", color: "rose" },
];

export const CATEGORIES: CategoryDef[] = [
  { name: "Aguas", default_station: null, super_category: "Bebidas" },
  { name: "Gaseosas", default_station: null, super_category: "Bebidas" },
  { name: "Cervezas", default_station: null, super_category: "Bebidas" },
  { name: "Aperitivos", default_station: null, super_category: "Bebidas" },
  { name: "Whiskys", default_station: null, super_category: "Bebidas" },
  { name: "Espumantes", default_station: null, super_category: "Bebidas" },
  { name: "Sandwich", default_station: null, super_category: "Picar y Ensaladas" },
  { name: "Minutas", default_station: "Cocina", super_category: "Picar y Ensaladas" },
  { name: "Cafetería", default_station: "Postres y Café", super_category: "Cafetería" },
  { name: "Minutas y Fritos", default_station: "Fritera", super_category: "Entradas y Minutas" },
  { name: "Pastas", default_station: "Cocina", super_category: "Pastas" },
  { name: "Parrilla", default_station: "Parrilla", super_category: "Parrilla" },
  { name: "Pescados", default_station: "Cocina", super_category: "Pescados" },
  { name: "Platos", default_station: "Cocina", super_category: "Platos" },
  { name: "Menú", default_station: "Cocina", super_category: "Platos" },
  { name: "Postres", default_station: "Postres y Café", super_category: "Postres" },
  { name: "Kiosko", default_station: null, super_category: "Bebidas" },
  { name: "Vinos", default_station: null, super_category: "Vinos" },
  { name: "Entradas", default_station: "Cocina", super_category: "Entradas y Minutas" },
  { name: "Varios", default_station: null, super_category: "Platos" },
];

export const PRODUCTS: ProductDef[] = [
  // ── Aguas ──
  { name: "Soda", price_cents: 300000, category: "Aguas" },
  { name: "Agua Mineral", price_cents: 300000, category: "Aguas" },
  { name: "Agua Mineral c/Gas", price_cents: 300000, category: "Aguas" },
  { name: "Gatorade", price_cents: 330000, category: "Aguas" },
  { name: "Limonada Soda", price_cents: 800000, category: "Aguas", station: "Postres y Café" },
  { name: "Limonada Agua", price_cents: 800000, category: "Aguas", station: "Postres y Café" },
  // ── Gaseosas ──
  { name: "Gaseosa", price_cents: 350000, category: "Gaseosas" },
  { name: "Descorche", price_cents: 1500000, category: "Gaseosas" },
  { name: "Coca Cola 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Coca Zero 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Sprite 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Sprite Zero 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Fanta 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Fanta Zero 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Aquarius Naranja 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Aquarius Pomelo 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Aquarius Limonada 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Schweppes Pomelo 500ml", price_cents: 300000, category: "Gaseosas" },
  { name: "Schweppes Pomelo Zero 500ml", price_cents: 300000, category: "Gaseosas" },
  // ── Cervezas ──
  { name: "Andes 473cc", price_cents: 450000, category: "Cervezas" },
  { name: "Stella Artois 473cc", price_cents: 550000, category: "Cervezas" },
  { name: "Stella Artois Noire 473cc", price_cents: 590000, category: "Cervezas" },
  { name: "Andes 1lt", price_cents: 750000, category: "Cervezas" },
  { name: "Stella Artois 1lt", price_cents: 850000, category: "Cervezas" },
  { name: "Stella Artois Noire 1lt", price_cents: 850000, category: "Cervezas" },
  // ── Aperitivos ──
  { name: "Fernet", price_cents: 400000, category: "Aperitivos" },
  { name: "Gancia", price_cents: 400000, category: "Aperitivos" },
  { name: "Campari", price_cents: 500000, category: "Aperitivos" },
  { name: "Cynar", price_cents: 400000, category: "Aperitivos" },
  { name: "Cinzano", price_cents: 400000, category: "Aperitivos" },
  { name: "Campari con Naranja", price_cents: 750000, category: "Aperitivos" },
  { name: "Coloradito", price_cents: 750000, category: "Aperitivos" },
  { name: "Negroni", price_cents: 600000, category: "Aperitivos", station: "Postres y Café" },
  { name: "Gin Beefeater", price_cents: 650000, category: "Aperitivos" },
  { name: "Gin", price_cents: 650000, category: "Aperitivos" },
  { name: "Gin Bosque", price_cents: 500000, category: "Aperitivos" },
  { name: "Baileys", price_cents: 200000, category: "Aperitivos" },
  { name: "Gancia Batido", price_cents: 700000, category: "Aperitivos" },
  // ── Whiskys ──
  { name: "Johnny Red Label", price_cents: 950000, category: "Whiskys" },
  { name: "Johnny Black Label", price_cents: 1200000, category: "Whiskys" },
  // ── Espumantes ──
  { name: "Copa Champán", price_cents: 250000, category: "Espumantes" },
  { name: "Las Perdices Espumante", price_cents: 2000000, category: "Espumantes" },
  { name: "Trumpeter Extra Brut", price_cents: 2200000, category: "Espumantes" },
  { name: "Salentein Brut Nature", price_cents: 2450000, category: "Espumantes" },
  { name: "Barón B", price_cents: 5050000, category: "Espumantes" },
  // ── Sandwich ──
  { name: "Bollito Mixto", price_cents: 320000, category: "Sandwich" },
  { name: "Bollito Crudo", price_cents: 400000, category: "Sandwich" },
  { name: "Bollito Primavera", price_cents: 350000, category: "Sandwich" },
  { name: "Traviata Queso", price_cents: 300000, category: "Sandwich" },
  { name: "Traviata Mixta", price_cents: 320000, category: "Sandwich" },
  { name: "Traviata Crudo", price_cents: 400000, category: "Sandwich" },
  { name: "Lactal Mixto", price_cents: 380000, category: "Sandwich" },
  { name: "Lactal Crudo", price_cents: 550000, category: "Sandwich" },
  { name: "Lactal Primavera", price_cents: 550000, category: "Sandwich" },
  { name: "Lactal Atún", price_cents: 400000, category: "Sandwich" },
  { name: "Lactal c/Tomate", price_cents: 450000, category: "Sandwich" },
  { name: "Flauta Mixta", price_cents: 500000, category: "Sandwich" },
  { name: "Flauta Crudo", price_cents: 800000, category: "Sandwich" },
  { name: "Flauta Primavera", price_cents: 700000, category: "Sandwich" },
  { name: "Flauta Primavera de Crudo", price_cents: 900000, category: "Sandwich" },
  { name: "Pebete Primavera", price_cents: 700000, category: "Sandwich" },
  { name: "Pebete Crudo", price_cents: 800000, category: "Sandwich", station: "Cocina" },
  { name: "Miga Crudo", price_cents: 900000, category: "Sandwich" },
  { name: "Bagel", price_cents: 900000, category: "Sandwich", station: "Cocina" },
  { name: "Triple", price_cents: 900000, category: "Sandwich", station: "Cocina" },
  { name: "Familiar Jamón y Queso", price_cents: 500000, category: "Sandwich" },
  { name: "Familiar Crudo", price_cents: 800000, category: "Sandwich" },
  { name: "Familiar Salame", price_cents: 700000, category: "Sandwich" },
  { name: "Familiar Arrollado", price_cents: 950000, category: "Sandwich" },
  { name: "Familiar Milanesa", price_cents: 1000000, category: "Sandwich", station: "Cocina" },
  { name: "Familiar Milanesa J y Q", price_cents: 1200000, category: "Sandwich", station: "Cocina" },
  { name: "Familiar Milanesa Especial", price_cents: 1400000, category: "Sandwich", station: "Cocina" },
  { name: "Familiar Milanesa Especial c/H", price_cents: 1500000, category: "Sandwich", station: "Cocina" },
  { name: "Tostado Mixto", price_cents: 700000, category: "Sandwich", station: "Cocina" },
  { name: "Tostado c/Tomate", price_cents: 800000, category: "Sandwich", station: "Cocina" },
  { name: "Tostadas", price_cents: 400000, category: "Sandwich", station: "Cocina" },
  { name: "Lomito Simple", price_cents: 1500000, category: "Sandwich", station: "Parrilla" },
  { name: "Lomito Jamón y Queso", price_cents: 1800000, category: "Sandwich", station: "Parrilla" },
  { name: "Lomito Especial", price_cents: 2000000, category: "Sandwich", station: "Parrilla" },
  { name: "Lomito Especial con Huevo", price_cents: 2200000, category: "Sandwich", station: "Parrilla" },
  { name: "Choripán", price_cents: 400000, category: "Sandwich", station: "Parrilla" },
  { name: "Tarta", price_cents: 850000, category: "Sandwich" },
  // ── Minutas ──
  { name: "Queso", price_cents: 450000, category: "Minutas", station: "Cocina" },
  { name: "Jamón Crudo", price_cents: 1400000, category: "Minutas", station: "Cocina" },
  { name: "Jamón Cocido", price_cents: 250000, category: "Minutas" },
  { name: "Salame", price_cents: 500000, category: "Minutas", station: "Cocina" },
  { name: "Queso Oliva y Pimienta", price_cents: 550000, category: "Minutas", station: "Cocina" },
  { name: "Aceituna", price_cents: 300000, category: "Minutas", station: "Cocina" },
  { name: "Maní", price_cents: 300000, category: "Minutas", station: "Cocina" },
  { name: "Arrollado", price_cents: 950000, category: "Minutas" },
  { name: "Papas Copetín", price_cents: 450000, category: "Minutas", station: "Cocina" },
  // ── Cafetería ──
  { name: "Café", price_cents: 250000, category: "Cafetería", station: "Postres y Café" },
  { name: "Café Jarrita", price_cents: 300000, category: "Cafetería", station: "Postres y Café" },
  { name: "Cortado", price_cents: 250000, category: "Cafetería", station: "Postres y Café" },
  { name: "Cortado Jarrita", price_cents: 300000, category: "Cafetería", station: "Postres y Café" },
  { name: "Lágrima", price_cents: 250000, category: "Cafetería", station: "Postres y Café" },
  { name: "Lágrima Jarrita", price_cents: 300000, category: "Cafetería", station: "Postres y Café" },
  { name: "Té", price_cents: 300000, category: "Cafetería", station: "Postres y Café" },
  { name: "Espumita de Limón", price_cents: 160000, category: "Cafetería" },
  { name: "Torta Alemana", price_cents: 1000000, category: "Cafetería", station: "Postres y Café" },
  { name: "Torta Bar", price_cents: 800000, category: "Cafetería" },
  { name: "Mini Torta", price_cents: 500000, category: "Cafetería" },
  { name: "Invertida de Manzana", price_cents: 350000, category: "Cafetería" },
  { name: "Budín", price_cents: 350000, category: "Cafetería" },
  { name: "Santafesino", price_cents: 350000, category: "Cafetería" },
  { name: "Alfajor Artesanal", price_cents: 350000, category: "Cafetería" },
  { name: "Vienesas", price_cents: 200000, category: "Cafetería" },
  // ── Minutas y Fritos ──
  { name: "Papas Fritas", price_cents: 850000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Papas c/Crema", price_cents: 1200000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Papas Provenzal", price_cents: 1100000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Papas Rejilla", price_cents: 950000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Papas Española", price_cents: 850000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Papas Gratinadas", price_cents: 1500000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Papas a Caballo", price_cents: 1100000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Puré", price_cents: 800000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Puré de Manzana", price_cents: 600000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Papa Natural", price_cents: 200000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Espinaca Gratén", price_cents: 1600000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Rabas", price_cents: 1800000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Provoleta", price_cents: 1200000, category: "Minutas y Fritos", station: "Parrilla" },
  { name: "Provoleta Especial", price_cents: 1600000, category: "Minutas y Fritos", station: "Parrilla" },
  { name: "Omelette", price_cents: 1100000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Omelette Caprese", price_cents: 1200000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Omelette Espinacas y Queso Azul", price_cents: 1200000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Omelette Verdura", price_cents: 850000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Tortilla Papas", price_cents: 1400000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Tortilla c/Camarones", price_cents: 2500000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Tortilla Espinaca", price_cents: 1600000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Ensalada 1 Gusto", price_cents: 380000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada 2 Gustos", price_cents: 500000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada Completa", price_cents: 600000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada con Parmesano", price_cents: 700000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada con Parmesano y Aceitunas Negras", price_cents: 850000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada Caprese", price_cents: 1200000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada Rusa", price_cents: 650000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada Pollo Rebozado", price_cents: 2200000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada Queso Azul", price_cents: 2400000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Ensalada Tibia", price_cents: 750000, category: "Minutas y Fritos", station: "Parrilla" },
  { name: "Vithel Tonné", price_cents: 1600000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Arrollado Casero", price_cents: 1550000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Milanesa Entrecot", price_cents: 2400000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Milanesa Entrecot Napolitana", price_cents: 2850000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Milanesa Sugerencia", price_cents: 2800000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Huevo", price_cents: 200000, category: "Minutas y Fritos", station: "Fritera" },
  { name: "Tomate al Medio", price_cents: 120000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Sopa", price_cents: 500000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Manteca Porción", price_cents: 250000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Roquefort Porción", price_cents: 600000, category: "Minutas y Fritos", station: "Cocina" },
  { name: "Adicional Menú", price_cents: 400000, category: "Minutas y Fritos", station: "Cocina" },
  // ── Pastas ──
  { name: "Ñoquis", price_cents: 1600000, category: "Pastas", station: "Cocina" },
  { name: "Tallarines", price_cents: 1600000, category: "Pastas", station: "Cocina" },
  { name: "Ravioles", price_cents: 1800000, category: "Pastas", station: "Cocina" },
  { name: "Sorrentinos Jamón y Queso", price_cents: 2200000, category: "Pastas", station: "Cocina" },
  { name: "Sorrentinos Calabaza", price_cents: 2200000, category: "Pastas", station: "Cocina" },
  { name: "Sorrentinos Salmón c/Tinta", price_cents: 2500000, category: "Pastas", station: "Cocina" },
  { name: "Crepes de Verdura", price_cents: 1800000, category: "Pastas", station: "Cocina" },
  { name: "Lasagna", price_cents: 2200000, category: "Pastas", station: "Cocina" },
  { name: "Pasta Sugerencia", price_cents: 2200000, category: "Pastas", station: "Cocina" },
  { name: "Pasta Sugerencia Deli", price_cents: 2100000, category: "Pastas", station: "Cocina" },
  { name: "Bolognesa", price_cents: 400000, category: "Pastas", station: "Cocina" },
  { name: "Cuatro Quesos", price_cents: 450000, category: "Pastas", station: "Cocina" },
  { name: "Pesto", price_cents: 450000, category: "Pastas", station: "Cocina" },
  { name: "Mediterránea", price_cents: 500000, category: "Pastas", station: "Cocina" },
  { name: "Parisien", price_cents: 550000, category: "Pastas", station: "Cocina" },
  { name: "Gratén (salsa)", price_cents: 550000, category: "Pastas", station: "Cocina" },
  { name: "Bagnacauda", price_cents: 450000, category: "Pastas", station: "Cocina" },
  { name: "Caruso", price_cents: 450000, category: "Pastas", station: "Cocina" },
  { name: "Carbonara", price_cents: 500000, category: "Pastas", station: "Cocina" },
  { name: "Pomarola c/Langostinos", price_cents: 1450000, category: "Pastas", station: "Cocina" },
  // ── Parrilla ──
  { name: "Entrecot", price_cents: 2400000, category: "Parrilla", station: "Parrilla" },
  { name: "Lomo", price_cents: 2800000, category: "Parrilla", station: "Parrilla" },
  { name: "Petit Lomo", price_cents: 1700000, category: "Parrilla", station: "Parrilla" },
  { name: "Ojo de Bife", price_cents: 2900000, category: "Parrilla", station: "Parrilla" },
  { name: "Matambrito", price_cents: 2300000, category: "Parrilla", station: "Parrilla" },
  { name: "Asado de Tira", price_cents: 3700000, category: "Parrilla", station: "Parrilla" },
  { name: "Angus", price_cents: 3300000, category: "Parrilla", station: "Parrilla" },
  { name: "Brochette de Lomo", price_cents: 2900000, category: "Parrilla", station: "Parrilla" },
  { name: "Brochette de Pollo", price_cents: 2300000, category: "Parrilla", station: "Parrilla" },
  { name: "Entraña", price_cents: 2200000, category: "Parrilla", station: "Parrilla" },
  { name: "Chorizo", price_cents: 400000, category: "Parrilla", station: "Parrilla" },
  { name: "Morcilla", price_cents: 300000, category: "Parrilla", station: "Parrilla" },
  { name: "Molleja", price_cents: 1850000, category: "Parrilla", station: "Parrilla" },
  { name: "Chinchulines", price_cents: 950000, category: "Parrilla", station: "Parrilla" },
  { name: "Dorado", price_cents: 2000000, category: "Parrilla", station: "Parrilla" },
  { name: "Pacú Grillado", price_cents: 2500000, category: "Parrilla", station: "Parrilla" },
  { name: "Costeleton", price_cents: 1450000, category: "Parrilla", station: "Parrilla" },
  { name: "Costeleton Deli", price_cents: 900000, category: "Parrilla", station: "Parrilla" },
  { name: "Provoleta Sugerencia", price_cents: 970000, category: "Parrilla", station: "Cocina" },
  // ── Pescados ──
  { name: "Salmón Grillé", price_cents: 3200000, category: "Pescados", station: "Parrilla" },
  { name: "Salmón Especial", price_cents: 3800000, category: "Pescados", station: "Cocina" },
  { name: "Salmón Crema Camarones", price_cents: 3800000, category: "Pescados", station: "Cocina" },
  { name: "Salmón Sugerencia", price_cents: 3800000, category: "Pescados", station: "Cocina" },
  { name: "Salmón Crema Limón", price_cents: 3800000, category: "Pescados", station: "Cocina" },
  { name: "Calamaretes a la Leonesa", price_cents: 3200000, category: "Pescados", station: "Cocina" },
  { name: "Calamaretes Parmesano", price_cents: 2700000, category: "Pescados", station: "Fritera" },
  { name: "Calamaretes Grillados", price_cents: 2700000, category: "Pescados", station: "Cocina" },
  { name: "Langostinos", price_cents: 2400000, category: "Pescados", station: "Fritera" },
  { name: "Abadejo Sugerencia", price_cents: 2800000, category: "Pescados", station: "Cocina" },
  { name: "Merluza Sugerencia", price_cents: 2000000, category: "Pescados", station: "Cocina" },
  { name: "Boga Despinada", price_cents: 2000000, category: "Pescados", station: "Parrilla" },
  // ── Platos ──
  { name: "Milanesa", price_cents: 1800000, category: "Platos", station: "Fritera" },
  { name: "Milanesa Napolitana", price_cents: 2250000, category: "Platos", station: "Fritera" },
  { name: "Milanesa Florentina", price_cents: 1700000, category: "Platos", station: "Fritera" },
  { name: "Suprema", price_cents: 1500000, category: "Platos", station: "Fritera" },
  { name: "Suprema Napolitana", price_cents: 1900000, category: "Platos", station: "Fritera" },
  { name: "Revuelto Gramajo", price_cents: 1900000, category: "Platos", station: "Fritera" },
  { name: "Merluza Romana", price_cents: 1700000, category: "Platos", station: "Fritera" },
  { name: "Petit Entrecot", price_cents: 1800000, category: "Platos", station: "Parrilla" },
  { name: "Filet de Pollo", price_cents: 1900000, category: "Platos", station: "Parrilla" },
  { name: "Costillas Barbacoa", price_cents: 2800000, category: "Platos", station: "Parrilla" },
  { name: "Lomo Reducción", price_cents: 3450000, category: "Platos", station: "Cocina" },
  { name: "Lomo Relleno", price_cents: 3450000, category: "Platos", station: "Cocina" },
  { name: "Lomo Sugerencia", price_cents: 3400000, category: "Platos", station: "Cocina" },
  { name: "Entrecot Especial", price_cents: 3250000, category: "Platos", station: "Cocina" },
  { name: "Ojo de Bife Sugerencia", price_cents: 3300000, category: "Platos", station: "Parrilla" },
  { name: "Matambrito Pizza", price_cents: 3300000, category: "Platos", station: "Cocina" },
  { name: "Matambrito Roquefort Nueces", price_cents: 2800000, category: "Platos", station: "Cocina" },
  { name: "Matambrito Sugerencia", price_cents: 2800000, category: "Platos", station: "Parrilla" },
  { name: "Osobuco Braseado", price_cents: 2300000, category: "Platos", station: "Cocina" },
  { name: "Solomillo Especial", price_cents: 2600000, category: "Platos", station: "Cocina" },
  { name: "Solomillo Sugerencia", price_cents: 2800000, category: "Platos", station: "Cocina" },
  { name: "Bondiola Sugerencia", price_cents: 2500000, category: "Platos", station: "Cocina" },
  { name: "Pollo Especial", price_cents: 2600000, category: "Platos", station: "Cocina" },
  { name: "Pollo Sugerencia", price_cents: 2600000, category: "Platos", station: "Cocina" },
  { name: "Salteado Molleja Verdeo", price_cents: 3250000, category: "Platos", station: "Cocina" },
  { name: "Espinaca Salteada", price_cents: 950000, category: "Platos", station: "Cocina" },
  { name: "Locro", price_cents: 2300000, category: "Platos", station: "Cocina" },
  { name: "Guiso", price_cents: 1900000, category: "Platos", station: "Cocina" },
  { name: "Mondongo", price_cents: 850000, category: "Platos", station: "Cocina" },
  { name: "Strogonoff", price_cents: 830000, category: "Platos", station: "Cocina" },
  { name: "Saltimbocca", price_cents: 1200000, category: "Platos", station: "Cocina" },
  { name: "Chop Suey", price_cents: 2800000, category: "Platos", station: "Cocina" },
  { name: "Langostinos Sugerencia", price_cents: 2600000, category: "Platos", station: "Cocina" },
  { name: "Ensalada Sugerencia", price_cents: 2700000, category: "Platos", station: "Cocina" },
  { name: "Ragú Sugerencia", price_cents: 2200000, category: "Platos", station: "Cocina" },
  { name: "Carré Sugerencia", price_cents: 2400000, category: "Platos", station: "Cocina" },
  { name: "Costeletas Sugerencia", price_cents: 2000000, category: "Platos", station: "Cocina" },
  { name: "Sugerencia Menú 2", price_cents: 1000000, category: "Platos", station: "Cocina" },
  // ── Menú ──
  { name: "Menú", price_cents: 3500000, category: "Menú", station: "Cocina" },
  { name: "Menú Jugadores", price_cents: 2500000, category: "Menú" },
  { name: "Menú Milanesa", price_cents: 2100000, category: "Menú", station: "Fritera" },
  { name: "Menú Pasta", price_cents: 1400000, category: "Menú", station: "Cocina" },
  { name: "Menú Médicos Go", price_cents: 1200000, category: "Menú", station: "Cocina" },
  // ── Postres ──
  { name: "Helado Simple", price_cents: 450000, category: "Postres", station: "Postres y Café" },
  { name: "Helado Doble", price_cents: 600000, category: "Postres", station: "Postres y Café" },
  { name: "Helado Especial", price_cents: 550000, category: "Postres", station: "Postres y Café" },
  { name: "Helado Especial Doble", price_cents: 750000, category: "Postres", station: "Postres y Café" },
  { name: "Helado Sambayón", price_cents: 550000, category: "Postres", station: "Postres y Café" },
  { name: "Bombón Escocés", price_cents: 400000, category: "Postres", station: "Postres y Café" },
  { name: "Bombón Suizo", price_cents: 400000, category: "Postres", station: "Postres y Café" },
  { name: "Almendrado", price_cents: 400000, category: "Postres", station: "Postres y Café" },
  { name: "Ensalada de Frutas", price_cents: 500000, category: "Postres", station: "Postres y Café" },
  { name: "Flan", price_cents: 700000, category: "Postres", station: "Postres y Café" },
  { name: "Macedonia", price_cents: 800000, category: "Postres", station: "Postres y Café" },
  { name: "Tiramisú", price_cents: 1000000, category: "Postres", station: "Postres y Café" },
  { name: "Mousse de Chocolate", price_cents: 1000000, category: "Postres", station: "Postres y Café" },
  { name: "Mousse de Naranja", price_cents: 1000000, category: "Postres", station: "Postres y Café" },
  { name: "Cheesecake", price_cents: 800000, category: "Postres", station: "Postres y Café" },
  { name: "Panqueques Dulce de Leche", price_cents: 900000, category: "Postres", station: "Postres y Café" },
  { name: "Pera al Vino", price_cents: 900000, category: "Postres", station: "Postres y Café" },
  { name: "Queso y Dulce", price_cents: 1500000, category: "Postres", station: "Postres y Café" },
  { name: "Don Pedro", price_cents: 1200000, category: "Postres", station: "Postres y Café" },
  { name: "Sambayón Batido", price_cents: 1400000, category: "Postres", station: "Cocina" },
  { name: "Tortilla de Manzana", price_cents: 1800000, category: "Postres", station: "Cocina" },
  { name: "Tortilla Normanda", price_cents: 2600000, category: "Postres", station: "Cocina" },
  { name: "Frutillas c/Crema", price_cents: 700000, category: "Postres", station: "Postres y Café" },
  { name: "Brownie c/Helado", price_cents: 800000, category: "Postres", station: "Postres y Café" },
  { name: "Isla Flotante", price_cents: 400000, category: "Postres", station: "Postres y Café" },
  { name: "Torta", price_cents: 1000000, category: "Postres", station: "Postres y Café" },
  { name: "Torta Postre C", price_cents: 1000000, category: "Postres", station: "Postres y Café" },
  { name: "Lemon Champán", price_cents: 700000, category: "Postres", station: "Postres y Café" },
  { name: "Crumble de Manzana", price_cents: 800000, category: "Postres", station: "Postres y Café" },
  { name: "Pavlova", price_cents: 600000, category: "Postres", station: "Postres y Café" },
  // ── Kiosko ──
  { name: "Citric", price_cents: 330000, category: "Kiosko" },
  { name: "Citric 500cc", price_cents: 330000, category: "Kiosko" },
  { name: "Citric 250cc", price_cents: 250000, category: "Kiosko" },
  { name: "Cindor", price_cents: 200000, category: "Kiosko" },
  { name: "Yogur Bebible", price_cents: 250000, category: "Kiosko" },
  { name: "Cepita Botella", price_cents: 200000, category: "Kiosko" },
  { name: "Chocolate Alpino", price_cents: 350000, category: "Kiosko" },
  { name: "Alfajor Terrabusi", price_cents: 200000, category: "Kiosko" },
  { name: "Alfajor Fantoche", price_cents: 150000, category: "Kiosko" },
  { name: "Alfajor Frank", price_cents: 300000, category: "Kiosko" },
  { name: "Alfajor Milka", price_cents: 200000, category: "Kiosko" },
  { name: "Cachafaz", price_cents: 260000, category: "Kiosko" },
  { name: "Cookies", price_cents: 300000, category: "Kiosko" },
  { name: "Maicena", price_cents: 300000, category: "Kiosko" },
  { name: "Copito", price_cents: 250000, category: "Kiosko" },
  { name: "Mini Rogel", price_cents: 250000, category: "Kiosko" },
  { name: "Kinder", price_cents: 200000, category: "Kiosko" },
  { name: "Milka", price_cents: 250000, category: "Kiosko" },
  { name: "Rhodesia", price_cents: 100000, category: "Kiosko" },
  { name: "Tita", price_cents: 100000, category: "Kiosko" },
  { name: "Barrita Cereal", price_cents: 230000, category: "Kiosko" },
  { name: "Turrón", price_cents: 100000, category: "Kiosko" },
  { name: "Mix Frutos", price_cents: 250000, category: "Kiosko" },
  { name: "Chicle", price_cents: 150000, category: "Kiosko" },
  { name: "Pastillas", price_cents: 150000, category: "Kiosko" },
  { name: "Muecas", price_cents: 230000, category: "Kiosko" },
  { name: "Banana", price_cents: 130000, category: "Kiosko" },
  { name: "Shot", price_cents: 250000, category: "Kiosko" },
  { name: "Chocolate", price_cents: 150000, category: "Kiosko" },
  // ── Vinos ──
  { name: "Copa de Vino Tinto", price_cents: 400000, category: "Vinos" },
  { name: "Copa de Vino Blanco", price_cents: 400000, category: "Vinos" },
  { name: "Crios Malbec", price_cents: 1100000, category: "Vinos" },
  { name: "Crios Chardonnay", price_cents: 1100000, category: "Vinos" },
  { name: "Crios Rosé of Malbec", price_cents: 1100000, category: "Vinos" },
  { name: "Amalaya Malbec", price_cents: 1300000, category: "Vinos" },
  { name: "Amalaya Torrontés", price_cents: 1250000, category: "Vinos" },
  { name: "Amalaya Corte de Origen", price_cents: 1800000, category: "Vinos" },
  { name: "Amalaya Gran Corte", price_cents: 2250000, category: "Vinos" },
  { name: "Amalaya Corte Único", price_cents: 3900000, category: "Vinos" },
  { name: "Punto Final", price_cents: 1400000, category: "Vinos" },
  { name: "Punto Final Reserva", price_cents: 2200000, category: "Vinos" },
  { name: "Las Perdices Malbec", price_cents: 1500000, category: "Vinos" },
  { name: "Las Perdices Reserva", price_cents: 2100000, category: "Vinos" },
  { name: "Las Perdices Reserva 1/3", price_cents: 1350000, category: "Vinos" },
  { name: "Las Perdices 1/3", price_cents: 1090000, category: "Vinos" },
  { name: "Las Perdices Red Blend", price_cents: 1600000, category: "Vinos" },
  { name: "Las Perdices Sauvignon Blanc", price_cents: 1600000, category: "Vinos" },
  { name: "Las Perdices Pinot Noir", price_cents: 2300000, category: "Vinos" },
  { name: "Las Perdices Don Juan", price_cents: 3750000, category: "Vinos" },
  { name: "Las Perdices Exploracion Rosé", price_cents: 2650000, category: "Vinos" },
  { name: "Trumpeter", price_cents: 1450000, category: "Vinos" },
  { name: "Trumpeter Reserve", price_cents: 1950000, category: "Vinos" },
  { name: "Trumpeter Sauvignon Blanc", price_cents: 1450000, category: "Vinos" },
  { name: "Trumpeter Reserve Rosé", price_cents: 1750000, category: "Vinos" },
  { name: "Saint Felicien Malbec", price_cents: 2000000, category: "Vinos" },
  { name: "Saint Felicien Cabernet Franc", price_cents: 2200000, category: "Vinos" },
  { name: "Salentein Reserva", price_cents: 1900000, category: "Vinos" },
  { name: "Salentein Reserva Sauvignon Blanc", price_cents: 1850000, category: "Vinos" },
  { name: "Salentein Numina", price_cents: 3000000, category: "Vinos" },
  { name: "Salentein Numina Chardonnay", price_cents: 3000000, category: "Vinos" },
  { name: "Salentein Numina Pinot Noir", price_cents: 2900000, category: "Vinos" },
  { name: "Cuvelier Malbec", price_cents: 2800000, category: "Vinos" },
  { name: "Cuvelier Merlot", price_cents: 2800000, category: "Vinos" },
  { name: "Cuvelier Cabernet Sauvignon", price_cents: 2800000, category: "Vinos" },
  { name: "Cuvelier Colección", price_cents: 3300000, category: "Vinos" },
  { name: "Rutini Malbec", price_cents: 3800000, category: "Vinos" },
  { name: "Rutini Cabernet Franc", price_cents: 3400000, category: "Vinos" },
  { name: "Rutini Cabernet", price_cents: 2500000, category: "Vinos" },
  { name: "Rutini Chardonnay", price_cents: 3250000, category: "Vinos" },
  { name: "Rutini Sauvignon Blanc", price_cents: 2500000, category: "Vinos" },
  { name: "Rutini 1/3", price_cents: 1400000, category: "Vinos" },
  { name: "DV Catena Malbec", price_cents: 3900000, category: "Vinos" },
  { name: "DV Catena Cabernet", price_cents: 3050000, category: "Vinos" },
  { name: "DV Catena Chardonnay", price_cents: 2700000, category: "Vinos" },
  { name: "Angelica Zapata Alta", price_cents: 4000000, category: "Vinos" },
  { name: "Colomé Estate Malbec", price_cents: 2600000, category: "Vinos" },
  { name: "Nicasia", price_cents: 1950000, category: "Vinos" },
  { name: "Killka Blend", price_cents: 1600000, category: "Vinos" },
  { name: "Uno Antigal", price_cents: 1700000, category: "Vinos" },
  { name: "Puramun Reserva Malbec", price_cents: 2400000, category: "Vinos" },
  { name: "Puramun Cofermentado", price_cents: 2400000, category: "Vinos" },
  { name: "Clos de los 7", price_cents: 2750000, category: "Vinos" },
  { name: "Milamore", price_cents: 3600000, category: "Vinos" },
  { name: "Legado Dante Robino", price_cents: 3600000, category: "Vinos" },
  { name: "Gran Dante", price_cents: 4800000, category: "Vinos" },
  { name: "Yacochuya Torrontés", price_cents: 1500000, category: "Vinos" },
  { name: "Yacochuya", price_cents: 2700000, category: "Vinos" },
  { name: "Jockey Joven", price_cents: 1600000, category: "Vinos" },
  { name: "Jockey Reserva", price_cents: 2200000, category: "Vinos" },
  { name: "Doña Paula", price_cents: 330000, category: "Vinos" },
  { name: "La Anita", price_cents: 620000, category: "Vinos" },
  { name: "Petite Fleur", price_cents: 830000, category: "Vinos" },
  // ── Entradas ──
  { name: "Empanada Carne", price_cents: 350000, category: "Entradas", station: "Fritera" },
  { name: "Empanada Cuchillo", price_cents: 350000, category: "Entradas", station: "Fritera" },
  { name: "Empanada Jamón y Queso", price_cents: 300000, category: "Entradas", station: "Fritera" },
  { name: "Empanada Pescado", price_cents: 200000, category: "Entradas", station: "Cocina" },
  { name: "Empanada Verdura", price_cents: 190000, category: "Entradas", station: "Cocina" },
  { name: "Porción Manteca", price_cents: 300000, category: "Entradas", station: "Cocina" },
  // ── Varios ──
  { name: "Arroz con Mariscos", price_cents: 2500000, category: "Varios", station: "Cocina" },
  { name: "Risotto Sugerencia", price_cents: 2200000, category: "Varios", station: "Cocina" },
  { name: "Cazuela", price_cents: 2200000, category: "Varios", station: "Cocina" },
  { name: "Wok Sugerencia", price_cents: 2000000, category: "Varios", station: "Cocina" },
  { name: "Pastel de Papas", price_cents: 1700000, category: "Varios", station: "Cocina" },
  { name: "Brochette Sugerencia", price_cents: 2800000, category: "Varios", station: "Parrilla" },
  { name: "Dorado Sugerencia", price_cents: 2100000, category: "Varios", station: "Parrilla" },
  { name: "Entraña Sugerencia", price_cents: 2800000, category: "Varios", station: "Parrilla" },
  { name: "Entrecot Sugerencia", price_cents: 3200000, category: "Varios", station: "Parrilla" },
  { name: "Boga Sugerencia", price_cents: 3000000, category: "Varios", station: "Parrilla" },
  { name: "Churrasquito Sugerencia", price_cents: 2600000, category: "Varios", station: "Parrilla" },
  { name: "Pacú Sugerencia", price_cents: 2800000, category: "Varios", station: "Parrilla" },
  { name: "Pescado Sugerencia", price_cents: 3200000, category: "Varios", station: "Cocina" },
  { name: "Marineras Sugerencia", price_cents: 3000000, category: "Varios", station: "Cocina" },
  { name: "Trucha Sugerencia", price_cents: 2800000, category: "Varios", station: "Cocina" },
  { name: "Suprema Sugerencia", price_cents: 1400000, category: "Varios", station: "Cocina" },
  { name: "Escalope Sugerencia", price_cents: 1800000, category: "Varios", station: "Cocina" },
  { name: "Calamar Relleno", price_cents: 420000, category: "Varios", station: "Cocina" },
  { name: "Calamaretes Sugerencia", price_cents: 1200000, category: "Varios", station: "Cocina" },
  { name: "Colita de Cuadril Sugerencia", price_cents: 2800000, category: "Varios", station: "Cocina" },
  { name: "Bife Sugerencia", price_cents: 2200000, category: "Varios", station: "Cocina" },
  { name: "Crepe Sugerencia", price_cents: 1800000, category: "Varios", station: "Cocina" },
  { name: "Torta Restaurant", price_cents: 6500000, category: "Varios" },
  { name: "Limonada con Gaseosa", price_cents: 1200000, category: "Varios", station: "Postres y Café" },
  { name: "Aperol", price_cents: 600000, category: "Varios", station: "Postres y Café" },
  { name: "Corona", price_cents: 600000, category: "Varios" },
  { name: "Amalaya Espumante", price_cents: 1800000, category: "Varios" },
];

// ════════════════════════════════════════════════════════════════════════════
// INFRAESTRUCTURA FÍSICA
// ════════════════════════════════════════════════════════════════════════════

// ── Plano principal del Golf (Maxirest plano 1): Terraza + Restaurant + Bar ──
// Fuente: mxmes del backup 20251223. Coordenadas originales de Maxirest.
// Plan dimensions: 760 x 620 (cubre el rango real de posiciones + padding)
export const SALON_TABLES = [
  // Terraza (T1–T15): 3 filas arriba del plano
  { label: "T1", seats: 4, shape: "circle" as const, x: 132, y: 150, width: 60, height: 60 },
  { label: "T2", seats: 4, shape: "circle" as const, x: 245, y: 150, width: 60, height: 60 },
  { label: "T3", seats: 4, shape: "circle" as const, x: 349, y: 150, width: 60, height: 60 },
  { label: "T4", seats: 4, shape: "rect" as const, x: 465, y: 150, width: 45, height: 65 },
  { label: "T5", seats: 4, shape: "circle" as const, x: 559, y: 150, width: 60, height: 60 },
  { label: "T6", seats: 4, shape: "circle" as const, x: 132, y: 80, width: 60, height: 60 },
  { label: "T7", seats: 4, shape: "rect" as const, x: 253, y: 80, width: 45, height: 60 },
  { label: "T8", seats: 4, shape: "circle" as const, x: 349, y: 80, width: 60, height: 60 },
  { label: "T9", seats: 4, shape: "circle" as const, x: 460, y: 80, width: 60, height: 60 },
  { label: "T10", seats: 4, shape: "rect" as const, x: 555, y: 85, width: 65, height: 45 },
  { label: "T11", seats: 4, shape: "rect" as const, x: 132, y: 5, width: 65, height: 45 },
  { label: "T12", seats: 4, shape: "circle" as const, x: 245, y: 5, width: 60, height: 60 },
  { label: "T13", seats: 4, shape: "circle" as const, x: 349, y: 5, width: 60, height: 60 },
  { label: "T14", seats: 4, shape: "rect" as const, x: 455, y: 5, width: 65, height: 45 },
  { label: "T15", seats: 4, shape: "circle" as const, x: 559, y: 5, width: 60, height: 60 },
  // Restaurant (R01–R24, R74): zona central y derecha
  { label: "R01", seats: 4, shape: "rect" as const, x: 170, y: 230, width: 45, height: 65 },
  { label: "R02", seats: 4, shape: "rect" as const, x: 290, y: 230, width: 45, height: 65 },
  { label: "R03", seats: 4, shape: "rect" as const, x: 420, y: 230, width: 45, height: 65 },
  { label: "R04", seats: 4, shape: "rect" as const, x: 550, y: 230, width: 45, height: 65 },
  { label: "R05", seats: 2, shape: "square" as const, x: 420, y: 320, width: 45, height: 45 },
  { label: "R06", seats: 4, shape: "circle" as const, x: 650, y: 226, width: 60, height: 60 },
  { label: "R07", seats: 4, shape: "rect" as const, x: 670, y: 300, width: 65, height: 45 },
  { label: "R08", seats: 4, shape: "rect" as const, x: 670, y: 370, width: 65, height: 45 },
  { label: "R09", seats: 4, shape: "rect" as const, x: 670, y: 435, width: 65, height: 45 },
  { label: "R10", seats: 4, shape: "circle" as const, x: 670, y: 493, width: 60, height: 60 },
  { label: "R11", seats: 6, shape: "circle" as const, x: 670, y: 570, width: 70, height: 70 },
  { label: "R12", seats: 4, shape: "rect" as const, x: 580, y: 570, width: 45, height: 65 },
  { label: "R13", seats: 4, shape: "circle" as const, x: 491, y: 565, width: 60, height: 60 },
  { label: "R14", seats: 4, shape: "rect" as const, x: 580, y: 440, width: 45, height: 65 },
  { label: "R15", seats: 4, shape: "circle" as const, x: 580, y: 370, width: 60, height: 60 },
  { label: "R16", seats: 6, shape: "circle" as const, x: 520, y: 320, width: 70, height: 70 },
  { label: "R17", seats: 4, shape: "rect" as const, x: 420, y: 380, width: 45, height: 65 },
  { label: "R18", seats: 2, shape: "square" as const, x: 290, y: 320, width: 45, height: 45 },
  { label: "R19", seats: 6, shape: "circle" as const, x: 290, y: 380, width: 70, height: 70 },
  { label: "R20", seats: 4, shape: "rect" as const, x: 155, y: 320, width: 65, height: 45 },
  { label: "R21", seats: 4, shape: "rect" as const, x: 155, y: 390, width: 65, height: 45 },
  { label: "R22", seats: 4, shape: "rect" as const, x: 20, y: 390, width: 65, height: 45 },
  { label: "R23", seats: 4, shape: "rect" as const, x: 20, y: 320, width: 65, height: 45 },
  { label: "R24", seats: 4, shape: "rect" as const, x: 20, y: 250, width: 65, height: 45 },
  { label: "R74", seats: 2, shape: "square" as const, x: 580, y: 515, width: 45, height: 45 },
  // Bar (BAR1–BAR3): esquina superior izquierda
  { label: "BAR1", seats: 4, shape: "circle" as const, x: 20, y: 5, width: 60, height: 60 },
  { label: "BAR2", seats: 4, shape: "circle" as const, x: 20, y: 80, width: 60, height: 60 },
  { label: "BAR3", seats: 4, shape: "rect" as const, x: 20, y: 150, width: 45, height: 65 },
];

// ── Plano 2 del Golf (Maxirest plano 2): 27 mesas ──
// Plan dimensions: 700 x 620
export const SALON_2_TABLES = [
  { label: "101", seats: 2, shape: "square" as const, x: 104, y: 311, width: 45, height: 45 },
  { label: "102", seats: 2, shape: "square" as const, x: 45, y: 311, width: 45, height: 45 },
  { label: "103", seats: 6, shape: "rect" as const, x: 54, y: 159, width: 45, height: 90 },
  { label: "104", seats: 6, shape: "rect" as const, x: 70, y: 52, width: 45, height: 90 },
  { label: "105", seats: 4, shape: "rect" as const, x: 204, y: 29, width: 45, height: 85 },
  { label: "106", seats: 4, shape: "rect" as const, x: 340, y: 29, width: 45, height: 85 },
  { label: "107", seats: 2, shape: "square" as const, x: 459, y: 29, width: 45, height: 45 },
  { label: "108", seats: 6, shape: "rect" as const, x: 148, y: 142, width: 90, height: 45 },
  { label: "109", seats: 6, shape: "rect" as const, x: 147, y: 214, width: 90, height: 45 },
  { label: "110", seats: 6, shape: "rect" as const, x: 246, y: 215, width: 90, height: 45 },
  { label: "111", seats: 6, shape: "rect" as const, x: 347, y: 214, width: 90, height: 45 },
  { label: "112", seats: 8, shape: "circle" as const, x: 256, y: 103, width: 90, height: 90 },
  { label: "113", seats: 6, shape: "circle" as const, x: 370, y: 131, width: 65, height: 65 },
  { label: "114", seats: 6, shape: "rect" as const, x: 444, y: 96, width: 90, height: 45 },
  { label: "115", seats: 8, shape: "circle" as const, x: 454, y: 160, width: 90, height: 90 },
  { label: "116", seats: 6, shape: "circle" as const, x: 487, y: 261, width: 65, height: 65 },
  { label: "117", seats: 6, shape: "circle" as const, x: 579, y: 51, width: 70, height: 70 },
  { label: "118", seats: 6, shape: "rect" as const, x: 572, y: 149, width: 90, height: 45 },
  { label: "119", seats: 6, shape: "rect" as const, x: 573, y: 234, width: 90, height: 45 },
  { label: "120", seats: 6, shape: "circle" as const, x: 586, y: 312, width: 70, height: 70 },
  { label: "121", seats: 8, shape: "circle" as const, x: 479, y: 385, width: 90, height: 90 },
  { label: "122", seats: 6, shape: "rect" as const, x: 580, y: 400, width: 90, height: 45 },
  { label: "123", seats: 6, shape: "rect" as const, x: 580, y: 456, width: 90, height: 45 },
  { label: "124", seats: 6, shape: "rect" as const, x: 579, y: 508, width: 90, height: 45 },
  { label: "125", seats: 6, shape: "circle" as const, x: 501, y: 479, width: 65, height: 65 },
  { label: "126", seats: 4, shape: "square" as const, x: 421, y: 472, width: 50, height: 50 },
  { label: "127", seats: 4, shape: "square" as const, x: 422, y: 525, width: 50, height: 50 },
];

export const RESERVATION_SCHEDULE: Record<string, { open: boolean; slots: string[] }> = {
  "0": { open: true, slots: ["12:00", "13:00", "13:30", "20:30", "21:00", "21:30"] },
  "1": { open: false, slots: [] },
  "2": { open: true, slots: ["12:00", "13:00", "13:30", "20:30", "21:00", "21:30"] },
  "3": { open: true, slots: ["12:00", "13:00", "13:30", "20:30", "21:00", "21:30"] },
  "4": { open: true, slots: ["12:00", "13:00", "13:30", "20:30", "21:00", "21:30", "22:00"] },
  "5": { open: true, slots: ["12:00", "13:00", "13:30", "20:30", "21:00", "21:30", "22:00"] },
  "6": { open: true, slots: ["12:00", "13:00", "13:30", "20:30", "21:00", "21:30", "22:00"] },
};

// ════════════════════════════════════════════════════════════════════════════
// EQUIPO
// ════════════════════════════════════════════════════════════════════════════

export const TEAM = [
  { email: "admin@demo.test", name: "Carlos Admin", role: "admin", pin: null },
  { email: "sofia@demo.test", name: "Sofía Encargada", role: "encargado", pin: "1234" },
  { email: "pedro@demo.test", name: "Pedro Mozo", role: "mozo", pin: "1111" },
  { email: "lucia@demo.test", name: "Lucía Moza", role: "mozo", pin: "2222" },
  { email: "diego@demo.test", name: "Diego Mozo", role: "mozo", pin: "3333" },
  { email: "ramon@demo.test", name: "Ramón Cocina", role: "personal", pin: "4444" },
  { email: "marta@demo.test", name: "Marta Limpieza", role: "personal", pin: "5555" },
  // Spec 140 — el puesto compartido del salón. No es una persona: es la PC que
  // usan todos los mozos cuando no tienen móvil. Sin PIN: no ficha (los que
  // fichan desde ella son los mozos, cada uno con el suyo).
  { email: "terminal@demo.test", name: "Terminal Salón", role: "terminal", pin: null },
] as const;

export const TEAM_PASSWORD = "demo1234";

// ════════════════════════════════════════════════════════════════════════════
// HISTORIAL
// ════════════════════════════════════════════════════════════════════════════

export const FIRST_NAMES = [
  "María", "Juan", "Laura", "Diego", "Sofía", "Martín", "Carolina", "Pablo",
  "Florencia", "Sebastián", "Valentina", "Mateo", "Camila", "Lucas", "Agustina",
];

export const LAST_NAMES = [
  "González", "Rodríguez", "Fernández", "López", "Martínez", "García",
  "Pérez", "Sánchez", "Romero", "Sosa", "Díaz", "Torres", "Gómez", "Álvarez",
  "Ruiz",
];

export const STREETS = [
  "Pellegrini", "Córdoba", "Rioja", "San Lorenzo", "Mendoza", "San Juan",
  "Salta", "Entre Ríos", "Sarmiento", "Mitre",
];

export const RESERVATION_NOTES = [
  null, null, null,
  "Cumpleaños", "Mesa cerca de la ventana si es posible", "Aniversario",
  "Vienen con un bebé, traer silla alta", "Un comensal celíaco",
  "Reunión de trabajo", "Mesa tranquila si se puede",
];

// ════════════════════════════════════════════════════════════════════════════
// INGREDIENTES Y RECETAS (Fase 6 — plan-recetas-costeo)
// ════════════════════════════════════════════════════════════════════════════

export type IngredientDef = {
  name: string;
  unit: "kg" | "lt" | "un" | "g" | "ml";
  waste_percent: number;
  stock_quantity: number;
  stock_min_alert: number | null;
  presentations: { name: string; net_quantity: number; cost_cents: number; is_default: boolean }[];
};

export type RecipeDef = {
  /** Must match a product name from PRODUCTS */
  product_name: string;
  lines: { ingredient_name: string; quantity: number; notes?: string }[];
};

export const INGREDIENTS: IngredientDef[] = [
  {
    name: "Entrecot",
    unit: "kg",
    waste_percent: 12,
    stock_quantity: 18,
    stock_min_alert: 5,
    presentations: [
      { name: "Compra 10kg", net_quantity: 10, cost_cents: 1510000, is_default: true },
    ],
  },
  {
    name: "Lomo",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 12,
    stock_min_alert: 4,
    presentations: [
      { name: "Pieza 5kg", net_quantity: 5, cost_cents: 2100000, is_default: true },
    ],
  },
  {
    name: "Entraña",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Pieza 3kg", net_quantity: 3, cost_cents: 2100000, is_default: true },
    ],
  },
  {
    name: "Ojo de bife",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Pieza 5kg", net_quantity: 5, cost_cents: 1963800, is_default: true },
    ],
  },
  {
    name: "Matambre de vaca",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Pieza 3kg", net_quantity: 3, cost_cents: 1820000, is_default: true },
    ],
  },
  {
    name: "Matambre de cerdo",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 6,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 3kg", net_quantity: 3, cost_cents: 1124000, is_default: true },
    ],
  },
  {
    name: "Nalga",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Pieza 5kg", net_quantity: 5, cost_cents: 1800000, is_default: true },
    ],
  },
  {
    name: "Costilla asado",
    unit: "kg",
    waste_percent: 18,
    stock_quantity: 25,
    stock_min_alert: 8,
    presentations: [
      { name: "Compra 10kg", net_quantity: 10, cost_cents: 1790000, is_default: true },
    ],
  },
  {
    name: "Carne picada",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Compra 5kg", net_quantity: 5, cost_cents: 920000, is_default: true },
    ],
  },
  {
    name: "Chorizo",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 6,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 3kg", net_quantity: 3, cost_cents: 867200, is_default: true },
    ],
  },
  {
    name: "Morcilla",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 3kg", net_quantity: 3, cost_cents: 383000, is_default: true },
    ],
  },
  {
    name: "Molleja",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 2kg", net_quantity: 2, cost_cents: 2650000, is_default: true },
    ],
  },
  {
    name: "Chinchulines",
    unit: "kg",
    waste_percent: 20,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 2kg", net_quantity: 2, cost_cents: 680000, is_default: true },
    ],
  },
  {
    name: "Peceto",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 3kg", net_quantity: 3, cost_cents: 1820000, is_default: true },
    ],
  },
  {
    name: "Solomillo",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 2kg", net_quantity: 2, cost_cents: 904700, is_default: true },
    ],
  },
  {
    name: "Bondiola de cerdo",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 3kg", net_quantity: 3, cost_cents: 815000, is_default: true },
    ],
  },
  {
    name: "Carré de cerdo",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 3kg", net_quantity: 3, cost_cents: 567300, is_default: true },
    ],
  },
  {
    name: "Costilla de cerdo",
    unit: "kg",
    waste_percent: 12,
    stock_quantity: 6,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 5kg", net_quantity: 5, cost_cents: 769900, is_default: true },
    ],
  },
  {
    name: "Churrasquito",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 3kg", net_quantity: 3, cost_cents: 1003000, is_default: true },
    ],
  },
  {
    name: "Osobuco",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 3kg", net_quantity: 3, cost_cents: 760200, is_default: true },
    ],
  },
  {
    name: "Pollo entero",
    unit: "kg",
    waste_percent: 25,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Unidad 2.5kg", net_quantity: 2.5, cost_cents: 300000, is_default: true },
    ],
  },
  {
    name: "Pechuga de pollo",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Compra 5kg", net_quantity: 5, cost_cents: 466700, is_default: true },
    ],
  },
  {
    name: "Filet de salmón",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 2kg", net_quantity: 2, cost_cents: 1590000, is_default: true },
    ],
  },
  {
    name: "Langostinos pelados",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 1790000, is_default: true },
    ],
  },
  {
    name: "Calamaretes",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Bolsa 2kg", net_quantity: 2, cost_cents: 1590000, is_default: true },
    ],
  },
  {
    name: "Tubo de calamar",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Bolsa 2kg", net_quantity: 2, cost_cents: 1690000, is_default: true },
    ],
  },
  {
    name: "Filet de merluza",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Compra 3kg", net_quantity: 3, cost_cents: 590000, is_default: true },
    ],
  },
  {
    name: "Boga despinada",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Compra 2kg", net_quantity: 2, cost_cents: 1190000, is_default: true },
    ],
  },
  {
    name: "Filet de abadejo",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Compra 2kg", net_quantity: 2, cost_cents: 1890000, is_default: true },
    ],
  },
  {
    name: "Pacú",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Compra 2kg", net_quantity: 2, cost_cents: 1280000, is_default: true },
    ],
  },
  {
    name: "Salmón entero",
    unit: "kg",
    waste_percent: 30,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Pieza 4kg", net_quantity: 4, cost_cents: 1690000, is_default: true },
    ],
  },
  {
    name: "Muzarella",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Barra 5kg", net_quantity: 5, cost_cents: 800000, is_default: true },
    ],
  },
  {
    name: "Queso provolone",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Horma 4kg", net_quantity: 4, cost_cents: 1560000, is_default: true },
    ],
  },
  {
    name: "Queso barra",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 6,
    stock_min_alert: 2,
    presentations: [
      { name: "Barra 4kg", net_quantity: 4, cost_cents: 800000, is_default: true },
    ],
  },
  {
    name: "Queso azul",
    unit: "kg",
    waste_percent: 3,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Horma 2kg", net_quantity: 2, cost_cents: 1240000, is_default: true },
    ],
  },
  {
    name: "Queso sardo",
    unit: "kg",
    waste_percent: 3,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Horma 3kg", net_quantity: 3, cost_cents: 1290000, is_default: true },
    ],
  },
  {
    name: "Queso crema",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Pote 3.5kg", net_quantity: 3.5, cost_cents: 640600, is_default: true },
    ],
  },
  {
    name: "Crema de leche",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 6,
    stock_min_alert: 2,
    presentations: [
      { name: "Sachet 1lt", net_quantity: 1, cost_cents: 630000, is_default: true },
    ],
  },
  {
    name: "Manteca",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Pan 200g", net_quantity: 0.2, cost_cents: 216960, is_default: true },
    ],
  },
  {
    name: "Bocconcinos",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Pote 1kg", net_quantity: 1, cost_cents: 1473900, is_default: true },
    ],
  },
  {
    name: "Leche",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Sachet 1lt", net_quantity: 1, cost_cents: 134200, is_default: true },
    ],
  },
  {
    name: "Jamón crudo",
    unit: "kg",
    waste_percent: 3,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 4kg", net_quantity: 4, cost_cents: 2150000, is_default: true },
    ],
  },
  {
    name: "Jamón cocido",
    unit: "kg",
    waste_percent: 3,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Pieza 4kg", net_quantity: 4, cost_cents: 941200, is_default: true },
    ],
  },
  {
    name: "Panceta ahumada",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Pieza 2kg", net_quantity: 2, cost_cents: 1824000, is_default: true },
    ],
  },
  {
    name: "Salame bastón",
    unit: "kg",
    waste_percent: 3,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Pieza 2kg", net_quantity: 2, cost_cents: 1240400, is_default: true },
    ],
  },
  {
    name: "Papa",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 50,
    stock_min_alert: 10,
    presentations: [
      { name: "Bolsa 50kg", net_quantity: 50, cost_cents: 100000, is_default: true },
    ],
  },
  {
    name: "Tomate",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 12,
    stock_min_alert: 4,
    presentations: [
      { name: "Cajón 20kg", net_quantity: 20, cost_cents: 225000, is_default: true },
    ],
  },
  {
    name: "Tomate cherry",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Bandeja 250g", net_quantity: 0.25, cost_cents: 200000, is_default: true },
    ],
  },
  {
    name: "Lechuga",
    unit: "kg",
    waste_percent: 20,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Cajón 3kg", net_quantity: 3, cost_cents: 315000, is_default: true },
    ],
  },
  {
    name: "Rúcula",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Atado 250g", net_quantity: 0.25, cost_cents: 312500, is_default: true },
    ],
  },
  {
    name: "Cebolla",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 15,
    stock_min_alert: 5,
    presentations: [
      { name: "Bolsa 10kg", net_quantity: 10, cost_cents: 50000, is_default: true },
    ],
  },
  {
    name: "Espinaca",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Atado 1kg", net_quantity: 1, cost_cents: 350000, is_default: true },
    ],
  },
  {
    name: "Calabaza",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Unidad 3kg", net_quantity: 3, cost_cents: 66700, is_default: true },
    ],
  },
  {
    name: "Zanahoria",
    unit: "kg",
    waste_percent: 12,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 5kg", net_quantity: 5, cost_cents: 70000, is_default: true },
    ],
  },
  {
    name: "Pimiento rojo",
    unit: "kg",
    waste_percent: 12,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Cajón 5kg", net_quantity: 5, cost_cents: 600000, is_default: true },
    ],
  },
  {
    name: "Limón",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Cajón 10kg", net_quantity: 10, cost_cents: 125000, is_default: true },
    ],
  },
  {
    name: "Manzana roja",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Cajón 10kg", net_quantity: 10, cost_cents: 200900, is_default: true },
    ],
  },
  {
    name: "Manzana verde",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Cajón 10kg", net_quantity: 10, cost_cents: 299800, is_default: true },
    ],
  },
  {
    name: "Pera",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 4,
    stock_min_alert: 2,
    presentations: [
      { name: "Cajón 10kg", net_quantity: 10, cost_cents: 181300, is_default: true },
    ],
  },
  {
    name: "Frutillas",
    unit: "kg",
    waste_percent: 8,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Bandeja 1kg", net_quantity: 1, cost_cents: 357100, is_default: true },
    ],
  },
  {
    name: "Champiñones",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Bandeja 200g", net_quantity: 0.2, cost_cents: 196000, is_default: true },
    ],
  },
  {
    name: "Puerro",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Atado 500g", net_quantity: 0.5, cost_cents: 600000, is_default: true },
    ],
  },
  {
    name: "Apio",
    unit: "kg",
    waste_percent: 20,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Atado 500g", net_quantity: 0.5, cost_cents: 150000, is_default: true },
    ],
  },
  {
    name: "Acelga",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Atado 1kg", net_quantity: 1, cost_cents: 222200, is_default: true },
    ],
  },
  {
    name: "Cebolla de verdeo",
    unit: "kg",
    waste_percent: 15,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Atado 250g", net_quantity: 0.25, cost_cents: 600000, is_default: true },
    ],
  },
  {
    name: "Berenjena",
    unit: "kg",
    waste_percent: 10,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Cajón 5kg", net_quantity: 5, cost_cents: 252400, is_default: true },
    ],
  },
  {
    name: "Albahaca",
    unit: "kg",
    waste_percent: 20,
    stock_quantity: 1,
    stock_min_alert: 0.5,
    presentations: [
      { name: "Atado 100g", net_quantity: 0.1, cost_cents: 200000, is_default: true },
    ],
  },
  {
    name: "Perejil",
    unit: "kg",
    waste_percent: 20,
    stock_quantity: 1,
    stock_min_alert: 0.5,
    presentations: [
      { name: "Atado 100g", net_quantity: 0.1, cost_cents: 83330, is_default: true },
    ],
  },
  {
    name: "Ajo",
    unit: "un",
    waste_percent: 5,
    stock_quantity: 20,
    stock_min_alert: 5,
    presentations: [
      { name: "Trenza 10 un", net_quantity: 10, cost_cents: 70000, is_default: true },
    ],
  },
  {
    name: "Huevos",
    unit: "un",
    waste_percent: 3,
    stock_quantity: 120,
    stock_min_alert: 30,
    presentations: [
      { name: "Maple 30 un", net_quantity: 30, cost_cents: 576000, is_default: true },
    ],
  },
  {
    name: "Aceite de girasol",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 30,
    stock_min_alert: 5,
    presentations: [
      { name: "Bidón 5lt", net_quantity: 5, cost_cents: 297400, is_default: true },
    ],
  },
  {
    name: "Aceite de oliva",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Botella 500ml", net_quantity: 0.5, cost_cents: 869000, is_default: true },
    ],
  },
  {
    name: "Harina 0000",
    unit: "kg",
    waste_percent: 1,
    stock_quantity: 45,
    stock_min_alert: 10,
    presentations: [
      { name: "Bolsa 25kg", net_quantity: 25, cost_cents: 82000, is_default: true },
    ],
  },
  {
    name: "Rebozador",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 228300, is_default: true },
    ],
  },
  {
    name: "Azúcar",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 5kg", net_quantity: 5, cost_cents: 111600, is_default: true },
    ],
  },
  {
    name: "Sal fina",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 208700, is_default: true },
    ],
  },
  {
    name: "Sal parrillera",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 179600, is_default: true },
    ],
  },
  {
    name: "Dulce de leche",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 4,
    stock_min_alert: 1,
    presentations: [
      { name: "Balde 5kg", net_quantity: 5, cost_cents: 445100, is_default: true },
    ],
  },
  {
    name: "Arroz",
    unit: "kg",
    waste_percent: 2,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 5kg", net_quantity: 5, cost_cents: 161500, is_default: true },
    ],
  },
  {
    name: "Mayonesa",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Balde 3kg", net_quantity: 3, cost_cents: 405600, is_default: true },
    ],
  },
  {
    name: "Maicena",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Paquete 500g", net_quantity: 0.5, cost_cents: 242400, is_default: true },
    ],
  },
  {
    name: "Salsa demiglasé",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Frasco 500g", net_quantity: 0.5, cost_cents: 744350, is_default: true },
    ],
  },
  {
    name: "Chocolate negro",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Caja 1kg", net_quantity: 1, cost_cents: 1340900, is_default: true },
    ],
  },
  {
    name: "Vainillas",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Paquete 500g", net_quantity: 0.5, cost_cents: 75650, is_default: true },
    ],
  },
  {
    name: "Nueces",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 1799500, is_default: true },
    ],
  },
  {
    name: "Aceitunas verdes",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Lata 1kg", net_quantity: 1, cost_cents: 725100, is_default: true },
    ],
  },
  {
    name: "Aceitunas negras",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Lata 1kg", net_quantity: 1, cost_cents: 1238600, is_default: true },
    ],
  },
  {
    name: "Aceto balsámico",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Botella 250ml", net_quantity: 0.25, cost_cents: 243750, is_default: true },
    ],
  },
  {
    name: "Salsa barbacoa",
    unit: "ml",
    waste_percent: 0,
    stock_quantity: 2000,
    stock_min_alert: 500,
    presentations: [
      { name: "Botella 500ml", net_quantity: 500, cost_cents: 401300, is_default: true },
    ],
  },
  {
    name: "Orégano",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 1,
    stock_min_alert: 0.5,
    presentations: [
      { name: "Paquete 100g", net_quantity: 0.1, cost_cents: 300000, is_default: true },
    ],
  },
  {
    name: "Discos de empanada",
    unit: "un",
    waste_percent: 2,
    stock_quantity: 48,
    stock_min_alert: 12,
    presentations: [
      { name: "Paquete 12 un", net_quantity: 12, cost_cents: 129600, is_default: true },
    ],
  },
  {
    name: "Atún desmenuzado",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Lata 170g", net_quantity: 0.17, cost_cents: 134623, is_default: true },
    ],
  },
  {
    name: "Vino tinto (cocina)",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Botella 750ml", net_quantity: 0.75, cost_cents: 146475, is_default: true },
    ],
  },
  {
    name: "Vino blanco (cocina)",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Botella 750ml", net_quantity: 0.75, cost_cents: 129975, is_default: true },
    ],
  },
  {
    name: "Tomate deshidratado",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 2593200, is_default: true },
    ],
  },
  {
    name: "Caldo de verduras",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Frasco 500g", net_quantity: 0.5, cost_cents: 837000, is_default: true },
    ],
  },
  {
    name: "Anchoas en aceite",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 1,
    stock_min_alert: 0.5,
    presentations: [
      { name: "Lata 100g", net_quantity: 0.1, cost_cents: 489000, is_default: true },
    ],
  },
  {
    name: "Hongos de pino",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 1,
    stock_min_alert: 0.5,
    presentations: [
      { name: "Frasco 200g", net_quantity: 0.2, cost_cents: 468860, is_default: true },
    ],
  },
  {
    name: "Alcaparras",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 1,
    stock_min_alert: 0.5,
    presentations: [
      { name: "Frasco 200g", net_quantity: 0.2, cost_cents: 289220, is_default: true },
    ],
  },
  {
    name: "Panko",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 1000000, is_default: true },
    ],
  },
  {
    name: "Mostaza",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 2,
    stock_min_alert: 1,
    presentations: [
      { name: "Frasco 500g", net_quantity: 0.5, cost_cents: 128000, is_default: true },
    ],
  },
  {
    name: "Vinagre de alcohol",
    unit: "lt",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Botella 1lt", net_quantity: 1, cost_cents: 115700, is_default: true },
    ],
  },
  {
    name: "Ñoquis de papa",
    unit: "un",
    waste_percent: 10,
    stock_quantity: 20,
    stock_min_alert: 5,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 117700, is_default: true },
    ],
  },
  {
    name: "Masa pastas frescas",
    unit: "un",
    waste_percent: 6,
    stock_quantity: 15,
    stock_min_alert: 5,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 45200, is_default: true },
    ],
  },
  {
    name: "Masa pastas rellenas",
    unit: "un",
    waste_percent: 10,
    stock_quantity: 15,
    stock_min_alert: 5,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 17900, is_default: true },
    ],
  },
  {
    name: "Ravioles de verdura",
    unit: "un",
    waste_percent: 9,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 77800, is_default: true },
    ],
  },
  {
    name: "Sorrentinos JyQ",
    unit: "un",
    waste_percent: 5,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 161200, is_default: true },
    ],
  },
  {
    name: "Sorrentinos de calabaza",
    unit: "un",
    waste_percent: 5,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 103500, is_default: true },
    ],
  },
  {
    name: "Sorrentinos de salmón",
    unit: "un",
    waste_percent: 5,
    stock_quantity: 6,
    stock_min_alert: 2,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 248300, is_default: true },
    ],
  },
  {
    name: "Crepe",
    unit: "un",
    waste_percent: 25,
    stock_quantity: 20,
    stock_min_alert: 5,
    presentations: [
      { name: "Unidad", net_quantity: 1, cost_cents: 5600, is_default: true },
    ],
  },
  {
    name: "Salsa tuco",
    unit: "un",
    waste_percent: 20,
    stock_quantity: 15,
    stock_min_alert: 5,
    presentations: [
      { name: "Porción (base: 20 platos)", net_quantity: 1, cost_cents: 192000, is_default: true },
    ],
  },
  {
    name: "Salsa bolognesa",
    unit: "un",
    waste_percent: 20,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Porción (base: 20 platos)", net_quantity: 1, cost_cents: 348000, is_default: true },
    ],
  },
  {
    name: "Salsa crema",
    unit: "un",
    waste_percent: 0,
    stock_quantity: 15,
    stock_min_alert: 5,
    presentations: [
      { name: "Porción (base: 200 platos)", net_quantity: 1, cost_cents: 38300, is_default: true },
    ],
  },
  {
    name: "Salsa blanca",
    unit: "un",
    waste_percent: 10,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 15800, is_default: true },
    ],
  },
  {
    name: "Salsa 4 quesos",
    unit: "un",
    waste_percent: 0,
    stock_quantity: 8,
    stock_min_alert: 3,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 161000, is_default: true },
    ],
  },
  {
    name: "Pan de mesa",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 10,
    stock_min_alert: 3,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 250000, is_default: true },
    ],
  },
  {
    name: "Pan de miga",
    unit: "un",
    waste_percent: 5,
    stock_quantity: 40,
    stock_min_alert: 10,
    presentations: [
      { name: "Paquete 20 un", net_quantity: 20, cost_cents: 800000, is_default: true },
    ],
  },
  {
    name: "Pan lactal",
    unit: "kg",
    waste_percent: 5,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Paquete 500g", net_quantity: 0.5, cost_cents: 150000, is_default: true },
    ],
  },
  {
    name: "Pan de lomo",
    unit: "un",
    waste_percent: 3,
    stock_quantity: 30,
    stock_min_alert: 10,
    presentations: [
      { name: "Bolsa 10 un", net_quantity: 10, cost_cents: 500000, is_default: true },
    ],
  },
  {
    name: "Galletitas de agua",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 3,
    stock_min_alert: 1,
    presentations: [
      { name: "Paquete 300g", net_quantity: 0.3, cost_cents: 80000, is_default: true },
    ],
  },
  {
    name: "Espinaca congelada",
    unit: "kg",
    waste_percent: 0,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Bolsa 1kg", net_quantity: 1, cost_cents: 561100, is_default: true },
    ],
  },
  {
    name: "Puré de manzana",
    unit: "un",
    waste_percent: 0,
    stock_quantity: 5,
    stock_min_alert: 2,
    presentations: [
      { name: "Porción", net_quantity: 1, cost_cents: 50000, is_default: true },
    ],
  },
];

export const RECIPES: RecipeDef[] = [
  {
    product_name: "Entrecot",
    lines: [
      { ingredient_name: "Entrecot", quantity: 0.33 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Lomo",
    lines: [
      { ingredient_name: "Lomo", quantity: 0.35 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Petit Lomo",
    lines: [
      { ingredient_name: "Lomo", quantity: 0.25 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Ojo de Bife",
    lines: [
      { ingredient_name: "Ojo de bife", quantity: 0.65 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Matambrito",
    lines: [
      { ingredient_name: "Matambre de cerdo", quantity: 0.36 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Asado de Tira",
    lines: [
      { ingredient_name: "Costilla asado", quantity: 0.78 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Entraña",
    lines: [
      { ingredient_name: "Entraña", quantity: 0.4 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Chorizo",
    lines: [
      { ingredient_name: "Chorizo", quantity: 0.18 },
    ],
  },
  {
    product_name: "Morcilla",
    lines: [
      { ingredient_name: "Morcilla", quantity: 0.11 },
    ],
  },
  {
    product_name: "Molleja",
    lines: [
      { ingredient_name: "Molleja", quantity: 0.3 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Chinchulines",
    lines: [
      { ingredient_name: "Chinchulines", quantity: 0.3 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Filet de Pollo",
    lines: [
      { ingredient_name: "Pechuga de pollo", quantity: 0.32 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Salmón Grillé",
    lines: [
      { ingredient_name: "Salmón entero", quantity: 0.31 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Dorado",
    lines: [
      { ingredient_name: "Pacú", quantity: 0.5 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Pacú Grillado",
    lines: [
      { ingredient_name: "Pacú", quantity: 0.6 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Boga Despinada",
    lines: [
      { ingredient_name: "Boga despinada", quantity: 1.2 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Brochette de Lomo",
    lines: [
      { ingredient_name: "Lomo", quantity: 0.3 },
      { ingredient_name: "Pimiento rojo", quantity: 0.08 },
      { ingredient_name: "Cebolla", quantity: 0.06 },
    ],
  },
  {
    product_name: "Brochette de Pollo",
    lines: [
      { ingredient_name: "Pechuga de pollo", quantity: 0.3 },
      { ingredient_name: "Pimiento rojo", quantity: 0.08 },
      { ingredient_name: "Cebolla", quantity: 0.06 },
    ],
  },
  {
    product_name: "Provoleta",
    lines: [
      { ingredient_name: "Queso provolone", quantity: 0.28 },
      { ingredient_name: "Aceite de oliva", quantity: 0.012 },
      { ingredient_name: "Orégano", quantity: 0.01 },
    ],
  },
  {
    product_name: "Provoleta Especial",
    lines: [
      { ingredient_name: "Queso provolone", quantity: 0.28 },
      { ingredient_name: "Tomate", quantity: 0.2 },
      { ingredient_name: "Rúcula", quantity: 0.02 },
      { ingredient_name: "Orégano", quantity: 0.001 },
      { ingredient_name: "Jamón crudo", quantity: 0.055 },
    ],
  },
  {
    product_name: "Choripán",
    lines: [
      { ingredient_name: "Chorizo", quantity: 0.18 },
      { ingredient_name: "Pan de mesa", quantity: 0.1 },
    ],
  },
  {
    product_name: "Ensalada Tibia",
    lines: [
      { ingredient_name: "Queso azul", quantity: 0.06 },
      { ingredient_name: "Pera", quantity: 0.1 },
      { ingredient_name: "Panceta ahumada", quantity: 0.08 },
      { ingredient_name: "Rúcula", quantity: 0.1 },
      { ingredient_name: "Lechuga", quantity: 0.06 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Nueces", quantity: 0.02 },
    ],
  },
  {
    product_name: "Milanesa",
    lines: [
      { ingredient_name: "Nalga", quantity: 0.18 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Milanesa Napolitana",
    lines: [
      { ingredient_name: "Nalga", quantity: 0.18 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Jamón cocido", quantity: 0.12 },
      { ingredient_name: "Muzarella", quantity: 0.08 },
      { ingredient_name: "Salsa tuco", quantity: 1 },
      { ingredient_name: "Orégano", quantity: 0.005 },
    ],
  },
  {
    product_name: "Milanesa Florentina",
    lines: [
      { ingredient_name: "Nalga", quantity: 0.18 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Espinaca congelada", quantity: 0.15 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
    ],
  },
  {
    product_name: "Milanesa Entrecot",
    lines: [
      { ingredient_name: "Entrecot", quantity: 0.33 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Milanesa Entrecot Napolitana",
    lines: [
      { ingredient_name: "Entrecot", quantity: 0.33 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Jamón cocido", quantity: 0.12 },
      { ingredient_name: "Muzarella", quantity: 0.08 },
      { ingredient_name: "Salsa tuco", quantity: 1 },
      { ingredient_name: "Orégano", quantity: 0.005 },
    ],
  },
  {
    product_name: "Suprema",
    lines: [
      { ingredient_name: "Pechuga de pollo", quantity: 0.32 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Suprema Napolitana",
    lines: [
      { ingredient_name: "Pechuga de pollo", quantity: 0.32 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Jamón cocido", quantity: 0.12 },
      { ingredient_name: "Muzarella", quantity: 0.08 },
      { ingredient_name: "Salsa tuco", quantity: 1 },
      { ingredient_name: "Orégano", quantity: 0.005 },
    ],
  },
  {
    product_name: "Merluza Romana",
    lines: [
      { ingredient_name: "Filet de merluza", quantity: 0.36 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Harina 0000", quantity: 0.015 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Rabas",
    lines: [
      { ingredient_name: "Tubo de calamar", quantity: 0.4 },
      { ingredient_name: "Harina 0000", quantity: 0.025 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Langostinos",
    lines: [
      { ingredient_name: "Langostinos pelados", quantity: 0.38 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Panko", quantity: 0.06 },
      { ingredient_name: "Aceite de oliva", quantity: 0.012 },
      { ingredient_name: "Papa", quantity: 0.175 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Revuelto Gramajo",
    lines: [
      { ingredient_name: "Huevos", quantity: 4 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Jamón cocido", quantity: 0.08 },
      { ingredient_name: "Queso barra", quantity: 0.06 },
      { ingredient_name: "Papa", quantity: 0.2 },
    ],
  },
  {
    product_name: "Tortilla Papas",
    lines: [
      { ingredient_name: "Huevos", quantity: 4 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Cebolla", quantity: 0.12 },
      { ingredient_name: "Queso sardo", quantity: 0.06 },
    ],
  },
  {
    product_name: "Tortilla c/Camarones",
    lines: [
      { ingredient_name: "Huevos", quantity: 4 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Langostinos pelados", quantity: 0.14 },
      { ingredient_name: "Espinaca congelada", quantity: 0.34 },
      { ingredient_name: "Cebolla", quantity: 0.12 },
      { ingredient_name: "Queso sardo", quantity: 0.06 },
    ],
  },
  {
    product_name: "Tortilla Espinaca",
    lines: [
      { ingredient_name: "Huevos", quantity: 4 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Espinaca congelada", quantity: 0.34 },
      { ingredient_name: "Cebolla", quantity: 0.12 },
      { ingredient_name: "Queso sardo", quantity: 0.06 },
    ],
  },
  {
    product_name: "Omelette",
    lines: [
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Jamón cocido", quantity: 0.06 },
      { ingredient_name: "Queso barra", quantity: 0.05 },
    ],
  },
  {
    product_name: "Omelette Caprese",
    lines: [
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Bocconcinos", quantity: 0.08 },
      { ingredient_name: "Tomate cherry", quantity: 0.06 },
      { ingredient_name: "Albahaca", quantity: 0.01 },
    ],
  },
  {
    product_name: "Omelette Espinacas y Queso Azul",
    lines: [
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Espinaca congelada", quantity: 0.15 },
      { ingredient_name: "Queso azul", quantity: 0.05 },
    ],
  },
  {
    product_name: "Omelette Verdura",
    lines: [
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Calabaza", quantity: 0.08 },
      { ingredient_name: "Cebolla", quantity: 0.04 },
      { ingredient_name: "Pimiento rojo", quantity: 0.04 },
    ],
  },
  {
    product_name: "Papas Fritas",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Aceite de girasol", quantity: 0.1 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Papas c/Crema",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Aceite de girasol", quantity: 0.1 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Crema de leche", quantity: 0.05 },
    ],
  },
  {
    product_name: "Papas Provenzal",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Aceite de girasol", quantity: 0.1 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Ajo", quantity: 0.1 },
      { ingredient_name: "Perejil", quantity: 0.01 },
    ],
  },
  {
    product_name: "Papas Rejilla",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Aceite de girasol", quantity: 0.12 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Papas Española",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Huevos", quantity: 2 },
      { ingredient_name: "Cebolla", quantity: 0.08 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Papas Gratinadas",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Salsa crema", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.06 },
    ],
  },
  {
    product_name: "Papas a Caballo",
    lines: [
      { ingredient_name: "Papa", quantity: 0.35 },
      { ingredient_name: "Aceite de girasol", quantity: 0.1 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Huevos", quantity: 2 },
    ],
  },
  {
    product_name: "Puré",
    lines: [
      { ingredient_name: "Papa", quantity: 1 },
      { ingredient_name: "Manteca", quantity: 0.1 },
      { ingredient_name: "Leche", quantity: 0.15 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Puré de Manzana",
    lines: [
      { ingredient_name: "Manzana verde", quantity: 0.4 },
      { ingredient_name: "Manteca", quantity: 0.05 },
      { ingredient_name: "Azúcar", quantity: 0.15 },
    ],
  },
  {
    product_name: "Espinaca Gratén",
    lines: [
      { ingredient_name: "Espinaca congelada", quantity: 0.34 },
      { ingredient_name: "Queso sardo", quantity: 0.08 },
      { ingredient_name: "Salsa crema", quantity: 1 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Ensalada Caprese",
    lines: [
      { ingredient_name: "Bocconcinos", quantity: 0.15 },
      { ingredient_name: "Tomate cherry", quantity: 0.12 },
      { ingredient_name: "Aceitunas negras", quantity: 0.03 },
      { ingredient_name: "Albahaca", quantity: 0.08 },
    ],
  },
  {
    product_name: "Ensalada Pollo Rebozado",
    lines: [
      { ingredient_name: "Pechuga de pollo", quantity: 0.18 },
      { ingredient_name: "Rebozador", quantity: 0.01 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Rúcula", quantity: 0.1 },
      { ingredient_name: "Lechuga", quantity: 0.06 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
    ],
  },
  {
    product_name: "Vithel Tonné",
    lines: [
      { ingredient_name: "Peceto", quantity: 2.8 },
      { ingredient_name: "Mayonesa", quantity: 0.5 },
      { ingredient_name: "Crema de leche", quantity: 0.25 },
      { ingredient_name: "Mostaza", quantity: 0.05 },
      { ingredient_name: "Vinagre de alcohol", quantity: 0.015 },
      { ingredient_name: "Anchoas en aceite", quantity: 0.035 },
      { ingredient_name: "Atún desmenuzado", quantity: 0.28 },
    ],
  },
  {
    product_name: "Arrollado Casero",
    lines: [
      { ingredient_name: "Matambre de vaca", quantity: 2.65 },
      { ingredient_name: "Huevos", quantity: 8 },
      { ingredient_name: "Queso sardo", quantity: 0.1 },
      { ingredient_name: "Rebozador", quantity: 0.025 },
      { ingredient_name: "Perejil", quantity: 0.015 },
      { ingredient_name: "Aceitunas verdes", quantity: 0.015 },
      { ingredient_name: "Jamón cocido", quantity: 0.125 },
      { ingredient_name: "Queso barra", quantity: 0.125 },
      { ingredient_name: "Pimiento rojo", quantity: 0.15 },
      { ingredient_name: "Zanahoria", quantity: 0.1 },
      { ingredient_name: "Acelga", quantity: 0.35 },
    ],
  },
  {
    product_name: "Ñoquis",
    lines: [
      { ingredient_name: "Ñoquis de papa", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Tallarines",
    lines: [
      { ingredient_name: "Masa pastas frescas", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Ravioles",
    lines: [
      { ingredient_name: "Ravioles de verdura", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Sorrentinos Jamón y Queso",
    lines: [
      { ingredient_name: "Sorrentinos JyQ", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Sorrentinos Calabaza",
    lines: [
      { ingredient_name: "Sorrentinos de calabaza", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Sorrentinos Salmón c/Tinta",
    lines: [
      { ingredient_name: "Sorrentinos de salmón", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Crepes de Verdura",
    lines: [
      { ingredient_name: "Crepe", quantity: 2 },
      { ingredient_name: "Pimiento rojo", quantity: 0.05 },
      { ingredient_name: "Acelga", quantity: 0.25 },
      { ingredient_name: "Cebolla", quantity: 0.05 },
      { ingredient_name: "Leche", quantity: 0.15 },
      { ingredient_name: "Harina 0000", quantity: 0.05 },
      { ingredient_name: "Queso barra", quantity: 0.1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Aceite de girasol", quantity: 0.02 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Lasagna",
    lines: [
      { ingredient_name: "Masa pastas frescas", quantity: 1 },
      { ingredient_name: "Salsa bolognesa", quantity: 2 },
      { ingredient_name: "Salsa blanca", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.08 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Bolognesa",
    lines: [
      { ingredient_name: "Salsa bolognesa", quantity: 2 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
    ],
  },
  {
    product_name: "Cuatro Quesos",
    lines: [
      { ingredient_name: "Salsa 4 quesos", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
    ],
  },
  {
    product_name: "Pesto",
    lines: [
      { ingredient_name: "Albahaca", quantity: 0.1 },
      { ingredient_name: "Ajo", quantity: 0.05 },
      { ingredient_name: "Nueces", quantity: 0.03 },
      { ingredient_name: "Aceite de oliva", quantity: 0.1 },
      { ingredient_name: "Queso sardo", quantity: 0.08 },
    ],
  },
  {
    product_name: "Mediterránea",
    lines: [
      { ingredient_name: "Tomate", quantity: 0.12 },
      { ingredient_name: "Aceitunas negras", quantity: 0.03 },
      { ingredient_name: "Albahaca", quantity: 0.1 },
      { ingredient_name: "Aceite de oliva", quantity: 0.02 },
      { ingredient_name: "Alcaparras", quantity: 0.025 },
    ],
  },
  {
    product_name: "Parisien",
    lines: [
      { ingredient_name: "Jamón cocido", quantity: 0.08 },
      { ingredient_name: "Pechuga de pollo", quantity: 0.13 },
      { ingredient_name: "Salsa crema", quantity: 2 },
      { ingredient_name: "Champiñones", quantity: 0.05 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
    ],
  },
  {
    product_name: "Bagnacauda",
    lines: [
      { ingredient_name: "Ajo", quantity: 0.2 },
      { ingredient_name: "Salsa crema", quantity: 2 },
      { ingredient_name: "Anchoas en aceite", quantity: 0.03 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Caruso",
    lines: [
      { ingredient_name: "Salsa crema", quantity: 2 },
      { ingredient_name: "Jamón cocido", quantity: 0.08 },
      { ingredient_name: "Champiñones", quantity: 0.05 },
      { ingredient_name: "Nueces", quantity: 0.02 },
    ],
  },
  {
    product_name: "Carbonara",
    lines: [
      { ingredient_name: "Panceta ahumada", quantity: 0.08 },
      { ingredient_name: "Cebolla", quantity: 0.05 },
      { ingredient_name: "Salsa crema", quantity: 2 },
      { ingredient_name: "Huevos", quantity: 1 },
      { ingredient_name: "Queso sardo", quantity: 0.03 },
    ],
  },
  {
    product_name: "Pomarola c/Langostinos",
    lines: [
      { ingredient_name: "Salsa tuco", quantity: 2 },
      { ingredient_name: "Langostinos pelados", quantity: 0.28 },
      { ingredient_name: "Ajo", quantity: 0.1 },
      { ingredient_name: "Albahaca", quantity: 0.05 },
    ],
  },
  {
    product_name: "Gratén (salsa)",
    lines: [
      { ingredient_name: "Salsa crema", quantity: 2 },
      { ingredient_name: "Queso sardo", quantity: 0.07 },
      { ingredient_name: "Jamón cocido", quantity: 0.12 },
    ],
  },
  {
    product_name: "Lomito Simple",
    lines: [
      { ingredient_name: "Pan de lomo", quantity: 1 },
      { ingredient_name: "Lomo", quantity: 0.12 },
    ],
  },
  {
    product_name: "Lomito Jamón y Queso",
    lines: [
      { ingredient_name: "Pan de lomo", quantity: 1 },
      { ingredient_name: "Lomo", quantity: 0.12 },
      { ingredient_name: "Queso barra", quantity: 0.05 },
      { ingredient_name: "Jamón cocido", quantity: 0.04 },
    ],
  },
  {
    product_name: "Lomito Especial",
    lines: [
      { ingredient_name: "Pan de lomo", quantity: 1 },
      { ingredient_name: "Lomo", quantity: 0.12 },
      { ingredient_name: "Queso barra", quantity: 0.05 },
      { ingredient_name: "Jamón cocido", quantity: 0.04 },
      { ingredient_name: "Lechuga", quantity: 0.04 },
      { ingredient_name: "Tomate", quantity: 0.05 },
    ],
  },
  {
    product_name: "Lomito Especial con Huevo",
    lines: [
      { ingredient_name: "Pan de lomo", quantity: 1 },
      { ingredient_name: "Lomo", quantity: 0.12 },
      { ingredient_name: "Queso barra", quantity: 0.05 },
      { ingredient_name: "Jamón cocido", quantity: 0.04 },
      { ingredient_name: "Lechuga", quantity: 0.04 },
      { ingredient_name: "Tomate", quantity: 0.05 },
      { ingredient_name: "Huevos", quantity: 1 },
    ],
  },
  {
    product_name: "Lomo Reducción",
    lines: [
      { ingredient_name: "Lomo", quantity: 0.35 },
      { ingredient_name: "Panceta ahumada", quantity: 0.025 },
      { ingredient_name: "Salsa demiglasé", quantity: 0.1 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Entrecot Especial",
    lines: [
      { ingredient_name: "Entrecot", quantity: 0.36 },
      { ingredient_name: "Hongos de pino", quantity: 0.075 },
      { ingredient_name: "Salsa demiglasé", quantity: 0.1 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Solomillo Especial",
    lines: [
      { ingredient_name: "Solomillo", quantity: 0.29 },
      { ingredient_name: "Aceto balsámico", quantity: 0.1 },
      { ingredient_name: "Papa", quantity: 0.175 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Salsa demiglasé", quantity: 0.1 },
      { ingredient_name: "Puré de manzana", quantity: 1 },
    ],
  },
  {
    product_name: "Matambrito Pizza",
    lines: [
      { ingredient_name: "Matambre de cerdo", quantity: 0.4 },
      { ingredient_name: "Jamón cocido", quantity: 0.12 },
      { ingredient_name: "Salsa tuco", quantity: 1 },
      { ingredient_name: "Tomate", quantity: 0.05 },
      { ingredient_name: "Muzarella", quantity: 0.08 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Aceitunas negras", quantity: 0.02 },
      { ingredient_name: "Rúcula", quantity: 0.03 },
      { ingredient_name: "Queso sardo", quantity: 0.05 },
      { ingredient_name: "Orégano", quantity: 0.005 },
    ],
  },
  {
    product_name: "Matambrito Roquefort Nueces",
    lines: [
      { ingredient_name: "Matambre de cerdo", quantity: 0.4 },
      { ingredient_name: "Salsa 4 quesos", quantity: 1 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Nueces", quantity: 0.02 },
    ],
  },
  {
    product_name: "Costillas Barbacoa",
    lines: [
      { ingredient_name: "Costilla de cerdo", quantity: 0.75 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Salsa barbacoa", quantity: 50 },
      { ingredient_name: "Papa", quantity: 0.2 },
    ],
  },
  {
    product_name: "Pollo Especial",
    lines: [
      { ingredient_name: "Pechuga de pollo", quantity: 0.32 },
      { ingredient_name: "Puerro", quantity: 0.05 },
      { ingredient_name: "Panceta ahumada", quantity: 0.025 },
      { ingredient_name: "Champiñones", quantity: 0.04 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Salteado Molleja Verdeo",
    lines: [
      { ingredient_name: "Molleja", quantity: 0.5 },
      { ingredient_name: "Puerro", quantity: 0.05 },
      { ingredient_name: "Champiñones", quantity: 0.05 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Osobuco Braseado",
    lines: [
      { ingredient_name: "Osobuco", quantity: 0.6 },
      { ingredient_name: "Zanahoria", quantity: 0.1 },
      { ingredient_name: "Cebolla", quantity: 0.1 },
      { ingredient_name: "Vino tinto (cocina)", quantity: 0.1 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Petit Entrecot",
    lines: [
      { ingredient_name: "Entrecot", quantity: 0.22 },
      { ingredient_name: "Sal parrillera", quantity: 0.001 },
    ],
  },
  {
    product_name: "Empanada Carne",
    lines: [
      { ingredient_name: "Carne picada", quantity: 0.024 },
      { ingredient_name: "Cebolla", quantity: 0.048 },
      { ingredient_name: "Pimiento rojo", quantity: 0.008 },
      { ingredient_name: "Cebolla de verdeo", quantity: 0.011 },
      { ingredient_name: "Discos de empanada", quantity: 1 },
    ],
  },
  {
    product_name: "Empanada Jamón y Queso",
    lines: [
      { ingredient_name: "Discos de empanada", quantity: 1 },
      { ingredient_name: "Jamón cocido", quantity: 0.033 },
      { ingredient_name: "Queso barra", quantity: 0.05 },
    ],
  },
  {
    product_name: "Espinaca Salteada",
    lines: [
      { ingredient_name: "Espinaca congelada", quantity: 0.34 },
      { ingredient_name: "Ajo", quantity: 0.05 },
      { ingredient_name: "Aceite de oliva", quantity: 0.02 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Salmón Especial",
    lines: [
      { ingredient_name: "Filet de salmón", quantity: 0.35 },
      { ingredient_name: "Bocconcinos", quantity: 0.15 },
      { ingredient_name: "Tomate cherry", quantity: 0.12 },
      { ingredient_name: "Aceitunas negras", quantity: 0.03 },
      { ingredient_name: "Albahaca", quantity: 0.08 },
    ],
  },
  {
    product_name: "Salmón Crema Camarones",
    lines: [
      { ingredient_name: "Filet de salmón", quantity: 0.35 },
      { ingredient_name: "Salsa crema", quantity: 1 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Langostinos pelados", quantity: 0.09 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Salmón Crema Limón",
    lines: [
      { ingredient_name: "Filet de salmón", quantity: 0.35 },
      { ingredient_name: "Salsa crema", quantity: 1 },
      { ingredient_name: "Limón", quantity: 0.05 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Calamaretes a la Leonesa",
    lines: [
      { ingredient_name: "Calamaretes", quantity: 0.3 },
      { ingredient_name: "Vino blanco (cocina)", quantity: 0.2 },
      { ingredient_name: "Papa", quantity: 0.2 },
      { ingredient_name: "Cebolla", quantity: 0.015 },
      { ingredient_name: "Ajo", quantity: 0.005 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Calamaretes Parmesano",
    lines: [
      { ingredient_name: "Calamaretes", quantity: 0.35 },
      { ingredient_name: "Queso sardo", quantity: 0.03 },
      { ingredient_name: "Rúcula", quantity: 0.06 },
      { ingredient_name: "Aceite de girasol", quantity: 0.02 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
    ],
  },
  {
    product_name: "Calamaretes Grillados",
    lines: [
      { ingredient_name: "Calamaretes", quantity: 0.35 },
      { ingredient_name: "Rúcula", quantity: 0.06 },
      { ingredient_name: "Queso sardo", quantity: 0.03 },
      { ingredient_name: "Sal fina", quantity: 0.001 },
      { ingredient_name: "Aceite de oliva", quantity: 0.012 },
    ],
  },
  {
    product_name: "Arroz con Mariscos",
    lines: [
      { ingredient_name: "Arroz", quantity: 0.2 },
      { ingredient_name: "Langostinos pelados", quantity: 0.13 },
      { ingredient_name: "Calamaretes", quantity: 0.05 },
      { ingredient_name: "Tubo de calamar", quantity: 0.08 },
      { ingredient_name: "Salsa tuco", quantity: 1 },
      { ingredient_name: "Sal fina", quantity: 0.02 },
    ],
  },
  {
    product_name: "Flan",
    lines: [
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Azúcar", quantity: 0.06 },
      { ingredient_name: "Leche", quantity: 0.3 },
    ],
  },
  {
    product_name: "Mousse de Chocolate",
    lines: [
      { ingredient_name: "Chocolate negro", quantity: 0.125 },
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Azúcar", quantity: 0.075 },
      { ingredient_name: "Crema de leche", quantity: 0.05 },
    ],
  },
  {
    product_name: "Pera al Vino",
    lines: [
      { ingredient_name: "Pera", quantity: 0.3 },
      { ingredient_name: "Vino tinto (cocina)", quantity: 0.125 },
      { ingredient_name: "Azúcar", quantity: 0.06 },
    ],
  },
  {
    product_name: "Isla Flotante",
    lines: [
      { ingredient_name: "Leche", quantity: 0.2 },
      { ingredient_name: "Huevos", quantity: 2 },
      { ingredient_name: "Azúcar", quantity: 0.053 },
    ],
  },
  {
    product_name: "Cheesecake",
    lines: [
      { ingredient_name: "Queso crema", quantity: 0.125 },
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Azúcar", quantity: 0.075 },
      { ingredient_name: "Crema de leche", quantity: 0.075 },
      { ingredient_name: "Vainillas", quantity: 0.06 },
    ],
  },
  {
    product_name: "Panqueques Dulce de Leche",
    lines: [
      { ingredient_name: "Crepe", quantity: 2 },
      { ingredient_name: "Dulce de leche", quantity: 0.08 },
    ],
  },
  {
    product_name: "Frutillas c/Crema",
    lines: [
      { ingredient_name: "Frutillas", quantity: 0.2 },
      { ingredient_name: "Crema de leche", quantity: 0.05 },
    ],
  },
  {
    product_name: "Tortilla de Manzana",
    lines: [
      { ingredient_name: "Manzana verde", quantity: 0.4 },
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Harina 0000", quantity: 0.08 },
      { ingredient_name: "Azúcar", quantity: 0.06 },
    ],
  },
  {
    product_name: "Queso y Dulce",
    lines: [
      { ingredient_name: "Queso barra", quantity: 0.12 },
      { ingredient_name: "Dulce de leche", quantity: 0.06 },
    ],
  },
  {
    product_name: "Sambayón Batido",
    lines: [
      { ingredient_name: "Huevos", quantity: 3 },
      { ingredient_name: "Azúcar", quantity: 0.06 },
      { ingredient_name: "Vino blanco (cocina)", quantity: 0.06 },
    ],
  },
  {
    product_name: "Tostado Mixto",
    lines: [
      { ingredient_name: "Pan de miga", quantity: 2 },
      { ingredient_name: "Queso barra", quantity: 0.085 },
      { ingredient_name: "Jamón cocido", quantity: 0.09 },
    ],
  },
  {
    product_name: "Tostado c/Tomate",
    lines: [
      { ingredient_name: "Pan de miga", quantity: 2 },
      { ingredient_name: "Queso barra", quantity: 0.085 },
      { ingredient_name: "Jamón cocido", quantity: 0.09 },
      { ingredient_name: "Tomate", quantity: 0.1 },
      { ingredient_name: "Huevos", quantity: 1 },
    ],
  },
];
