import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusinessIdBySlug, requireProveedorContext } from "@/lib/proveedores/auth";
import { getIngredientsForLinking } from "@/lib/proveedores/queries";
import { aPropuesta, type InsumoDelCatalogo } from "@/lib/proveedores/lectura/a-propuesta";
import { hayApiKey, leerComprobante } from "@/lib/proveedores/lectura/leer";

/**
 * Leer un comprobante de proveedor — spec 172.
 *
 * Route Handler y no Server Action **porque `maxDuration` sólo se puede declarar
 * acá**: no hay `vercel.json`, y una lectura de una factura manuscrita corre
 * 15-40 s. Con una Server Action no hay forma de subir el techo y el request
 * muere sin un mensaje útil. Es el mismo patrón que
 * `api/chatbot/whatsapp/[businessId]`.
 *
 * El archivo NUNCA viaja por acá: el `ImageUploader` lo sube directo del browser
 * a Storage y esto recibe la RUTA. Por eso el límite de 1 MB de payload de las
 * Server Actions no aplica — viajan ~50 bytes.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type PropuestaRpc = {
  texto: string;
  ingredient_id: string | null;
  match_source: string | null;
};

type GenericRpc = {
  rpc: (
    fn: "proponer_insumos_para_lineas",
    args: { p_business_id: string; p_supplier_id: string | null; p_lineas: string[] },
  ) => Promise<{ data: PropuestaRpc[] | null }>;
};

const Body = z.object({
  businessSlug: z.string().min(1).max(80),
  photoPath: z.string().min(1).max(300),
  /** Para que la memoria de aliases pueda proponer. Opcional. */
  supplierId: z.string().uuid().nullable().optional(),
});

/**
 * Los mensajes distinguen de quién es el problema.
 *
 * Sólo dos mandan a sacar otra foto, y son los dos casos en que la foto es
 * efectivamente la causa. Todo lo demás dice «fue acá», porque pedirle a la
 * encargada que repita algo que no va a cambiar nada la hace sacar la misma foto
 * dos veces —ya pasó— y encima le deja la sensación de haber hecho algo mal.
 */
const MENSAJES: Record<string, string> = {
  sin_api_key: "La lectura de facturas todavía no está prendida en este local.",
  imagen_muy_pesada: "La foto es muy pesada para leerla. Sacá una nueva sin zoom o recortala.",
  formato_no_soportado:
    "Ese archivo no es una foto que pueda leer. Si es un PDF o una captura de pantalla, sacale una foto al papel con la cámara.",
  timeout: "La lectura tardó más de lo esperado. Cargalo a mano y avisanos.",
  request_rechazado: "Falló la lectura por un problema nuestro, no por la foto. Cargalo a mano y avisanos.",
  respuesta_invalida: "No pudimos leer el comprobante. Cargalo a mano.",
  modelo_no_disponible: "El lector no está respondiendo. Cargalo a mano y probá de nuevo en un rato.",
};

export async function POST(req: Request) {
  if (!hayApiKey()) {
    return NextResponse.json({ ok: false, error: MENSAJES.sin_api_key }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Datos inválidos." }, { status: 400 });
  }
  const { businessSlug, photoPath, supplierId } = parsed.data;

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) {
    return NextResponse.json({ ok: false, error: "Negocio no encontrado." }, { status: 404 });
  }

  const ctx = await requireProveedorContext(businessId);
  if (!ctx.ok) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: 403 });
  }

  /**
   * La guarda que no es opcional.
   *
   * El path lo elige el cliente y la descarga va con service role, que
   * **bypassea** las policies de `storage.objects` — justamente las que chequean
   * que el primer segmento del path sea el negocio. Sin esto, un encargado lee
   * las facturas de otro negocio mandando su ruta.
   */
  if (photoPath.split("/")[0] !== businessId) {
    return NextResponse.json(
      { ok: false, error: "Esa foto no es de este negocio." },
      { status: 403 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: blob, error: dlError } = await service.storage
    .from("supplier-invoices")
    .download(photoPath);
  if (dlError || !blob) {
    return NextResponse.json({ ok: false, error: "No encontramos la foto." }, { status: 404 });
  }

  const lectura = await leerComprobante(await blob.arrayBuffer(), blob.type || "image/jpeg");
  if (!lectura.ok) {
    // Un request rechazado es un 500: el problema es nuestro y tiene que
    // aparecer como error del server en las métricas, no como input inválido.
    const status =
      lectura.error === "timeout"
        ? 504
        : lectura.error === "sin_api_key" || lectura.error === "modelo_no_disponible"
          ? 503
          : lectura.error === "request_rechazado" || lectura.error === "respuesta_invalida"
            ? 500
            : 400;
    return NextResponse.json(
      { ok: false, error: MENSAJES[lectura.error] ?? MENSAJES.respuesta_invalida },
      { status },
    );
  }

  // «Esto no parece un comprobante» es una respuesta VÁLIDA, no una falla: es la
  // diferencia entre que Rocío saque otra foto o que llame por teléfono.
  if (!lectura.lectura.es_comprobante) {
    return NextResponse.json({
      ok: true,
      data: {
        esComprobante: false,
        motivoDescarte: lectura.lectura.motivo_descarte,
        cabecera: null,
        renglones: [],
      },
    });
  }

  const { cabecera, renglones, formato } = lectura.lectura;

  // El match corre en el server porque los umbrales viven en `pg_trgm` (0092).
  // Lo que sí se recalcula en el cliente es la CONVERSIÓN, que es pura: cuando
  // la persona corrige el insumo de un renglón, `aPropuesta` se vuelve a correr
  // ahí sin pedirle nada al server.
  // `proponer_insumos_para_lineas` es de la 0092 y todavía no está en
  // `database.types.ts` (el `pnpm db:types` necesita el CLI linkeado). Mismo
  // escape hatch que el resto del módulo para las tablas de la 158 y la 165.
  const { data: propuestas } = await (service as unknown as GenericRpc).rpc(
    "proponer_insumos_para_lineas",
    {
      p_business_id: businessId,
      p_supplier_id: supplierId ?? null,
      p_lineas: renglones.map((r) => r.descripcion),
    },
  );

  const porTexto = new Map((propuestas ?? []).map((p) => [p.texto, p]));

  const catalogo = await getIngredientsForLinking(businessId);
  const porId = new Map<string, InsumoDelCatalogo>(catalogo.map((i) => [i.id, i]));

  const propuestos = renglones.map((r) => {
    const m = porTexto.get(r.descripcion);
    const insumo = m?.ingredient_id ? (porId.get(m.ingredient_id) ?? null) : null;
    return aPropuesta(r, insumo, m?.match_source ?? null);
  });

  return NextResponse.json({
    ok: true,
    data: {
      esComprobante: true,
      motivoDescarte: null,
      formato,
      cabecera,
      renglones: propuestos,
    },
  });
}
