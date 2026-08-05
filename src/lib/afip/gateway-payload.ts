import { formatInTimeZone } from "date-fns-tz";

import { calculateAmounts } from "./calculate-amounts";
import type {
  CondicionIvaReceptor,
  InvoiceRequest,
  TipoComprobante,
} from "./types";

const AR_TZ = "America/Argentina/Buenos_Aires";

/** Tipos de comprobante de ARCA (A=1/2/3, B=6/7/8, C=11/12/13). */
const TIPO_MAP: Record<TipoComprobante, number> = {
  factura_a: 1,
  factura_b: 6,
  nota_credito_a: 3,
  nota_credito_b: 8,
};

const CONCEPTO_MAP: Record<InvoiceRequest["concepto"], number> = {
  productos: 1,
  servicios: 2,
  productos_y_servicios: 3,
};

/** id 5 = alícuota 21% (la única que maneja el dominio hoy). */
const IVA_ID_21 = 5;

function isTipoA(tipo: TipoComprobante): boolean {
  return tipo === "factura_a" || tipo === "nota_credito_a";
}

/**
 * Condición IVA del receptor (RG 5616). Cuando el flujo la capturó
 * explícitamente (receptor identificado por CUIT — Monotributo/Exento/RI/CF),
 * esa condición **gana**. Si no vino (consumidor final sin identificar, o filas
 * históricas previas a la spec 053), se cae al default por tipo:
 * - Factura/NC **A** → Responsable Inscripto (1).
 * - Factura/NC **B** → Consumidor Final (5) — el caso típico del local.
 *
 * Ver spec 053 (R-C6 del issue #51): antes esto era un hardcode por tipo que
 * declaraba mal a un Monotributista (B con CUIT → CF, o A → RI).
 */
function condicionIvaFor(
  tipo: TipoComprobante,
  explicit?: CondicionIvaReceptor | null,
): CondicionIvaReceptor {
  if (explicit) return explicit;
  return isTipoA(tipo) ? 1 : 5;
}

/** Documento del receptor: 80=CUIT, 99=consumidor final (doc_nro "0"). */
function receptorDoc(cuitReceptor?: string): {
  doc_tipo: number;
  doc_nro: string;
} {
  if (cuitReceptor && cuitReceptor.trim()) {
    return { doc_tipo: 80, doc_nro: cuitReceptor.replace(/\D/g, "") };
  }
  return { doc_tipo: 99, doc_nro: "0" };
}

/** Redondea a 2 decimales (los importes viajan en pesos, no centavos). */
function toPesos(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Traduce nuestro `InvoiceRequest` al body del gateway
 * (`POST /api/t/<slug>/v1/invoices`). Puro y testeable: no toca red.
 *
 * `fecha` opcional para tests deterministas; por defecto usa hoy en tz AR.
 */
export function buildGatewayInvoiceBody(
  req: InvoiceRequest,
  fecha?: string,
): Record<string, unknown> {
  const amounts = calculateAmounts(req.totalCents);
  const doc = receptorDoc(req.cuitReceptor);

  const body: Record<string, unknown> = {
    punto_venta: req.puntoVenta,
    tipo_comprobante: TIPO_MAP[req.tipo],
    concepto: CONCEPTO_MAP[req.concepto],
    receptor: {
      doc_tipo: doc.doc_tipo,
      doc_nro: doc.doc_nro,
      condicion_iva: condicionIvaFor(req.tipo, req.condicionIvaReceptor),
    },
    importe_total: toPesos(amounts.totalCents),
    importe_neto: toPesos(amounts.netoCents),
    // A y B discriminan IVA en WSFEv1 (aunque B no lo imprima). El dominio no
    // emite Factura C, así que siempre mandamos la alícuota 21%.
    iva: [
      {
        id: IVA_ID_21,
        base_imp: toPesos(amounts.netoCents),
        importe: toPesos(amounts.ivaCents),
      },
    ],
    fecha: fecha ?? formatInTimeZone(new Date(), AR_TZ, "yyyy-MM-dd"),
  };

  if (req.razonSocialReceptor) {
    (body.receptor as Record<string, unknown>).razon_social =
      req.razonSocialReceptor;
  }

  if (req.comprobantesAsociados && req.comprobantesAsociados.length > 0) {
    body.comprobantes_asociados = req.comprobantesAsociados.map((c) => ({
      tipo: TIPO_MAP[c.tipo],
      punto_venta: c.puntoVenta,
      numero: c.numero,
    }));
  }

  // El gateway guarda `metadata` tal cual y la devuelve en el webhook. Mandarla
  // hoy no cuesta nada y deja la correlación lista para la fase 2 (spec 088).
  if (req.metadata && Object.keys(req.metadata).length > 0) {
    body.metadata = req.metadata;
  }

  return body;
}
