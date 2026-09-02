import { GRUPOS, TEMAS, pasosDe } from "@/lib/ayuda/contenido";
import type { ReservationMode } from "@/lib/reservations/types";

// ============================================
// El contexto del asistente de la guía — spec 135 (RestaurantOS-Brain#36).
//
// La guía entera entra en un prompt: son ~40 KB de texto ya curado, ya
// verificado contra el código y ya escrito en el idioma del encargado. Por eso
// acá no hay RAG, ni embeddings, ni base vectorial: mandar todo es más simple,
// más barato con prompt caching, y sobre todo NO PIERDE NADA. Un recuperador
// que trae los tres pasos «más parecidos» es exactamente el que se olvida del
// aviso en rojo que estaba dos pasos más abajo.
//
// El día que la guía no entre —digamos, arriba de 150 KB— esto se reemplaza por
// recuperación POR TEMA (traer el tema entero, nunca fragmentos sueltos), que
// conserva la propiedad que importa: los avisos viajan con su paso.
// ============================================

/** Cuánto de la conversación se manda de vuelta. Alcanza y sobra para
 *  repreguntas del tipo «¿y si es más de eso?». */
export const MAX_TURNOS = 6;

export type Turno = { rol: "usuario" | "asistente"; texto: string };

/**
 * La guía completa, en texto plano, para meter en el prompt.
 *
 * Se arma desde `TEMAS` y no desde un markdown aparte a propósito: si hubiera
 * una copia, se desactualizaría, y un asistente que cita una guía vieja es peor
 * que uno que no sabe. Acá la fuente es la misma que se pinta en pantalla.
 */
export function guiaComoTexto(modo: ReservationMode): string {
  const partes: string[] = [];

  for (const grupo of GRUPOS) {
    const temas = TEMAS.filter((t) => t.grupo === grupo.id);
    if (temas.length === 0) continue;
    partes.push(`\n## GRUPO: ${grupo.titulo} — ${grupo.bajada}`);

    for (const tema of temas) {
      partes.push(`\n### TEMA [${tema.slug}] ${tema.titulo}`);
      partes.push(`Resumen: ${tema.resumen}`);
      if (tema.claves.length > 0) {
        partes.push(`Lo importante:`);
        for (const clave of tema.claves) partes.push(`- ${clave}`);
      }
      for (const paso of pasosDe(tema, modo)) {
        partes.push(`\n#### ${paso.titulo}`);
        partes.push(paso.texto);
        if (paso.aviso) {
          const etiqueta = paso.aviso.tono === "peligro" ? "PELIGRO" : "OJO";
          partes.push(`[${etiqueta}] ${paso.aviso.texto}`);
        }
        if (paso.verTambien) {
          partes.push(`(ver también el tema [${paso.verTambien.tema}])`);
        }
      }
    }
  }

  return partes.join("\n").trim();
}

/**
 * El system prompt.
 *
 * Las tres reglas duras no son de estilo, son de seguridad del producto:
 *
 *  1. **Sólo la guía.** El encargado pregunta sobre plata, permisos y
 *     anulaciones. Un asistente que completa con lo que «suele pasar en un
 *     restaurante» va a inventar un tope de descuento o un permiso, y eso es
 *     peor que no tener asistente: se le cree.
 *  2. **No fabricar frases de pantalla.** Las frases entre comillas de la guía
 *     son literales del código, y el encargado las usa para reconocer un
 *     cartel. Una inventada manda a buscar algo que no existe.
 *  3. **Decir que no sabe.** Es la respuesta correcta más seguido de lo que
 *     parece, y la que mantiene el resto creíble.
 */
export function systemPrompt(modo: ReservationMode): string {
  return `Sos el asistente de la guía del encargado de un restaurante que usa RestaurantOS.
Te hablan encargados de salón en medio del turno: apurados, de pie, a veces desde el celular.

TU ÚNICA FUENTE ES LA GUÍA QUE VIENE ABAJO. No sabés nada más del sistema.

Reglas, en orden de importancia:

1. Si la respuesta está en la guía, contestala y nombrá el tema del que sale usando su
   identificador entre corchetes, por ejemplo [caja]. Poné el identificador aunque el
   tema no se llame igual que la pregunta.
2. Si la respuesta NO está en la guía, decilo derecho: "Eso no está en la guía" y sugerí
   a quién preguntarle (el dueño, o quien configura el sistema). NO completes con lo que
   suele pasar en un restaurante ni con lo que te parezca razonable. Preferís quedar
   corto antes que inventar un número, un permiso o un paso.
3. NUNCA inventes una frase de la pantalla. Las frases entre comillas de la guía son
   textuales del sistema y el encargado las usa para reconocer un cartel; si inventás
   una, lo mandás a buscar algo que no existe. Citá sólo las que están en la guía.
4. Si algo lo hace el dueño y no el encargado, decilo — le ahorra buscar un botón que
   no va a encontrar.

Cómo escribís:
- Español rioplatense, de vos. Directo y corto: dos o tres frases si alcanza.
- Sin markdown, sin listas con viñetas, sin negritas. Texto corrido.
- Nada de "según la guía" ni "como asistente": contestá y ya.
- Las palabras son las del local: comanda, comandera, arqueo, rendición, fichar, mesa,
  cuenta. Nunca digas kanban, endpoint, payload, RLS ni spec.

El modo de reservas de este negocio es "${modo}", y la guía de abajo ya está escrita
para ese modo. No menciones que existe otro modo.

=== GUÍA ===

${guiaComoTexto(modo)}`;
}

/** Los `[slug]` que el modelo citó, filtrados contra los temas que existen: si
 *  alucina un identificador, no se pinta un link roto. */
export function temasCitados(respuesta: string): string[] {
  const validos = new Set(TEMAS.map((t) => t.slug));
  const encontrados = [...respuesta.matchAll(/\[([a-z0-9-]+)\]/g)].map((m) => m[1]);
  return [...new Set(encontrados)].filter((slug) => validos.has(slug));
}

/** El texto sin los `[slug]`: los links se pintan aparte, abajo de la
 *  respuesta, y dejarlos en el medio de la frase la vuelve ilegible. */
export function respuestaLimpia(respuesta: string): string {
  return respuesta.replace(/\s*\[[a-z0-9-]+\]/g, "").replace(/\s{2,}/g, " ").trim();
}
