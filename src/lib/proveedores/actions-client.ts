"use server";

import { requireMozoActionContext } from "@/lib/mozo/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { canManageProveedores } from "@/lib/permissions/can";

import {
  getCuentaDeProveedor as _getCuenta,
  getVencimientos as _getVencimientos,
  getGastoPorConcepto as _getGasto,
  getProyeccionPagos as _getProyeccion,
} from "./cuenta-corriente-queries";
import {
  getSupplierInvoices as _getInvoices,
  getSupplierIngredients as _getIngredients,
  getSupplierStats as _getStats,
  getRenglonesPorComprobante as _getRenglones,
} from "./queries";

/**
 * `supplier_ingredient_aliases` y `normalizar_texto_insumo` son de la 0092 y
 * todavía no están en `database.types.ts`. Mismo escape hatch que el resto del
 * módulo para las tablas de la 158 y la 165.
 */
type GenericDb = {
  rpc: (fn: "normalizar_texto_insumo", args: { p: string }) => Promise<{ data: string | null }>;
  from: (t: "supplier_ingredient_aliases") => {
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: unknown }>;
  };
};

/**
 * Estos wrappers son "use server" → invocables directo desde el cliente. Las
 * queries usan el service client (bypassa RLS) filtrando solo por el `businessId`
 * que viene del argumento, así que sin este gate cualquiera podía leer finanzas
 * de proveedores de OTRO negocio pasando su id (IDOR cross-tenant, sin auth).
 * Exigimos membership activa + rol con permiso de proveedores sobre ese negocio.
 */
async function assertCanReadProveedores(businessId: string): Promise<void> {
  const ctx = await requireMozoActionContext(businessId);
  if (!ctx.ok || !canManageProveedores(ctx.data.role)) {
    throw new Error("No autorizado.");
  }
}

export async function getSupplierInvoices(supplierId: string, businessId: string) {
  await assertCanReadProveedores(businessId);
  return _getInvoices(supplierId, businessId);
}

export async function getSupplierIngredients(supplierId: string, businessId: string) {
  await assertCanReadProveedores(businessId);
  return _getIngredients(supplierId, businessId);
}

export async function getSupplierStats(businessId: string, from?: string, to?: string) {
  await assertCanReadProveedores(businessId);
  return _getStats(businessId, from, to);
}

/**
 * Los renglones de una tanda de comprobantes — spec 172.
 *
 * Mismo gate que el resto: la query filtra por el `businessId` del argumento con
 * el service client, así que sin esto se leería el detalle de compras de otro
 * negocio pasando ids. Los `invoiceIds` van igual contra el `business_id` en el
 * `where`, así que un id ajeno no devuelve nada.
 */
export async function getRenglonesPorComprobante(
  businessId: string,
  invoiceIds: string[],
) {
  await assertCanReadProveedores(businessId);
  return _getRenglones(businessId, invoiceIds);
}

// ── spec 158 · cuenta corriente ────────────────────────────────────
//
// Mismo gate: son números de plata por negocio y el service client bypassa RLS.

export async function getCuentaDeProveedor(businessId: string, supplierId: string) {
  await assertCanReadProveedores(businessId);
  return _getCuenta(businessId, supplierId);
}

export async function getVencimientos(businessId: string) {
  await assertCanReadProveedores(businessId);
  return _getVencimientos(businessId);
}

export async function getGastoPorConcepto(
  businessId: string,
  desde: string,
  hasta: string,
  agrupacion: "concepto" | "rubro" = "concepto",
) {
  await assertCanReadProveedores(businessId);
  return _getGasto(businessId, desde, hasta, agrupacion);
}

export async function getProyeccionPagos(businessId: string, mes: string) {
  await assertCanReadProveedores(businessId);
  return _getProyeccion(businessId, mes);
}

/**
 * Aprender cómo escribe este proveedor — spec 172, fase 4.
 *
 * Se llama DESPUÉS de que el comprobante se guardó bien. Va aparte y no dentro
 * de `registrar_items_comprobante_tx` por una razón práctica y una de diseño: la
 * RPC la está tocando otra spec en paralelo, y perder un alias no corrompe nada
 * — es una opinión revisable, no un hecho contable. Si el comprobante falla, la
 * action ni llega acá.
 *
 * Qué se aprende, por origen del renglón:
 *   · `memoria` sin cambios → sólo refuerza `confirmations`. No se aprendió nada
 *     nuevo, se confirmó lo que había.
 *   · `exacto` → se guarda. Un lookup no es una adivinanza y hace instantánea la
 *     factura siguiente.
 *   · `fuzzy` / `llm` tildado a mano → se guarda con su origen. Es el camino
 *     riesgoso, y por eso queda marcado: un alias con `confirmations = 1` y
 *     `origen = 'llm'` es identificable y revocable.
 *   · corregido → **pisa** lo que hubiera y resetea `confirmations`. La
 *     corrección es la señal de más valor y tiene que ganarle a cualquier fila
 *     previa.
 *   · destildado → nada. Ausencia de match no es match a nada.
 */
export async function aprenderAliases(
  businessId: string,
  supplierId: string,
  aprendidos: {
    aliasRaw: string;
    ingredientId: string;
    presentationId: string | null;
    origen: "exacto" | "fuzzy" | "llm" | "manual" | "manual_corregido";
  }[],
): Promise<void> {
  await assertCanReadProveedores(businessId);
  if (aprendidos.length === 0) return;

  const service = createSupabaseServiceClient() as unknown as GenericDb;

  for (const a of aprendidos) {
    const { data: norm } = await service.rpc("normalizar_texto_insumo", { p: a.aliasRaw });
    if (!norm || norm.length < 2) continue;

    await service
      .from("supplier_ingredient_aliases")
      .upsert(
        {
          business_id: businessId,
          supplier_id: supplierId,
          alias_norm: norm,
          alias_raw: a.aliasRaw,
          ingredient_id: a.ingredientId,
          presentation_id: a.presentationId,
          origen: a.origen,
          confirmations: 1,
          last_confirmed_at: new Date().toISOString(),
        },
        { onConflict: "business_id,supplier_id,alias_norm" },
      );
  }
}
