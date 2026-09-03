import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { normalizarCuit } from "./cuit";
import type { CondicionIvaReceptor } from "./types";

// ============================================================================
// Entidades fiscales — a quién se le emite un comprobante (spec 150).
//
// Distinto de `customers`, y a propósito: al comensal lo identifica el
// teléfono, al receptor de una factura el CUIT. De los 410 clientes con CUIT
// del backup de Golf, 390 no tienen teléfono y sólo 7 coinciden con los
// `customers` importados — son poblaciones casi disjuntas (migración 0062).
//
// Módulo `server-only`, no `"use server"`: `emitInvoiceCore` lo importa y ahí
// cada export sería un endpoint público (mismo razonamiento que la spec 147 ·
// D2). La puerta autenticada vive en `fiscal-entities-actions.ts`.
// ============================================================================

type GenericClient = SupabaseClient;

const UNIQUE_VIOLATION = "23505";

/** Cuántas sugerencias devuelve el buscador. Igual que `buscarClientes`. */
const SEARCH_LIMIT = 8;

export type FiscalEntity = {
  id: string;
  business_id: string;
  /** 11 dígitos, sin guiones (CHECK de la tabla). */
  cuit: string;
  razon_social: string;
  condicion_iva: CondicionIvaReceptor;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  cod_postal: string | null;
  email: string | null;
  phone: string | null;
  /** Sólo cuando el receptor además come en el local (7 de 410). */
  customer_id: string | null;
  /** `mxcli.codigo`, para que un re-import sepa qué ya trajo. */
  external_ref: string | null;
  created_at: string;
  updated_at: string;
};

export const FISCAL_ENTITY_COLUMNS =
  "id, business_id, cuit, razon_social, condicion_iva, domicilio, localidad, provincia, cod_postal, email, phone, customer_id, external_ref, created_at, updated_at";

/**
 * La entidad de un CUIT dentro del negocio, por la clave natural
 * `(business_id, cuit)`.
 *
 * Normaliza **antes** de la query: en la base viven 11 dígitos y en la pantalla
 * se tipea "30-50023730-5". Buscar con lo tipeado no matchea nunca — es el
 * escenario 5 de la spec, y falla en silencio (parece un CUIT nuevo).
 */
export async function buscarEntidadPorCuit(
  service: GenericClient,
  businessId: string,
  cuitRaw: string,
): Promise<FiscalEntity | null> {
  const cuit = normalizarCuit(cuitRaw);
  if (cuit.length !== 11) return null;

  const { data } = await service
    .from("fiscal_entities")
    .select(FISCAL_ENTITY_COLUMNS)
    .eq("business_id", businessId)
    .eq("cuit", cuit)
    .maybeSingle();

  return (data as FiscalEntity | null) ?? null;
}

/**
 * Buscador del cobro: por razón social **y** por CUIT, con el mismo término.
 * Quien factura tipea lo que tiene a mano — a veces el nombre, a veces el CUIT
 * de un mail—, y no debería tener que elegir en qué campo buscar.
 */
export async function buscarEntidades(
  service: GenericClient,
  businessId: string,
  query: string,
  limit: number = SEARCH_LIMIT,
): Promise<FiscalEntity[]> {
  // Los caracteres que rompen la sintaxis de `.or()` de PostgREST y los
  // wildcards de ilike se van; el resto queda (mismo criterio que
  // `buscarClientes`).
  const term = query.replace(/[,*()%_]/g, " ").trim();
  const digits = normalizarCuit(query);

  const clauses: string[] = [];
  if (term.length >= 2) clauses.push(`razon_social.ilike.*${term}*`);
  // Con 3 dígitos ya vale la pena buscar por CUIT parcial; con menos, cualquier
  // término numérico devolvería media tabla.
  if (digits.length >= 3) clauses.push(`cuit.ilike.*${digits}*`);
  if (clauses.length === 0) return [];

  const { data, error } = await service
    .from("fiscal_entities")
    .select(FISCAL_ENTITY_COLUMNS)
    .eq("business_id", businessId)
    .or(clauses.join(","))
    .order("razon_social", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("buscarEntidades", error);
    return [];
  }
  return (data ?? []) as FiscalEntity[];
}

export type ResolverEntidadInput = {
  service: GenericClient;
  businessId: string;
  /** Como se tipeó: con guiones o sin. */
  cuit: string;
  razonSocial?: string | null;
  condicionIva?: CondicionIvaReceptor | null;
};

/**
 * La entidad a la que se le está facturando: la busca por `(business_id, cuit)`
 * y, si no está, la crea con lo que se cargó en el cobro.
 *
 * **D4 — un CUIT que ya existe no se pisa.** Si la entidad está y lo tipeado
 * difiere, la factura sale con lo tipeado (D3) pero la entidad queda como
 * estaba. Un dato fiscal que cambia en medio de un cobro es más probable que
 * sea un error de tipeo del apuro que un dato nuevo, y pisarlo en silencio
 * arrastra el error a todas las facturas siguientes de ese cliente. Corregirla
 * se hace en su pantalla, con la cabeza fría.
 *
 * Devuelve `null` —sin romper la emisión— cuando no hay con qué crear una
 * entidad usable: CUIT incompleto, o sin razón social (una fila sin nombre no
 * se puede reconocer en la lista, y el CHECK de la tabla la rebotaría igual).
 * Facturar nunca depende de esto: el CUIT y la razón social viajan igual en la
 * propia factura, que es el dato que vale.
 */
export async function resolverEntidadParaFactura(
  input: ResolverEntidadInput,
): Promise<FiscalEntity | null> {
  const { service, businessId } = input;

  const cuit = normalizarCuit(input.cuit);
  if (cuit.length !== 11) return null;

  const existente = await buscarEntidadPorCuit(service, businessId, cuit);
  if (existente) return existente;

  const razonSocial = (input.razonSocial ?? "").trim();
  if (!razonSocial) return null;

  // A ⇒ el receptor es Responsable Inscripto o Monotributo; RI es el default
  // que ofrece la pantalla, así que es el que corresponde si no vino nada.
  const condicionIva = input.condicionIva ?? 1;

  const { data, error } = await service
    .from("fiscal_entities")
    .insert({
      business_id: businessId,
      cuit,
      razon_social: razonSocial,
      condicion_iva: condicionIva,
    })
    .select(FISCAL_ENTITY_COLUMNS)
    .single();

  if (error) {
    // Carrera con otra emisión al mismo CUIT: el unique (business_id, cuit) la
    // rebota y la que ganó es la buena.
    if ((error as PostgrestError).code === UNIQUE_VIOLATION) {
      return buscarEntidadPorCuit(service, businessId, cuit);
    }
    console.error("resolverEntidadParaFactura", error);
    return null;
  }

  return data as FiscalEntity;
}

/** Cuántas entidades entran en una página del ABM. */
const LIST_PAGE_SIZE = 30;

export type ListFiscalEntitiesResult = {
  entities: FiscalEntity[];
  count: number;
  page: number;
  totalPages: number;
};

/**
 * El listado de la pantalla de Facturación. Pagina en la base y no en memoria:
 * el import de MaxiRest trae 410 receptores en Golf, no un puñado.
 */
export async function listFiscalEntities(
  service: GenericClient,
  businessId: string,
  opts: { search?: string; page?: number; limit?: number } = {},
): Promise<ListFiscalEntitiesResult> {
  const limit = opts.limit ?? LIST_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * limit;

  let query = service
    .from("fiscal_entities")
    .select(FISCAL_ENTITY_COLUMNS, { count: "exact" })
    .eq("business_id", businessId)
    .order("razon_social", { ascending: true });

  const search = (opts.search ?? "").replace(/[,*()%_]/g, " ").trim();
  const digits = normalizarCuit(opts.search ?? "");
  if (search.length >= 2 || digits.length >= 3) {
    const clauses: string[] = [];
    if (search.length >= 2) clauses.push(`razon_social.ilike.*${search}*`);
    if (digits.length >= 3) clauses.push(`cuit.ilike.*${digits}*`);
    query = query.or(clauses.join(","));
  }

  const { data, count: totalCount, error } = await query.range(
    offset,
    offset + limit - 1,
  );
  if (error) console.error("listFiscalEntities", error);

  const count = totalCount ?? 0;
  return {
    entities: (data ?? []) as FiscalEntity[],
    count,
    page,
    totalPages: Math.max(1, Math.ceil(count / limit)),
  };
}

/** Una entidad del negocio. El `business_id` va en el WHERE: el id llega por
 *  la URL, así que el scope de tenant no puede darse por sentado. */
export async function getFiscalEntity(
  service: GenericClient,
  businessId: string,
  id: string,
): Promise<FiscalEntity | null> {
  const { data } = await service
    .from("fiscal_entities")
    .select(FISCAL_ENTITY_COLUMNS)
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  return (data as FiscalEntity | null) ?? null;
}
