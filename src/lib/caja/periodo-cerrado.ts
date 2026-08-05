import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type GenericClient = SupabaseClient;

/**
 * ¿Alguno de estos cobros ya quedó del otro lado de un arqueo o de una
 * rendición? (spec 098 · H-35)
 *
 * Devuelve el mensaje de error para el encargado, o `null` si se puede seguir.
 *
 * ## Por qué existe
 *
 * `anularCobro` es el martillo más grande de la caja —refunda **todos** los
 * pagos de una orden— y hasta ahora sólo pedía rol y motivo. Anular **una línea
 * suelta**, en cambio, sí pasaba por `evaluarGuardasDeAnulacion`, que respeta el
 * último corte y las rendiciones posteriores. La asimetría no era intencional:
 * el camino con menos control era el que más plata movía.
 *
 * Peor todavía, el mensaje de `correcciones.ts` («Anulá el cobro y volvé a
 * registrarlo») **empujaba al encargado justo hacia esa puerta sin control**
 * cada vez que la corrección fina se bloqueaba por el corte.
 *
 * Decisión de producto (Juan, 2026-08-05): **si la caja ya fue cerrada, no se
 * puede anular.** Un arqueo firmado es un hecho contable: lo que se descubre
 * después se arregla con un movimiento del período actual, no reescribiendo el
 * anterior.
 */
export async function bloqueoPorPeriodoCerrado(
  service: GenericClient,
  businessId: string,
  orderId: string,
): Promise<string | null> {
  const { data: pagos } = await service
    .from("payments")
    .select("id, caja_id, created_at, attributed_mozo_id")
    .eq("order_id", orderId)
    .eq("payment_status", "paid");

  const rows = (pagos ?? []) as Array<{
    caja_id: string | null;
    created_at: string;
    attributed_mozo_id: string | null;
  }>;
  if (rows.length === 0) return null;

  // Un corte por caja alcanza: varios pagos de la misma orden suelen compartirla.
  const cortePorCaja = new Map<string, string | null>();

  for (const pago of rows) {
    if (!pago.caja_id) continue;

    if (!cortePorCaja.has(pago.caja_id)) {
      const { data } = await service
        .from("caja_cortes")
        .select("created_at")
        .eq("caja_id", pago.caja_id)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      cortePorCaja.set(
        pago.caja_id,
        (data as { created_at: string } | null)?.created_at ?? null,
      );
    }

    const corte = cortePorCaja.get(pago.caja_id) ?? null;
    if (corte && new Date(pago.created_at).getTime() <= new Date(corte).getTime()) {
      return "Este cobro ya entró en un arqueo cerrado: anularlo cambiaría una caja que ya se contó. Registrá la diferencia como movimiento del período actual.";
    }

    // La rendición del mozo es la otra frontera firmada: sacarle el cobro le
    // cambia una liquidación que ya se cerró con él delante.
    if (pago.attributed_mozo_id) {
      const { data: rend } = await service
        .from("mozo_rendiciones")
        .select("id")
        .eq("business_id", businessId)
        .eq("mozo_id", pago.attributed_mozo_id)
        .gt("created_at", pago.created_at)
        .limit(1);
      if (((rend ?? []) as unknown[]).length > 0) {
        return "Este cobro ya entró en una rendición cerrada: anularlo le cambiaría la liquidación al mozo.";
      }
    }
  }

  return null;
}
