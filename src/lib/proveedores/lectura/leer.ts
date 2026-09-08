import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { PROMPT_LECTURA } from "./prompt";
import { LecturaModelo } from "./schema-modelo";

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

/**
 * El tipo real del archivo, leído de sus primeros bytes.
 *
 * NO se confía en el MIME que reporta Storage: es el que el browser adivinó al
 * subir, y puede venir vacío, como `application/octet-stream`, o simplemente
 * mentir. Los bytes no mienten, y acá el costo de equivocarse es un mensaje que
 * manda a la encargada a sacar otra foto por un problema que no es de la foto.
 */
export function detectarMime(bytes: ArrayBuffer): MimeSoportado | "application/pdf" | null {
  const b = new Uint8Array(bytes.slice(0, 16));
  const es = (...xs: number[]) => xs.every((x, i) => b[i] === x);

  if (es(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (es(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (es(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (es(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  // RIFF....WEBP
  if (es(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  // ftyp{heic,heix,hevc,mif1} — lo que sale de un iPhone sin convertir.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return null;
  return null;
}

export type ErrorLectura =
  | "sin_api_key"
  | "imagen_muy_pesada"
  | "formato_no_soportado"
  | "timeout"
  | "respuesta_invalida"
  /**
   * La API rechazó NUESTRO request. No tiene nada que ver con la foto.
   *
   * Antes esto caía en `formato_no_soportado`, cuyo mensaje manda a sacar otra
   * foto — y eso hizo que un schema mal armado de nuestro lado se leyera como
   * culpa de la encargada, que sacó la misma foto dos veces. Un error nuestro
   * nunca se muestra como un error del usuario.
   */
  | "request_rechazado"
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

  // El MIME declarado es una pista; los bytes son la verdad. Si Storage dice
  // `application/octet-stream` pero adentro hay un JPEG, se lee igual.
  const real = detectarMime(bytes);
  if (real === null) return { ok: false, error: "formato_no_soportado" };
  if (real === "application/pdf") return { ok: false, error: "formato_no_soportado" };
  void mime;

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
        /**
         * El formato lo deriva `zodOutputFormat` del mismo Zod que valida la
         * respuesta — una sola fuente de verdad.
         *
         * El JSON Schema que había acá escrito a mano usaba `type: ["string",
         * "null"]` para los campos opcionales, que el validador de structured
         * outputs NO acepta: espera `anyOf: [{type:"string"},{type:"null"}]`.
         * La API devolvía 400 en TODAS las lecturas, con cualquier foto.
         */
        format: zodOutputFormat(LecturaModelo),
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
      // Un 400 es SIEMPRE culpa nuestra: schema inválido, imagen que la API no
      // digiere, parámetro mal. El mensaje va entero al log porque es lo único
      // que después permite saber cuál de esas fue.
      console.error("leerComprobante · la API rechazó el request", e.message);
      return { ok: false, error: "request_rechazado" };
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
