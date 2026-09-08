import { z } from "zod";

/**
 * Lo que el modelo tiene permitido decir — spec 172·D1.
 *
 * **Todos los números salen como STRING, verbatim.** Si el modelo devolviera
 * `number` tendría que decidir él si `17.500` es diecisiete mil quinientos o
 * diecisiete y medio — que es exactamente la interpretación que queremos mover
 * al código, y exactamente donde se equivoca en silencio. Además el JSON number
 * borra la evidencia: `"82,600"` con coma y `"1.445.500"` con puntos son las dos
 * pistas que permiten desambiguar por convención argentina y, cuando eso no
 * alcanza, por aritmética.
 *
 * **Todo puede venir en `null`.** Es la regla que más pesa del prompt: un campo
 * vacío lo completa una persona en dos segundos, uno inventado se carga mal y no
 * lo nota nadie. Los dos errores no cuestan lo mismo.
 *
 * Va como JSON Schema crudo y no por `zodOutputFormat`: hay un gotcha registrado
 * en un repo hermano de la organización (BOOT_ERROR en el runtime de Supabase
 * Edge) y el schema a mano no cuesta nada.
 */
export const ESQUEMA_LECTURA = {
  type: "object",
  additionalProperties: false,
  required: ["es_comprobante", "motivo_descarte", "formato", "cabecera", "renglones"],
  properties: {
    es_comprobante: {
      type: "boolean",
      description:
        "true sólo si la imagen es un comprobante de COMPRA a un proveedor (factura, ticket, remito, recibo, nota de pedido, lista de pedido). false para cualquier otra cosa.",
    },
    motivo_descarte: {
      type: ["string", "null"],
      description:
        "Si es_comprobante es false: qué se ve en la foto, en una frase. Si es true: null.",
    },
    formato: {
      type: "string",
      enum: ["manuscrito", "lista_preimpresa", "ticket_termico", "factura_impresa", "recibo", "otro"],
      description: "Qué clase de papel es. Observación, no interpretación.",
    },
    cabecera: {
      type: "object",
      additionalProperties: false,
      required: [
        "proveedor_nombre",
        "proveedor_cuit",
        "tipo_comprobante",
        "numero",
        "fecha",
        "total",
        "origen_total",
      ],
      properties: {
        proveedor_nombre: {
          type: ["string", "null"],
          description:
            "Razón social o nombre de fantasía del que EMITE (el que nos vende). No el destinatario.",
        },
        proveedor_cuit: {
          type: ["string", "null"],
          description:
            "CUIT del emisor, con los guiones tal cual están impresos. Si hay dos CUIT, el del emisor está junto a su razón social en el encabezado; el otro es el nuestro. Si no podés distinguir cuál es cuál, null.",
        },
        tipo_comprobante: {
          type: ["string", "null"],
          enum: [
            "factura_a",
            "factura_b",
            "factura_c",
            "ticket",
            "remito",
            "nota_credito",
            "nota_debito",
            "otro",
            null,
          ],
          description:
            "Lo que dice el papel. 'FACTURA A' o la letra A en el recuadro → factura_a. 'TIQUE FACTURA A' → factura_a. 'REMITO' → remito. Talonario sin letra fiscal → otro.",
        },
        numero: {
          type: ["string", "null"],
          description: "Número del comprobante tal cual está impreso, con guiones y ceros.",
        },
        fecha: {
          type: ["string", "null"],
          description:
            "La fecha del comprobante COMO ESTÁ ESCRITA ('08/09/26', '8-9-2026'). No la conviertas ni la completes.",
        },
        total: {
          type: ["string", "null"],
          description:
            "El TOTAL FINAL a pagar, verbatim. El renglón que dice TOTAL / TOTAL A PAGAR / IMPORTE TOTAL. No lo sumes vos.",
        },
        origen_total: {
          type: ["string", "null"],
          description: "El fragmento de donde leíste el total, copiado tal cual.",
        },
      },
    },
    renglones: {
      type: "array",
      description: "Un elemento por ÍTEM COMPRADO. Ver 'LO QUE NO ES UN ÍTEM'. Máximo 60.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "descripcion",
          "cantidad",
          "unidad",
          "precio_unitario",
          "total_linea",
          "origen",
          "confianza",
        ],
        properties: {
          descripcion: {
            type: "string",
            description:
              "El nombre del producto TAL CUAL está escrito, incluso truncado o abreviado ('Pickers Pulpa de Pal'). No lo completes ni lo corrijas.",
          },
          cantidad: {
            type: ["string", "null"],
            description:
              "La cantidad TAL CUAL está escrita, con su coma o punto original ('82,600', '2', '1/2', '0,4260'). Nunca la normalices.",
          },
          unidad: {
            type: ["string", "null"],
            description:
              "La unidad tal cual aparece ('kg', 'un', 'lt', 'caj', 'x1B'). Si el renglón no dice unidad, null. No la deduzcas del producto.",
          },
          precio_unitario: {
            type: ["string", "null"],
            description:
              "El precio POR UNIDAD tal cual está escrito. Si la línea sólo trae el total, null.",
          },
          total_linea: {
            type: ["string", "null"],
            description:
              "El importe de ESTA línea tal cual está escrito. Si no está impreso, null. NO lo calcules.",
          },
          origen: {
            type: "string",
            description:
              "El fragmento del documento del que sale esta línea, copiado tal cual. Es la prueba de que la línea existe.",
          },
          confianza: {
            type: "string",
            enum: ["alta", "media", "baja"],
            description:
              "alta: se lee sin esfuerzo. media: se lee pero algún trazo o alineación admite duda. baja: lo leí y podría estar equivocándome. Si un dígito NO se lee, ese campo va en null — eso no es 'baja', es null.",
          },
        },
      },
    },
  },
} as const;

/**
 * El espejo en Zod. No es redundante con el structured output: éste garantiza la
 * FORMA, no que un enum no llegue como `""` ni que el array exista. Y es lo que
 * se testea con fixtures sin llamar al modelo.
 */
export const RenglonModelo = z.object({
  descripcion: z.string(),
  cantidad: z.string().nullable(),
  unidad: z.string().nullable(),
  precio_unitario: z.string().nullable(),
  total_linea: z.string().nullable(),
  origen: z.string(),
  confianza: z.enum(["alta", "media", "baja"]),
});

export const CabeceraModelo = z.object({
  proveedor_nombre: z.string().nullable(),
  proveedor_cuit: z.string().nullable(),
  tipo_comprobante: z
    .enum([
      "factura_a",
      "factura_b",
      "factura_c",
      "ticket",
      "remito",
      "nota_credito",
      "nota_debito",
      "otro",
    ])
    .nullable(),
  numero: z.string().nullable(),
  fecha: z.string().nullable(),
  total: z.string().nullable(),
  origen_total: z.string().nullable(),
});

export const LecturaModelo = z.object({
  es_comprobante: z.boolean(),
  motivo_descarte: z.string().nullable(),
  formato: z.enum([
    "manuscrito",
    "lista_preimpresa",
    "ticket_termico",
    "factura_impresa",
    "recibo",
    "otro",
  ]),
  cabecera: CabeceraModelo,
  renglones: z.array(RenglonModelo).max(60),
});

export type LecturaModelo = z.infer<typeof LecturaModelo>;
export type RenglonModelo = z.infer<typeof RenglonModelo>;
