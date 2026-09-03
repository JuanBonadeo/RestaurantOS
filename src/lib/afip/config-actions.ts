"use server";

import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import type { AFIPProvider, TipoComprobante } from "./types";

const DEFAULT_GATEWAY_BASE_URL = "https://arca-gpsf-gateway.vercel.app";

type UpdateAfipConfigInput = {
  slug: string;
  cuit: string;
  puntoVenta: number;
  provider: AFIPProvider;
  defaultTipo: TipoComprobante;
  /**
   * Credencial del ARCA GPSF Gateway. La API key sólo se persiste si viene con
   * valor: la UI no la pre-rellena, así que un guardado sin tocarla NO pisa la
   * que ya estaba cargada. `tenantSlug`/`baseUrl` sí se guardan siempre que
   * vengan (no son secretos).
   */
  gatewayApiKey?: string;
  gatewayTenantSlug?: string;
  gatewayBaseUrl?: string;
  /**
   * Emitir automáticamente al saldar una orden (spec 147 · D3). Es un flag por
   * negocio y no una constante: uno que hoy factura a mano no puede despertarse
   * emitiendo solo por un deploy.
   */
  autoEmit?: boolean;
};

function revalidateAfip(slug: string) {
  revalidatePath(`/${slug}/admin/configuracion`);
  revalidatePath(`/${slug}/admin/facturacion`);
}

export async function updateAfipConfig(
  input: UpdateAfipConfigInput,
): Promise<ActionResult<{ ok: true }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, input.slug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para modificar la configuración AFIP.");
  }

  const cuit = input.cuit.replace(/\D/g, "");
  if (cuit.length !== 11) {
    return actionError("El CUIT debe tener 11 dígitos.");
  }
  if (input.puntoVenta < 1 || input.puntoVenta > 99999) {
    return actionError("Punto de venta inválido.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  // ── Credencial del gateway (tabla aparte, service-role-only) ────────────
  const apiKey = input.gatewayApiKey?.trim();
  const tenantSlug = input.gatewayTenantSlug?.trim();
  const baseUrl = input.gatewayBaseUrl?.trim();

  // ¿Ya hay una credencial cargada?
  const { data: existingCred } = await service
    .from("afip_gateway_credentials")
    .select("business_id, api_key, tenant_slug")
    .eq("business_id", business.id)
    .maybeSingle();
  const existing = existingCred as {
    api_key: string | null;
    tenant_slug: string | null;
  } | null;

  // Sólo tocamos la credencial si el admin mandó algo que la cambie.
  //
  // Un `baseUrl` solo, sin credencial cargada, NO es media credencial: es el
  // default que el formulario pre-rellena siempre. Entraba igual acá, no había
  // fila para actualizar, y el guardado entero moría en «cargá la API key y el
  // slug» — o sea que un negocio sin gateway no podía guardar **nada** de AFIP,
  // ni el CUIT ni el punto de venta. Se descubrió al no poder prender el switch
  // de emisión automática en `demo`, que emite por sandbox y nunca va a tener
  // credencial (spec 147).
  if (apiKey || tenantSlug || (baseUrl && existing)) {
    const credPatch: Record<string, unknown> = { business_id: business.id };
    if (apiKey) credPatch.api_key = apiKey;
    if (tenantSlug) credPatch.tenant_slug = tenantSlug;
    if (baseUrl) credPatch.base_url = baseUrl;

    // Para un INSERT nuevo, api_key y tenant_slug son obligatorios (NOT NULL).
    if (!existing) {
      if (!apiKey || !tenantSlug) {
        return actionError(
          "Para conectar el gateway cargá la API key y el slug del cliente.",
        );
      }
      credPatch.base_url = baseUrl || DEFAULT_GATEWAY_BASE_URL;
    }

    const { error: credErr } = await service
      .from("afip_gateway_credentials")
      .upsert(credPatch, { onConflict: "business_id" });
    if (credErr) {
      return actionError(`Error guardando la credencial: ${credErr.message}`);
    }
  }

  // Flag no-sensible para la UI: hay credencial válida (api_key + slug).
  const hasCred =
    Boolean(apiKey || existing?.api_key) &&
    Boolean(tenantSlug || existing?.tenant_slug);

  const { error } = await service
    .from("businesses")
    .update({
      afip_cuit: cuit,
      afip_punto_venta: input.puntoVenta,
      afip_provider: input.provider,
      afip_default_tipo: input.defaultTipo,
      afip_gateway_connected: hasCred,
      ...(input.autoEmit === undefined
        ? {}
        : { afip_auto_emit: input.autoEmit }),
    })
    .eq("id", business.id);

  if (error) return actionError(`Error guardando config: ${error.message}`);

  revalidateAfip(input.slug);

  // Nunca devolvemos la credencial en la respuesta.
  return actionOk({ ok: true as const });
}

/**
 * Promueve el negocio de `sandbox` a `producción`. Requiere la credencial del
 * gateway cargada (api_key + tenant_slug); si falta, bloquea y deja sandbox.
 */
export async function promoteAfipToProduction(
  slug: string,
): Promise<ActionResult<{ ok: true }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, slug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para modificar la configuración AFIP.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await service
    .from("afip_gateway_credentials")
    .select("api_key, tenant_slug")
    .eq("business_id", business.id)
    .maybeSingle();

  const cred = data as {
    api_key: string | null;
    tenant_slug: string | null;
  } | null;

  if (!cred?.api_key || !cred?.tenant_slug) {
    return actionError(
      "Cargá la credencial del gateway (API key + slug) antes de pasar a producción.",
    );
  }

  const { error } = await service
    .from("businesses")
    .update({ afip_mode: "produccion", afip_enabled: true })
    .eq("id", business.id);
  if (error) return actionError(`Error promoviendo a producción: ${error.message}`);

  revalidateAfip(slug);
  return actionOk({ ok: true as const });
}

/** Vuelve el negocio a `sandbox` (deshabilita la emisión productiva). */
export async function revertAfipToSandbox(
  slug: string,
): Promise<ActionResult<{ ok: true }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, slug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para modificar la configuración AFIP.");
  }

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { error } = await service
    .from("businesses")
    .update({ afip_mode: "sandbox", afip_enabled: false })
    .eq("id", business.id);
  if (error) return actionError(`Error volviendo a sandbox: ${error.message}`);

  revalidateAfip(slug);
  return actionOk({ ok: true as const });
}
