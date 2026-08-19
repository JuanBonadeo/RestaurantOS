import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  listPrintAgentCredentials,
  type PrintAgentCredential,
} from "@/lib/print-agent/credentials";

/**
 * Auth compartida del contrato del print agent (spec 28/33/35/046/124). Bearer
 * con la key POR AGENTE de `print_agent_credentials` (autoinstalador). La usan
 * el `GET`/`POST /api/print-agent` y el `POST /api/print-agent/heartbeat`.
 *
 * Solo keys de la tabla: la `PRINT_AGENT_KEY` global se retiró (security review
 * #4) porque autenticaba contra CUALQUIER `business_id` — quien la tuviera podía
 * leer comandas y sabotear la impresión de todos los negocios. Una key nunca
 * autentica contra otro `business_id`, y sin `businessId` no se puede validar
 * (→ null).
 *
 * Spec 124: no devuelve un booleano sino **qué agente** es. Un negocio puede
 * tener varias PCs con print-agent (golf: una por caja, en LANs distintas) y de
 * ahí sale su alcance de impresoras. Que la identidad venga de la key —y no de
 * un parámetro nuevo— es lo que deja al agente ya instalado sin tocar: sigue
 * mandando su mismo Bearer.
 */
export function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Comparación de tokens en tiempo constante (evita timing attacks). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // El largo se chequea primero porque `timingSafeEqual` TIRA con buffers de
  // distinto tamaño: sin esto, una credencial de otro largo cortaría el barrido
  // y dejaría afuera al agente que sí tiene la key buena.
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Resuelve qué agente del negocio corresponde a este Bearer. `null` = no
 * autenticado (sin header, key ajena, negocio sin keys, o sin businessId).
 */
export async function autenticarAgente(
  req: Request,
  businessId?: string | null,
): Promise<PrintAgentCredential | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  // Sin saber contra qué negocio validar, no se autentica.
  if (!businessId) return null;

  const credenciales = await listPrintAgentCredentials(businessId);
  // Se recorren TODAS y se compara en tiempo constante contra cada una: son un
  // puñado por negocio y así el lookup no se hace por índice sobre el secreto.
  // Sin salida temprana a propósito —`find` cortaría en la fila que matchea— para
  // que el tiempo de respuesta tampoco delate cuál de los agentes era.
  let encontrada: PrintAgentCredential | null = null;
  for (const c of credenciales) {
    if (safeEqual(token, c.apiKey)) encontrada = c;
  }
  return encontrada;
}
