"use server";

import { requireMozoActionContext } from "@/lib/mozo/auth";
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
} from "./queries";

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

// ── spec 158 · cuenta corriente ────────────────────────────────────
//
// Mismo gate: son números de plata por negocio y el service client bypassa RLS.

export async function getCuentaDeProveedor(businessId: string, supplierId: string) {
  await assertCanReadProveedores(businessId);
  return _getCuenta(businessId, supplierId);
}

export async function getVencimientos(businessId: string, hastaFecha?: string) {
  await assertCanReadProveedores(businessId);
  return _getVencimientos(businessId, hastaFecha);
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
