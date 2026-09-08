"use server";

import { ChatAnthropic } from "@langchain/anthropic";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { ensureAdminAccess } from "@/lib/admin/context";
import {
  MAX_TURNOS,
  respuestaLimpia,
  systemPrompt,
  temasCitados,
  type Turno,
} from "@/lib/ayuda/asistente";
import { temaSiguiente } from "@/lib/ayuda/contenido";
import { rolDeLaGuia } from "@/lib/ayuda/queries";
import { posicionEnRecorrido, temasDeRol } from "@/lib/ayuda/recorrido";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  //
  // Spec 169 · D8 — el gate ahora sale de los TEMAS del rol y no de una lista de
  // roles escrita acá. Si mañana se escribe la guía del salón, el mozo entra
  // solo, con su corpus, sin que haya que acordarse de tocar esta condición.
  const ctx = await ensureAdminAccess(business.id, slug);
  const rol = rolDeLaGuia(ctx);
  const suyos = temasDeRol(rol);
  if (suyos.length === 0) {
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
          text: systemPrompt(modo, suyos),
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

    const visibles = new Set(suyos.map((t) => t.slug));
    return actionOk({
      respuesta: respuestaLimpia(cruda),
      temas: temasCitados(cruda).filter((slug) => visibles.has(slug)),
    });
  } catch {
    // El detalle del error del provider no le sirve a un encargado y puede
    // filtrar configuración; queda en el log del server.
    return actionError("No pudimos responder ahora. Probá de nuevo en un momento.");
  }
}

/**
 * «Leí esto, seguí» — el botón del pie de un tema (spec 169 · D5).
 *
 * Es lo ÚNICO que marca un tema como leído. Nada de scroll-spy ni de
 * temporizadores: si alguien abrió el tema, miró el título y se fue, no leyó, y
 * es mejor que el sistema no se mienta con una métrica que sabe falsa.
 *
 * Va como `action` de un `<form>` y no como onClick de un componente cliente: no
 * necesita hidratarse para funcionar, que en el celular de un encargado en el
 * salón es la diferencia entre andar y no andar.
 *
 * El destino NO viaja en el post: se calcula acá desde el recorrido del rol. Si
 * viniera del cliente, sería un open redirect servido por nosotros.
 */
export async function marcarLeidoYSeguir(businessSlug: string, tema: string) {
  const base = `/${businessSlug}/admin/ayuda`;

  const business = await getBusiness(businessSlug);
  if (!business) redirect(base);

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  const rol = rolDeLaGuia(ctx);

  // Un tema que no es de este rol no se marca ni se navega: se vuelve al
  // índice, que ya está filtrado. Cubre el POST a mano y el slug inventado.
  const actual = temasDeRol(rol).find((t) => t.slug === tema);
  if (!actual) redirect(base);

  const supabase = await createSupabaseServerClient();
  // `ignoreDuplicates`: `leido_at` guarda la PRIMERA vez que lo leyó. Volver a
  // pasar por un tema no reescribe esa fecha — y por eso la tabla no necesita
  // policy de UPDATE.
  await supabase.from("ayuda_lecturas").upsert(
    { business_id: business.id, user_id: ctx.userId, tema: actual.slug },
    { onConflict: "business_id,user_id,tema", ignoreDuplicates: true },
  );

  // El pendiente del sidebar y el punto del chip los pinta el layout, que es un
  // segmento distinto del que estamos devolviendo: sin esto, el contador queda
  // en el número viejo hasta la próxima navegación dura.
  revalidatePath(`/${businessSlug}/admin`, "layout");

  const settings = await getReservationSettings(business.id);
  const modo: ReservationMode = settings.mode ?? "estricto";

  const posicion = posicionEnRecorrido(actual.slug, rol, modo);
  if (posicion) {
    // Último del recorrido: se termina acá, y el índice lo dice.
    redirect(
      posicion.siguiente ? `${base}/${posicion.siguiente.slug}` : `${base}?listo=1`,
    );
  }

  // Fuera del recorrido la guía se lee salteada, no de corrido: se sigue el
  // orden del índice, que es lo que ya hacía el botón antes de esta spec.
  const siguiente = temaSiguiente(actual.slug, modo);
  redirect(siguiente ? `${base}/${siguiente.slug}` : base);
}
