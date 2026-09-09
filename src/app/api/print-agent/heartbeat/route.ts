import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { unauthorized, autenticarAgente } from "../agent-auth";

/**
 * POST /api/print-agent/heartbeat
 * Body: { business_id: string }
 *
 * Latido del print agent on-site (spec 35). El agente lo llama cada ~15s con su
 * key. Upsertea `print_agent_status.last_seen_at`; operación deriva "conectada"
 * (now - last_seen < 60s) vs "sin conexión hace X". Desacopla la señal de salud
 * del ritmo del poll del GET.
 *
 * Issue #278: el latido trae también la versión del agente. Es opcional a
 * propósito — un agente viejo no la manda, y ese NULL es justamente el dato
 * que interesa: significa "anterior a set-2026", que es cuando el .exe dejó de
 * armar el ticket por su cuenta. El panel lo lee así.
 *
 * Spec 124: una fila POR AGENTE. Antes la PK era sólo `business_id`, así que dos
 * PCs se pisaban el latido y un agente caído se veía conectado porque el otro
 * seguía latiendo. El agente no manda nada nuevo: quién latió sale de su key.
 */
export async function POST(req: Request) {
  let body: { business_id?: string; version?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const businessId = body.business_id;
  // Auth con el business_id ya parseado (spec 046). Spec 124: la key identifica
  // al agente, que es lo que se latea.
  const agente = await autenticarAgente(req, businessId);
  if (!agente) return unauthorized();
  if (!businessId) {
    return NextResponse.json({ error: "missing business_id" }, { status: 400 });
  }

  // La versión es texto libre que manda el local: se acota acá, antes de la
  // base. Vacía cuenta como ausente — un agente que manda "" no dice nada.
  const version =
    typeof body.version === "string" ? body.version.trim().slice(0, 40) : "";

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("print_agent_status")
    .upsert(
      {
        business_id: businessId,
        agent_id: agente.id,
        last_seen_at: new Date().toISOString(),
        // Sin versión NO se pisa la que ya había: un agente viejo latiendo al
        // lado de uno nuevo no puede borrarle el dato al otro. Cada fila es de
        // un agente, así que el único que la escribe es su propio dueño.
        ...(version ? { agent_version: version } : {}),
      },
      { onConflict: "business_id,agent_id" },
    );

  if (error) {
    console.error("print-agent heartbeat", error);
    return NextResponse.json({ error: "upsert failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
