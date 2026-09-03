"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canGestionarEntidadesFiscales } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { normalizarCuit } from "./cuit";
import {
  buscarEntidades,
  buscarEntidadPorCuit,
  FISCAL_ENTITY_COLUMNS,
  type FiscalEntity,
} from "./fiscal-entities";

// ============================================================================
// La puerta autenticada de las entidades fiscales (spec 150).
//
// El dominio vive en `fiscal-entities.ts` (`server-only`) porque
// `emitInvoiceCore` lo importa: acá cada export es un endpoint público, así que
// todo lo que entra pasa por Zod y por el gate de rol.
// ============================================================================

type GenericClient = SupabaseClient;

const UNIQUE_VIOLATION = "23505";

/** Códigos ARCA RG 5616, los mismos que el CHECK de la tabla. */
const CondicionIva = z.union([
  z.literal(1),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

/** El CUIT entra como se tipeó y se guarda normalizado: la base sólo acepta
 *  11 dígitos (`check (cuit ~ '^[0-9]{11}$')`). */
const Cuit = z
  .string()
  .transform(normalizarCuit)
  .refine((v) => v.length === 11, "El CUIT debe tener 11 dígitos.");

/** Campos que nadie está obligado a cargar: de los 410 receptores con CUIT de
 *  Golf, 390 no tienen teléfono y 3 tienen e-mail. Vacío → NULL, no "". */
const Opcional = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : null));

const DatosEntidad = {
  razonSocial: z.string().trim().min(1, "La razón social es obligatoria.").max(200),
  condicionIva: CondicionIva,
  domicilio: Opcional,
  localidad: Opcional,
  provincia: Opcional,
  codPostal: Opcional,
  email: Opcional,
  phone: Opcional,
};

const CrearInput = z.object({
  slug: z.string().min(1),
  cuit: Cuit,
  ...DatosEntidad,
});

const ActualizarInput = z.object({
  slug: z.string().min(1),
  id: z.string().uuid(),
  cuit: Cuit,
  ...DatosEntidad,
});

export type CrearEntidadFiscalInput = z.input<typeof CrearInput>;
export type ActualizarEntidadFiscalInput = z.input<typeof ActualizarInput>;

/** Lo que necesita el buscador del cobro para mostrar y prellenar. */
export type EntidadFiscalMatch = {
  id: string;
  cuit: string;
  razon_social: string;
  condicion_iva: 1 | 4 | 5 | 6;
};

/**
 * `creada: false` = el CUIT ya estaba cargado y se devolvió la entidad que
 * había, **sin pisarla** (D4). La pantalla lo dice, así que quien cobra sabe
 * que la razón social que ve no es la que acaba de tipear.
 */
export type AltaEntidadResult = {
  entidad: FiscalEntity;
  creada: boolean;
};

type Autorizado = {
  businessId: string;
  service: GenericClient;
};

/** Negocio + rol, la verificación que comparten los tres endpoints. */
async function autorizar(
  slug: string,
): Promise<ActionResult<Autorizado>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canGestionarEntidadesFiscales(ctxResult.data.role)) {
    return actionError("No tenés permiso para gestionar entidades fiscales.");
  }

  return actionOk({
    businessId: business.id,
    service: createSupabaseServiceClient() as unknown as GenericClient,
  });
}

/**
 * Busca receptores del negocio por razón social o por CUIT (spec 150 · D2).
 * Lo llama el buscador que aparece al elegir Factura A en el cobro.
 */
export async function buscarEntidadesFiscales(
  slug: string,
  query: string,
): Promise<ActionResult<EntidadFiscalMatch[]>> {
  const auth = await autorizar(slug);
  if (!auth.ok) return auth;

  const rows = await buscarEntidades(auth.data.service, auth.data.businessId, query);
  return actionOk(
    rows.map((r) => ({
      id: r.id,
      cuit: r.cuit,
      razon_social: r.razon_social,
      condicion_iva: r.condicion_iva,
    })),
  );
}

/**
 * Alta de un receptor. Se llama desde la pantalla de Facturación y **desde el
 * cobro**: si el CUIT no está cargado, la entidad se crea sin abandonar la
 * pantalla (de lo contrario, la primera factura a un receptor nuevo seguiría
 * siendo la de hoy — tipear los tres campos otra vez el mes que viene).
 *
 * Si el CUIT ya existe devuelve la que está, sin pisarla (D4).
 */
export async function crearEntidadFiscal(
  raw: CrearEntidadFiscalInput,
): Promise<ActionResult<AltaEntidadResult>> {
  const parsed = CrearInput.safeParse(raw);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const input = parsed.data;

  const auth = await autorizar(input.slug);
  if (!auth.ok) return auth;
  const { service, businessId } = auth.data;

  const { data, error } = await service
    .from("fiscal_entities")
    .insert({
      business_id: businessId,
      cuit: input.cuit,
      razon_social: input.razonSocial,
      condicion_iva: input.condicionIva,
      domicilio: input.domicilio,
      localidad: input.localidad,
      provincia: input.provincia,
      cod_postal: input.codPostal,
      email: input.email,
      phone: input.phone,
    })
    .select(FISCAL_ENTITY_COLUMNS)
    .single();

  if (error) {
    // D4: el CUIT ya está cargado. No es un error para quien está cobrando —
    // es justamente la entidad que buscaba— así que se la devolvemos en vez de
    // mandarlo a buscarla de nuevo. Y NO se pisa con lo que acaba de tipear.
    if (error.code === UNIQUE_VIOLATION) {
      const existente = await buscarEntidadPorCuit(service, businessId, input.cuit);
      if (existente) return actionOk({ entidad: existente, creada: false });
    }
    console.error("crearEntidadFiscal", error);
    return actionError("No pudimos guardar la entidad fiscal.");
  }

  revalidatePath(`/${input.slug}/admin/facturacion/entidades`);
  return actionOk({ entidad: data as FiscalEntity, creada: true });
}

/**
 * Corrige una entidad ya cargada. Es el único camino que pisa datos fiscales:
 * el cobro nunca lo hace (D4), justamente para que la corrección sea un acto
 * deliberado y no el efecto colateral de un tipeo apurado.
 */
export async function actualizarEntidadFiscal(
  raw: ActualizarEntidadFiscalInput,
): Promise<ActionResult<FiscalEntity>> {
  const parsed = ActualizarInput.safeParse(raw);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const input = parsed.data;

  const auth = await autorizar(input.slug);
  if (!auth.ok) return auth;
  const { service, businessId } = auth.data;

  // Scope de tenant: el id viene del cliente, así que el `business_id` va en el
  // WHERE. Sin esto se podría editar la entidad de otro negocio de la base.
  const { data, error } = await service
    .from("fiscal_entities")
    .update({
      cuit: input.cuit,
      razon_social: input.razonSocial,
      condicion_iva: input.condicionIva,
      domicilio: input.domicilio,
      localidad: input.localidad,
      provincia: input.provincia,
      cod_postal: input.codPostal,
      email: input.email,
      phone: input.phone,
    })
    .eq("id", input.id)
    .eq("business_id", businessId)
    .select(FISCAL_ENTITY_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return actionError("Ya hay otra entidad cargada con ese CUIT.");
    }
    console.error("actualizarEntidadFiscal", error);
    return actionError("No pudimos guardar los cambios.");
  }
  if (!data) return actionError("Entidad fiscal no encontrada.");

  revalidatePath(`/${input.slug}/admin/facturacion/entidades`);
  revalidatePath(`/${input.slug}/admin/facturacion/entidades/${input.id}`);
  return actionOk(data as FiscalEntity);
}
