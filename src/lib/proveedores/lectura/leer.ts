import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { PROMPT_LECTURA } from "./prompt";
import { ESQUEMA_LECTURA, LecturaModelo } from "./schema-modelo";

/**
 * La única capa no determinística del lector — spec 172.
 *
 * El modelo transcribe y nada más: la conversión, la verificación aritmética y
 * el match viven en módulos puros que se testean sin gastar un peso.
 *
 * El modelo se puede pisar por env, como el chatbot (`CHATBOT_MODEL`) y el
 * asistente de la guía (`AYUDA_MODEL`): bajar a `claude-sonnet-5` es una decisión
 * de config, no un cambio de código.
 */
const MODELO = process.env.COMPROBANTE_MODEL ?? "claude-opus-5";

/** 45 s de los 60 de `maxDuration`, para que quede margen de respuesta. */
const TECHO_MS = 45_000;

/**
 * El techo por imagen de la API es 5 MB y el base64 infla 4/3, así que el
 * archivo tiene que quedar debajo de ~3,6 MB. El uploader ya achica a 2200 px,
 * pero esto es la red: un objeto viejo del bucket puede ser más grande.
 */
const MAX_BYTES = 3_600_000;

const MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type MimeSoportado = (typeof MIMES)[number];

export type ErrorLectura =
  | "sin_api_key"
  | "imagen_muy_pesada"
  | "formato_no_soportado"
  | "timeout"
  | "respuesta_invalida"
  | "modelo_no_disponible";

export type ResultadoLectura =
  | { ok: true; lectura: LecturaModelo }
  | { ok: false; error: ErrorLectura };

export function hayApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function leerComprobante(
  bytes: ArrayBuffer,
  mime: string,
): Promise<ResultadoLectura> {
  if (!hayApiKey()) return { ok: false, error: "sin_api_key" };
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: "imagen_muy_pesada" };
  if (!MIMES.includes(mime as MimeSoportado)) return { ok: false, error: "formato_no_soportado" };

  const client = new Anthropic({ timeout: TECHO_MS });

  let texto: string;
  try {
    const res = await client.messages.create({
      model: MODELO,
      max_tokens: 8000,
      // El system va PRIMERO y cacheado: las instrucciones son lo estable entre
      // comprobantes y la imagen cambia siempre. Con el orden al revés el caché
      // no pega nunca, y Rocío carga los comprobantes de a pila.
      system: [
        { type: "text", text: PROMPT_LECTURA, cache_control: { type: "ephemeral" } },
      ],
      output_config: {
        // Leer una manuscrita y emparejar las columnas de un ticket es
        // percepción difícil: acá el rato de razonamiento se paga solo.
        effort: "high",
        format: { type: "json_schema", schema: ESQUEMA_LECTURA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime as MimeSoportado,
                data: Buffer.from(bytes).toString("base64"),
              },
            },
            { type: "text", text: "Transcribí este comprobante." },
          ],
        },
      ],
    });

    const bloque = res.content.find((b) => b.type === "text");
    if (!bloque || bloque.type !== "text") return { ok: false, error: "respuesta_invalida" };
    // Cortado a la mitad es JSON roto: se trata como basura, no se intenta
    // reparar. `max_tokens: 8000` da margen de sobra para 60 renglones.
    if (res.stop_reason === "max_tokens") return { ok: false, error: "respuesta_invalida" };
    texto = bloque.text;
  } catch (e) {
    // Clases tipadas del SDK, nunca string-matching sobre el mensaje.
    if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: "timeout" };
    if (e instanceof Anthropic.BadRequestError) {
      console.error("leerComprobante · request rechazado", e.message);
      return { ok: false, error: "formato_no_soportado" };
    }
    if (e instanceof Anthropic.APIError) {
      console.error("leerComprobante · error del proveedor", e.status, e.message);
      return { ok: false, error: "modelo_no_disponible" };
    }
    console.error("leerComprobante · error inesperado", e);
    return { ok: false, error: "modelo_no_disponible" };
  }

  // El structured output garantiza la FORMA; esto garantiza que el contenido
  // sea el que esperamos. Nunca se propaga el mensaje del proveedor al
  // encargado: el error que ve es nuestro.
  try {
    const parsed = LecturaModelo.safeParse(JSON.parse(texto));
    if (!parsed.success) {
      console.error("leerComprobante · payload fuera de contrato", parsed.error.issues.slice(0, 3));
      return { ok: false, error: "respuesta_invalida" };
    }
    return { ok: true, lectura: parsed.data };
  } catch {
    console.error("leerComprobante · JSON ilegible", texto.slice(0, 500));
    return { ok: false, error: "respuesta_invalida" };
  }
}
