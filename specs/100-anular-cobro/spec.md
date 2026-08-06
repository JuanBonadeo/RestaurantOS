# Feature Specification: Anular cobro — la nota de crédito primero, y la mesa vuelve al plano

**Feature Branch**: `100-anular-cobro`

**Created**: 2026-08-06

**Status**: ✅ Implementada

**Issue**: #151

## El problema

`anularCobro` es el martillo más grande de la caja y tenía dos agujeros de distinto tipo.

**El fiscal.** La action no miraba `invoices` **una sola vez**: reembolsaba los `payments`, reabría la orden, escribía el `caja_audit_log` — y la factura quedaba `authorized`, con su CAE vivo, por una venta que ya no existía. Plata devuelta en caja e IVA declarado ante ARCA por el mismo consumo.

**El operativo.** El caso que dispara casi todas las anulaciones es que el mozo **cobró la mesa equivocada**. Esa gente sigue sentada comiendo y su mesa desapareció del plano. Los `order_items` nunca se tocaron: lo que faltaba era el puntero y un estado que no mintiera. La restitución existía pero corría sólo `if (fromStatus === 'libre')`, volvía siempre a `pidio_cuenta` y reescribía `opened_at`/`bill_requested_at` con `now()`.

## La decisión

**En AR una factura autorizada no se borra: se anula emitiendo la nota de crédito.** Eso ya lo hace `anularFactura` (spec 09) — NC del mismo tipo fiscal, mismo receptor, `comprobantes_asociados` a la original, y la original a `cancelled` sólo si la NC salió con CAE.

Lo que faltaba era **el orden**: NC primero, caja después. La anulación del cobro **bloquea** en vez de encadenar la NC — la NC puede fallar en ARCA, y no querés haber devuelto la plata antes de saberlo.

Y del lado de la mesa: **anular un cobro devuelve la mesa como estaba**, no a un estado por default.

## Las tres decisiones de la mesa

Viven en `src/lib/billing/restitucion-mesa.ts`, puras y testeadas aparte del I/O.

| Qué | Antes | Ahora |
|---|---|---|
| El puntero (`current_order_id`) | sólo si la mesa había quedado `libre` | siempre — salvo que la mesa ya tenga otra cuenta encima |
| El estado | siempre `pidio_cuenta` | `pidio_cuenta` sólo si la orden traía `bill_requested_at`; si no, `ocupada` |
| `opened_at` | `now()` | el `created_at` de la cuenta |

La segunda es la que importa para el caso real: esa mesa **nunca pidió la cuenta**, la cobraron por error, y marcarla `pidio_cuenta` inventa un pedido que no ocurrió. La tercera también se veía: con `opened_at = now()` el color por demora (spec 30) arrancaba de cero y gente sentada hace dos horas aparecía recién llegada.

`order.table_id` sigue al traslado (spec 048 lo reescribe), así que es la mesa correcta incluso si la cuenta se movió antes de cobrarse.

**La reserva** que el cobro dio por `completed` vuelve a `seated`: si la cuenta se reabre, esa gente sigue en la mesa. Se ancla al momento del cobro (`orders.closed_at`) y sólo mira ese servicio — la reserva empezó antes de cobrar y no más de 12 h atrás —, así no resucita el turno del mediodía cuando se anula un cobro de la noche.

## El agujero adyacente: Factura A sobre una B viva

El guard de `emitInvoice` filtraba `.eq("tipo_comprobante", tipo)`, y el índice único parcial `invoices_order_tipo_active_uq` también lleva el tipo. O sea: **una Factura A entraba limpia sobre una B autorizada**. El caso llega solo —el cliente pide la A después de que le hicimos la B— y terminaba con los dos comprobantes vivos por el mismo consumo. Lo único que lo tapaba era que la UI le pasa `existingInvoice` al cliente (`cobrar-desktop-client`): blindaje de pantalla, no de servidor.

Ahora el guard mira **cualquier `factura_a|factura_b` autorizada** de la orden y, si es de otro tipo, lo dice con el número: para cambiar de tipo hay que anular la anterior (NC) y recién ahí emitir. Las NC quedan fuera del filtro a propósito — son comprobantes de la misma orden y `authorized`, pero no son "la factura vigente" de nadie.

De la misma familia: `getInvoiceForOrder` traía cualquier comprobante `authorized` con `maybeSingle()`. Una orden anulada y re-facturada tiene **dos** (la NC + la factura nueva), y `maybeSingle()` con dos filas devuelve error y `data: null` → la UI concluía "no hay comprobante" y volvía a ofrecer emitir, justo en la orden que más comprobantes tenía.

## UI

El diálogo de anular cobro (panel del encargado y vista mozo, que son el mismo componente duplicado) muestra el aviso con el número del comprobante y deshabilita el formulario cuando hay factura viva — la guarda real sigue siendo la del server, esto sólo evita escribir el motivo para comerse el rechazo al confirmar. Y el texto dejó de prometer que "la mesa vuelve a esperando cuenta": ahora vuelve al plano como estaba, con todos sus ítems.

## Verify

- `pnpm typecheck` ✅ · suite unitaria ✅ **1485 tests, 0 rojos** (143 archivos; integración excluida por falta de stack local).
- `cobro.integration.test.ts` contra el **cloud**: ✅ 13/13, con tres casos nuevos —
  la mesa vuelve `ocupada` con `current_order_id` y el `opened_at` de la cuenta,
  la cuenta ya pedida vuelve a `pidio_cuenta` sin pisar `bill_requested_at`,
  y con factura autorizada la anulación se rechaza **sin mover un peso** (orden `closed`, pagos `paid`).
- `emit-invoice.integration.test.ts` contra el **cloud**: ✅ 15/15, con el caso nuevo A-sobre-B: rechazo, cero filas `factura_a`, y después de la NC la A sale autorizada.
- **No verificado en vivo con el rol real** (encargado en el panel).

## Lo que queda afuera

- **NC parcial.** `anularFactura` emite siempre por el total. Una devolución parcial (sacaron un plato de la cuenta ya facturada) hoy es anular todo y volver a facturar por lo que corresponde.
- **Encadenar NC + anulación de cobro en un solo botón.** Se decidió bloquear; el encargado hace los dos pasos y ve el resultado de cada uno.
