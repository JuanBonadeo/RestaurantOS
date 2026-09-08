import "server-only";

import { createNotification } from "@/lib/notifications/create";

import type { VentaSinRespaldo } from "./types";

/**
 * Avisa al local que quedó un CAE vivo por una venta que no ocurrió, y que
 * alguien tiene que emitir la nota de crédito (#274 · 6).
 *
 * La spec 092 · H-05 decidió bien lo fiscal —el CAE es un hecho consumado ante
 * ARCA, la factura se cierra igual y NO se le manda el comprobante al cliente—
 * pero la parte que le tocaba al humano quedó en un `console.warn` dentro de un
 * serverless. En Facturación la fila se ve como cualquier otra autorizada: no
 * falla, no tiene el cartel rojo, tiene su CAE. Nadie se entera hasta que el
 * contador cruza el libro IVA contra la caja, meses después.
 *
 * Al `encargado`, en broadcast, igual que el aviso de emisión fallida: el
 * `admin` lo ve por `visibleTargetRoles` («el dueño ve todo») y una segunda
 * fila sería el mismo aviso dos veces en la campana del dueño. Sin actor: lo
 * dispara el cron, no una persona.
 *
 * Best-effort, como todos los avisos: que falle la campana no puede cambiar el
 * desenlace fiscal de la factura.
 *
 * TODO (fuera del lote de facturación): `src/lib/notifications/view.ts` todavía
 * no tiene renderer para `factura.nc_pendiente`, así que en la campana sale con
 * el título genérico. El payload ya lleva todo lo que ese renderer necesita.
 */
export async function notifyNotaCreditoPendiente(params: {
  businessId: string;
  invoiceId: string;
  orderId: string | null;
  motivo: VentaSinRespaldo;
  totalCents: number;
}): Promise<void> {
  await createNotification({
    businessId: params.businessId,
    targetRole: "encargado",
    type: "factura.nc_pendiente",
    payload: {
      invoiceId: params.invoiceId,
      orderId: params.orderId ?? undefined,
      motivo: params.motivo,
      totalCents: params.totalCents,
    },
  });
}
