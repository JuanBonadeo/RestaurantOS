// @ts-nocheck
/**
 * seed-escenarios-guia.ts
 *
 * Crea en `demo` los escenarios que la GUÍA DEL ENCARGADO necesita mostrar y
 * que el seed normal no genera nunca: un programado vencido, un pedido en
 * camino, una comanda que no imprimió, un mozo con plata sin rendir y una
 * reserva esperando respuesta.
 *
 * Por qué un script aparte y no tocar `seed-operativo.ts`: aquel corre también
 * contra los negocios reales (golf-jcr, kcc) y arma un servicio completo. Esto
 * es aditivo, chico, y sólo agrega los estados de FALLA que hacen falta para
 * capturar y para grabar los Loom.
 *
 *   npx tsx scripts/seed-escenarios-guia.ts          # muestra qué haría
 *   npx tsx scripts/seed-escenarios-guia.ts --write  # lo escribe
 *
 * Es IDEMPOTENTE: cada fila que crea lleva la marca `[guía]`, y cada corrida
 * borra primero lo que dejó la anterior. Nunca toca datos que no creó él.
 */

import { resolve } from "path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(__dirname, "../.env.local") });

// Guarda dura: este script escribe estados de FALLA (plata sin rendir, comandas
// rotas). En un negocio real eso es ruido que alguien va a tener que limpiar a
// mano, así que ni siquiera se acepta el slug por parámetro.
const SLUG = "demo";
const MARCA = "[guía]";
const WRITE = process.argv.includes("--write");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const log = (s: string) => console.log(s);
const paso = (s: string) => console.log(`\n── ${s}`);

function minsAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

async function main() {
  log(WRITE ? "MODO ESCRITURA\n" : "MODO SIMULACIÓN — usá --write para escribir\n");

  const { data: biz } = await sb
    .from("businesses")
    .select("id, name, slug")
    .eq("slug", SLUG)
    .single();
  if (!biz) throw new Error(`No existe el negocio ${SLUG}`);
  log(`Negocio: ${biz.name} (${biz.slug})`);

  const BIZ = biz.id;

  // ── Limpieza de la corrida anterior ────────────────────────────────────
  paso("Limpiando lo que dejó la corrida anterior");
  if (WRITE) {
    const { data: viejos } = await sb
      .from("orders")
      .select("id")
      .eq("business_id", BIZ)
      .like("customer_name", `%${MARCA}%`);
    const ids = (viejos ?? []).map((o) => o.id);
    if (ids.length) {
      await sb.from("comandas").delete().in("order_id", ids);
      await sb.from("order_items").delete().in("order_id", ids);
      await sb.from("payments").delete().in("order_id", ids);
      await sb.from("orders").delete().in("id", ids);
    }
    await sb
      .from("reservations")
      .delete()
      .eq("business_id", BIZ)
      .like("customer_name", `%${MARCA}%`);
    log(`  ${ids.length} pedidos y sus reservas, borrados`);
  } else {
    log("  (simulación)");
  }

  // ── Insumos ────────────────────────────────────────────────────────────
  const { data: prods } = await sb
    .from("products")
    .select("id, name, price_cents, station_id")
    .eq("business_id", BIZ)
    .eq("is_available", true)
    .not("station_id", "is", null)
    .limit(30);
  if (!prods?.length) throw new Error("No hay productos con sector para armar pedidos");

  const { data: mozos } = await sb
    .from("business_users")
    .select("user_id, role")
    .eq("business_id", BIZ)
    .eq("role", "mozo")
    .limit(3);

  const { data: cajas } = await sb
    .from("cajas")
    .select("id, name, is_default")
    .eq("business_id", BIZ);
  const cajaPrincipal = (cajas ?? []).find((c) => c.is_default) ?? cajas?.[0];

  const nuevoPedido = async (def: {
    nombre: string;
    tipo: string;
    status: string;
    creadoHaceMin: number;
    programadoHaceMin?: number;
    items?: number;
  }) => {
    const elegidos = prods.slice(0, def.items ?? 2);
    const subtotal = elegidos.reduce((s, p) => s + (p.price_cents ?? 0), 0);
    const envio = def.tipo === "delivery" ? 80000 : 0;
    const row = {
      business_id: BIZ,
      order_number: 0,
      customer_name: `${def.nombre} ${MARCA}`,
      customer_phone: "+5493415550000",
      delivery_type: def.tipo,
      delivery_address: def.tipo === "delivery" ? "Av. Siempreviva 742" : null,
      delivery_fee_cents: envio,
      status: def.status,
      subtotal_cents: subtotal,
      discount_cents: 0,
      total_cents: subtotal + envio,
      payment_method: "cash",
      payment_status: "pending",
      lifecycle_status: "open",
      scheduled_at: def.programadoHaceMin ? minsAgo(def.programadoHaceMin) : null,
      created_at: minsAgo(def.creadoHaceMin),
    };
    if (!WRITE) {
      log(`  · ${row.customer_name} — ${def.tipo}/${def.status}${row.scheduled_at ? " (programado vencido)" : ""}`);
      return null;
    }
    const { data, error } = await sb.from("orders").insert(row).select("id").single();
    if (error) {
      log(`  ✗ ${def.nombre}: ${error.message}`);
      return null;
    }
    await sb.from("order_items").insert(
      elegidos.map((p) => ({
        order_id: data.id,
        product_id: p.id,
        quantity: 1,
        unit_price_cents: p.price_cents,
        total_price_cents: p.price_cents,
        product_name: p.name,
      })),
    );
    log(`  ✓ ${row.customer_name} — ${def.tipo}/${def.status}`);
    return { id: data.id, station: elegidos[0].station_id };
  };

  // ── 1 · El programado que no marchó ────────────────────────────────────
  paso("1 · Un pedido programado que se pasó de hora («No marchó»)");
  await nuevoPedido({
    nombre: "Encargue vencido",
    tipo: "pickup",
    status: "pending",
    creadoHaceMin: 180,
    programadoHaceMin: 40, // su hora ya pasó → la tarjeta se pinta en rojo
  });

  // ── 2 · Un pedido en cada columna ──────────────────────────────────────
  paso("2 · Un pedido en cada columna del tablero");
  const enCamino = await nuevoPedido({ nombre: "En camino", tipo: "delivery", status: "on_the_way", creadoHaceMin: 35 });
  await nuevoPedido({ nombre: "Recién entrado", tipo: "delivery", status: "pending", creadoHaceMin: 6 });
  await nuevoPedido({ nombre: "En cocina", tipo: "delivery", status: "preparing", creadoHaceMin: 18 });
  await nuevoPedido({ nombre: "Listo para salir", tipo: "pickup", status: "ready", creadoHaceMin: 22 });

  // ── 3 · La comanda que no imprimió ─────────────────────────────────────
  paso("3 · Una comanda que no se imprimió");
  const conComanda = await nuevoPedido({ nombre: "Comanda fallada", tipo: "delivery", status: "preparing", creadoHaceMin: 12, items: 3 });
  if (WRITE && conComanda?.station) {
    const { error } = await sb.from("comandas").insert({
      order_id: conComanda.id,
      station_id: conComanda.station,
      batch: 1,
      // Los estados de comanda están en español en la base: pendiente /
      // en_preparacion / entregado. No son los mismos que los de `orders`.
      status: "pendiente",
      print_failed_at: minsAgo(9),
    });
    log(error ? `  ✗ comanda: ${error.message}` : "  ✓ comanda marcada como fallida");
  } else if (!WRITE) {
    log("  · una comanda con print_failed_at");
  }

  // ── 4 · Un mozo con plata sin rendir ───────────────────────────────────
  paso("4 · Un mozo que cobró y todavía no rindió");
  if (!mozos?.length) {
    log("  ! no hay usuarios con rol mozo en el demo — se saltea");
  } else if (WRITE && enCamino && cajaPrincipal) {
    const { error } = await sb.from("payments").insert({
      business_id: BIZ,
      order_id: enCamino.id,
      caja_id: cajaPrincipal.id,
      amount_cents: 1850000,
      tip_cents: 0,
      method: "cash",
      payment_status: "paid",
      attributed_mozo_id: mozos[0].user_id,
      created_at: minsAgo(30),
    });
    log(error ? `  ✗ pago: ${error.message}` : `  ✓ $18.500 en efectivo sin rendir (bloquea el cierre)`);
  } else if (!WRITE) {
    log(`  · un pago en efectivo atribuido a un mozo, sin rendición posterior`);
  }

  // ── 5 · Una reserva esperando respuesta ────────────────────────────────
  paso("5 · Una reserva pendiente de confirmar");
  const enDosHoras = new Date(Date.now() + 2 * 3600_000);
  const fin = new Date(enDosHoras.getTime() + 90 * 60_000);
  if (WRITE) {
    const { error } = await sb.from("reservations").insert({
      business_id: BIZ,
      customer_name: `Familia Pereyra ${MARCA}`,
      customer_phone: "+5493415551234",
      party_size: 4,
      starts_at: enDosHoras.toISOString(),
      ends_at: fin.toISOString(),
      status: "pending",
      source: "web",
    });
    log(error ? `  ✗ reserva: ${error.message}` : "  ✓ reserva pendiente para dentro de 2 h");
  } else {
    log("  · una reserva `pending` para dentro de 2 h");
  }

  log(
    WRITE
      ? "\nListo. Los escenarios están en el demo.\n" +
        "Ojo: el mozo sin rendir BLOQUEA el cierre de la caja principal — es a propósito,\n" +
        "es el escenario que hay que poder mostrar."
      : "\nNada escrito. Corré con --write para aplicarlo.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
