"use server";

import { ChatAnthropic } from "@langchain/anthropic";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { ensureAdminAccess } from "@/lib/admin/context";
import {
  MAX_TURNOS,
  respuestaLimpia,
  systemPrompt,
  temasCitados,
  type Turno,
} from "@/lib/ayuda/asistente";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { getBusiness } from "@/lib/tenant";

// Server action del asistente de la guía — spec 135 (RestaurantOS-Brain#36).
//
// Sin herramientas y sin acceso a datos del negocio a propósito: el asistente
// lee la guía y nada más. Darle la caja del día o las mesas es otra superficie
// —permisos, RLS, datos de plata en un prompt— y no es lo que se pidió.

/** Corto de sobra para una duda de mostrador, y acota el gasto por pregunta. */
const MAX_TOKENS = 700;

/** Mismo default que el chatbot de reservas, y se puede pisar por env. */
const MODELO = process.env.AYUDA_MODEL ?? "claude-sonnet-4-6";

const LARGO_MAX_PREGUNTA = 500;

export async function preguntarALaGuia(
  slug: string,
  pregunta: string,
  historial: Turno[] = [],
): Promise<ActionResult<{ respuesta: string; temas: string[] }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  // Mismo círculo que la guía: si podés leerla, podés preguntarle. El layout de
  // (authed) ya deja afuera al mozo; esto cubre la llamada directa a la action.
  const ctx = await ensureAdminAccess(business.id, slug);
  if (!ctx.isPlatformAdmin && ctx.role !== "admin" && ctx.role !== "encargado") {
    return actionError("No tenés permiso para usar la ayuda de este negocio.");
  }

  const texto = pregunta.trim();
  if (!texto) return actionError("Escribí una pregunta.");
  if (texto.length > LARGO_MAX_PREGUNTA) {
    return actionError("La pregunta es muy larga. Probá con uná más corta.");
  }

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return actionError(
      "El asistente no está configurado todavía. Mientras tanto, la guía está completa acá abajo.",
    );
  }

  const settings = await getReservationSettings(business.id);
  const modo: ReservationMode = settings.mode ?? "estricto";

  try {
    const llm = new ChatAnthropic({
      model: MODELO,
      maxTokens: MAX_TOKENS,
      thinking: { type: "disabled" },
    });

    // El system prompt es la guía entera y no cambia entre preguntas: marcarlo
    // `ephemeral` hace que Anthropic lo cachee, así la segunda pregunta de un
    // turno cuesta ~0.1x la primera. Es lo que vuelve viable mandar todo.
    const system = {
      role: "system" as const,
      content: [
        {
          type: "text" as const,
          text: systemPrompt(modo),
          cache_control: { type: "ephemeral" as const },
        },
      ],
    };

    const previos = historial.slice(-MAX_TURNOS).map((t) => ({
      role: t.rol === "usuario" ? ("user" as const) : ("assistant" as const),
      content: t.texto,
    }));

    const res = await llm.invoke([
      system,
      ...previos,
      { role: "user" as const, content: texto },
    ]);

    const cruda =
      typeof res.content === "string"
        ? res.content
        : res.content
            .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
            .join("");

    if (!cruda.trim()) return actionError("No pudimos responder. Probá de nuevo.");

    return actionOk({
      respuesta: respuestaLimpia(cruda),
      temas: temasCitados(cruda),
    });
  } catch {
    // El detalle del error del provider no le sirve a un encargado y puede
    // filtrar configuración; queda en el log del server.
    return actionError("No pudimos responder ahora. Probá de nuevo en un momento.");
  }
}
