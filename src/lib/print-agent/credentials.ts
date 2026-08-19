import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Un print-agent instalado: quién es y qué impresoras alcanza (spec 124).
 * `printerScope` null = sin restricción (el negocio de un solo agente).
 */
export type PrintAgentCredential = {
  id: string;
  apiKey: string;
  label: string | null;
  printerScope: string[] | null;
};

/**
 * Lookup server-only de las print-agent keys de un negocio (spec 046, ampliado
 * en la 124). La tabla `print_agent_credentials` es service-role-only; esto se
 * llama solo desde el server (auth del endpoint del agente).
 *
 * Devuelve TODAS las credenciales del negocio —no una— porque desde la spec 124
 * un negocio puede tener varios agentes (golf: una PC por caja, en LANs
 * distintas) y es la key la que dice cuál de ellos está llamando.
 *
 * Se traen las keys enteras a propósito, en vez de filtrar por `api_key` en la
 * query: la comparación tiene que ser en tiempo constante (`timingSafeEqual`) y
 * un `where api_key = $1` la haría en el índice. Son un puñado de filas por
 * negocio, no hay nada que optimizar acá.
 */
export async function listPrintAgentCredentials(
  businessId: string,
): Promise<PrintAgentCredential[]> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("print_agent_credentials")
    .select("id, api_key, label, printer_scope")
    .eq("business_id", businessId);

  // Nunca tira: esto está en el camino de auth del pull, que corre una vez por
  // segundo. Un error de query es "no autenticado" (el endpoint responde 401 y
  // el agente reintenta), no una excepción que tumbe la request.
  if (error) console.error("listPrintAgentCredentials", error);

  const filas = (data ?? []) as {
    id: string;
    api_key: string;
    label: string | null;
    printer_scope: string[] | null;
  }[];

  return filas.map((f) => ({
    id: f.id,
    apiKey: f.api_key,
    label: f.label,
    printerScope: f.printer_scope,
  }));
}
