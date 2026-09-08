"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Incremento atómico de stock vía RPC (spec 36 · R-C5). Evita el lost-update del
 * read-modify-write en JS (dos ingresos/ventas concurrentes se pisaban).
 * Devuelve el nuevo current_qty.
 *
 * Si la migración 0004 (`adjust_stock_item`) todavía no está aplicada, cae al
 * read-modify-write previo (no atómico, comportamiento histórico) para no
 * romper. Una vez aplicada 0004, gana el path atómico. Deploy: 0004 + código.
 */
/**
 * `stock_items.unit_cost_cents` y `stock_movimientos.cost_cents_snapshot` (0086)
 * todavía no están en `database.types.ts` — el `pnpm db:types` de este repo
 * necesita el CLI linkeado. Mismo escape hatch que el resto del back-office:
 * se apaga el tipado de la escritura puntual, no del cliente entero.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseTable = { from: (t: string) => any };

async function adjustStockItemQty(
  service: ReturnType<typeof createSupabaseServiceClient>,
  stockItemId: string,
  delta: number,
): Promise<number> {
  const { data, error } = await (
    service as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("adjust_stock_item", { p_stock_item_id: stockItemId, p_delta: delta });
  if (!error && data != null) return Number(data);

  // Fallback (RPC ausente): read-modify-write, como antes de 0004.
  const { data: cur } = await service
    .from("stock_items")
    .select("current_qty")
    .eq("id", stockItemId)
    .single();
  const newQty =
    Number((cur as { current_qty: number } | null)?.current_qty ?? 0) + delta;
  await service
    .from("stock_items")
    .update({ current_qty: newQty, updated_at: new Date().toISOString() })
    .eq("id", stockItemId);
  return newQty;
}

// ── toggleTrackStock ─────────────────────────────────────────────

export async function toggleTrackStock(
  productId: string,
  enabled: boolean,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo admin o encargado pueden gestionar stock.");
  }

  const service = createSupabaseServiceClient();

  const { data: product } = await service
    .from("products")
    .select("id, business_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product || product.business_id !== business.id) {
    return actionError("Producto no encontrado.");
  }

  await service
    .from("products")
    .update({ track_stock: enabled })
    .eq("id", productId);

  if (enabled) {
    const { data: existing } = await service
      .from("stock_items")
      .select("id")
      .eq("product_id", productId)
      .eq("business_id", business.id)
      .maybeSingle();

    if (!existing) {
      await service.from("stock_items").insert({
        business_id: business.id,
        product_id: productId,
        current_qty: 0,
        min_qty: 0,
      });
    }
  }

  revalidatePath(`/${slug}/admin/catalogo`);
  return actionOk(undefined);
}

// ── setBarStock ──────────────────────────────────────────────────
// Marca/quita un producto del stock de bar (spec 10). Es ortogonal al
// stock de cocina: usa la rama track_stock (bebidas/contables) del descargo.
// Quitar es baja lógica: track_stock = false conserva el stock_item y todos
// sus stock_movimientos (histórico), y puede reactivarse más adelante.

export async function setBarStock(
  productId: string,
  enabled: boolean,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo admin o encargado pueden gestionar stock.");
  }

  const service = createSupabaseServiceClient();

  const { data: product } = await service
    .from("products")
    .select("id, business_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product || product.business_id !== business.id) {
    return actionError("Producto no encontrado.");
  }

  if (enabled) {
    // Alta: marca de bar + tracking, y asegura el stock_item.
    await service
      .from("products")
      .update({ is_bar_stock: true, track_stock: true })
      .eq("id", productId);

    const { data: existing } = await service
      .from("stock_items")
      .select("id")
      .eq("product_id", productId)
      .eq("business_id", business.id)
      .maybeSingle();

    if (!existing) {
      await service.from("stock_items").insert({
        business_id: business.id,
        product_id: productId,
        current_qty: 0,
        min_qty: 0,
      });
    }
  } else {
    // Baja lógica: deja de trackearse y deja de listarse en "Stock de bar".
    // No se borran stock_item ni stock_movimientos (se conserva el histórico).
    await service
      .from("products")
      .update({ is_bar_stock: false, track_stock: false })
      .eq("id", productId);
  }

  revalidatePath(`/${slug}/admin/catalogo`);
  return actionOk(undefined);
}

// ── setStockLevels ───────────────────────────────────────────────

export async function setStockLevels(
  productId: string,
  currentQty: number,
  minQty: number,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo admin o encargado pueden gestionar stock.");
  }

  // `currentQty` puede ser negativo a propósito (spec 099): el faltante es un
  // dato, no un error — el próximo ingreso lo cancela. El mínimo sí es un umbral
  // que el negocio define, y un umbral negativo no significa nada.
  if (minQty < 0) return actionError("El mínimo no puede ser negativo.");

  const service = createSupabaseServiceClient();

  const { data: product } = await service
    .from("products")
    .select("id, business_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product || product.business_id !== business.id) {
    return actionError("Producto no encontrado.");
  }

  const { data: stockItem } = await service
    .from("stock_items")
    .select("id")
    .eq("product_id", productId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (stockItem) {
    await service
      .from("stock_items")
      .update({ current_qty: currentQty, min_qty: minQty, updated_at: new Date().toISOString() })
      .eq("id", stockItem.id);
  } else {
    await service.from("stock_items").insert({
      business_id: business.id,
      product_id: productId,
      current_qty: currentQty,
      min_qty: minQty,
    });
    await service
      .from("products")
      .update({ track_stock: true })
      .eq("id", productId);
  }

  revalidatePath(`/${slug}/admin/catalogo`);
  return actionOk(undefined);
}

// ── ingresarStock ────────────────────────────────────────────────

export async function ingresarStock(
  productId: string,
  qty: number,
  slug: string,
  reason?: string,
  /**
   * Issue #270 · lo que cuesta UNA unidad, en centavos. Opcional: si no viene,
   * el costo del ítem no se toca. Es la misma regla que la 0073 le aplicó a los
   * insumos —la compra reescribe el precio—, y es la única forma de que la
   * rotura de una botella tenga plata: el bar no tiene recetas ni
   * presentaciones, y `price_cents` es lo que se cobra, no lo que cuesta.
   */
  unitCostCents?: number,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo admin o encargado pueden ingresar stock.");
  }

  if (qty <= 0) return actionError("La cantidad debe ser mayor a 0.");

  const service = createSupabaseServiceClient();

  const { data: stockItem } = await service
    .from("stock_items")
    .select("id, business_id")
    .eq("product_id", productId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!stockItem) return actionError("El producto no tiene stock trackeado.");

  await adjustStockItemQty(service, stockItem.id, qty);

  if (typeof unitCostCents === "number" && unitCostCents > 0) {
    await (service as unknown as LooseTable)
      .from("stock_items")
      .update({ unit_cost_cents: Math.round(unitCostCents) })
      .eq("id", stockItem.id);
  }

  await service.from("stock_movimientos").insert({
    stock_item_id: stockItem.id,
    business_id: business.id,
    kind: "ingreso",
    qty,
    reason: reason?.trim() || null,
    created_by: ctx.userId,
  });

  // Spec 099: el ingreso NO reenciende el producto. Nadie lo apaga por stock, y
  // el "no disponible" que puso el encargado tiene que sobrevivir a la entrega
  // del proveedor.

  revalidatePath(`/${slug}/admin/catalogo`);
  return actionOk(undefined);
}

// ── ajustarStock ─────────────────────────────────────────────────

export async function ajustarStock(
  productId: string,
  qty: number,
  reason: string,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("Solo admin o encargado pueden ajustar stock.");
  }

  if (!reason || reason.trim() === "") {
    return actionError("El motivo es obligatorio para ajustes.");
  }
  if (qty === 0) return actionError("La cantidad no puede ser 0.");

  const service = createSupabaseServiceClient();

  const { data: stockItem } = await (service as unknown as LooseTable)
    .from("stock_items")
    .select("id, business_id, unit_cost_cents")
    .eq("product_id", productId)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!stockItem) return actionError("El producto no tiene stock trackeado.");

  await adjustStockItemQty(service, stockItem.id, qty);

  // Issue #270 · lo que BAJA a mano es merma, no un ajuste mudo.
  //
  // La pantalla ya lo decía —«Cantidad (negativa = merma)», placeholder «Ej:
  // Botella rota»— y el movimiento se guardaba con el mismo `kind='ajuste'` que
  // un conteo físico: la rotura y la corrección eran indistinguibles salvo por
  // el texto libre del motivo. Y no valían nada: `stock_movimientos` no tenía
  // ninguna columna de plata, así que una botella de whisky importado se
  // rompía y el sistema no registraba un peso.
  //
  // Misma decisión que en la cocina: lo que sube sigue siendo 'ajuste'. Un
  // conteo que aparece de más no es una pérdida.
  const esMerma = qty < 0;
  const unitCost = Number(
    (stockItem as unknown as { unit_cost_cents: number | null }).unit_cost_cents ?? 0,
  );

  await (service as unknown as LooseTable).from("stock_movimientos").insert({
    stock_item_id: stockItem.id,
    business_id: business.id,
    kind: esMerma ? "merma" : "ajuste",
    qty,
    reason: reason.trim(),
    created_by: ctx.userId,
    // En 0 mientras nadie haya cargado el costo de reposición. Es honesto: el
    // movimiento queda tipado como pérdida aunque todavía no se le sepa el
    // precio, en vez de desaparecer del vocabulario como pasaba antes.
    cost_cents_snapshot: esMerma ? Math.round(unitCost * Math.abs(qty)) : null,
  });

  // Spec 099: el ajuste mueve el inventario y nada más. Puede dejarlo en
  // negativo (una merma de 5 sobre 3 en sistema son -2 reales), y la carta la
  // decide el negocio con el toggle de disponible.

  revalidatePath(`/${slug}/admin/catalogo`);
  return actionOk(undefined);
}
