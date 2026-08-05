-- Spec 091 · Backfill: poner de acuerdo los dos ejes de estado del pedido.
--
-- Desde la spec 090 todos los caminos de cancelación escriben `status` **y**
-- `lifecycle_status`. Esto arregla lo que quedó de antes, cuando cada camino
-- escribía uno solo. Son cinco UPDATE, ninguno destructivo.
--
-- ## ⚠️ Por qué se apagan los triggers
--
-- El caso D marca `cancelled_at` en 29 `order_items`, y el caso A pone 23
-- órdenes en `status='cancelled'`. Las dos cosas **dispararían la reversión de
-- inventario de la spec 089** y devolverían stock retroactivamente por ventas
-- de hace semanas.
--
-- Eso es exactamente lo que la 089 decidió NO hacer, y por una razón concreta:
-- el encargado ya hizo ajustes manuales de inventario para compensar esas
-- anulaciones que nunca devolvieron nada. Revertir ahora contaría la misma
-- mercadería dos veces y dejaría el stock peor que antes.
--
-- Se declara el corte: **de acá en adelante la reversión corre sola; el pasado
-- se arregla con el conteo físico del próximo cierre.** Por eso el backfill
-- corre con los dos triggers apagados, y como todo pasa en la transacción de la
-- migración, no hay ventana en la que una cancelación real se pierda.

alter table public.order_items disable trigger trg_stock_reversion_por_item;
alter table public.orders      disable trigger trg_recipe_stock_reversion;

-- ── A) Órdenes anuladas cuyo `status` nunca se sincronizó ───────────────────
-- 23 filas. El salón escribía `lifecycle_status` y nunca `status`, así que la
-- analítica (que lee `status`) las contaba como venta.
update public.orders
   set status = 'cancelled'
 where lifecycle_status = 'cancelled'
   and status <> 'cancelled';

-- ── B) Canceladas sin `cancelled_at` ───────────────────────────────────────
-- 4 filas, todas del canal online: se escribía `reason` y `by` pero no el
-- timestamp, que es justo por donde filtra el bloque de anulaciones del
-- resumen de turno. El encargado cancelaba deliveries con su motivo tipeado y
-- el resumen del dueño no decía una palabra.
update public.orders
   set cancelled_at = coalesce(updated_at, created_at)
 where status = 'cancelled'
   and cancelled_at is null;

-- ── C) Órdenes cerradas con el eje de producción vivo ──────────────────────
-- 7 filas. Ninguna orden de salón salía nunca de `pending`, así que el
-- dashboard contaba mesas ya cobradas como «pedidos activos» y el historial las
-- mostraba con badge «Pendiente».
update public.orders
   set status = 'delivered'
 where lifecycle_status = 'closed'
   and status not in ('delivered', 'cancelled');

-- ── D) Ítems vivos colgando de órdenes canceladas ──────────────────────────
-- 29 filas por $606.200. `anularMesa` derivaba los ítems a cancelar desde las
-- comandas activas, así que las bebidas (`station_id` null, nunca entran a
-- `comanda_items`) y todo lo cargado-sin-enviar quedaba vivo: 27 de esos 29
-- nunca pasaron por una comanda. Los seguía contando Top productos.
update public.order_items oi
   set cancelled_at = coalesce(o.cancelled_at, now()),
       cancelled_reason = coalesce(oi.cancelled_reason, 'Backfill spec 091: la orden estaba anulada')
  from public.orders o
 where o.id = oi.order_id
   and o.lifecycle_status = 'cancelled'
   and oi.cancelled_at is null;

-- ── E) Pedidos online terminales con la cuenta abierta ─────────────────────
-- 5 filas. `delivered` o `cancelled` en el eje de producción pero
-- `lifecycle_status='open'`: el cobro los seguía considerando cobrables porque
-- guarda por `lifecycle_status`.
--
-- Se acota a los que **no tienen pagos vivos**: si hay plata asentada, cerrar o
-- cancelar la cuenta por SQL sería decidir sobre un cobro sin mirar la caja, y
-- eso le corresponde a la spec 092. Hoy ese conjunto está vacío (0 filas), pero
-- la guarda queda escrita porque la migración puede correr más tarde.
update public.orders o
   set lifecycle_status = case when o.status = 'cancelled' then 'cancelled' else 'closed' end,
       closed_at = case when o.status = 'cancelled' then o.closed_at else coalesce(o.closed_at, o.updated_at, o.created_at) end
 where o.lifecycle_status = 'open'
   and o.delivery_type <> 'dine_in'
   and o.status in ('delivered', 'cancelled')
   and not exists (
     select 1 from public.payments p
      where p.order_id = o.id and p.payment_status = 'paid'
   );

alter table public.orders      enable trigger trg_recipe_stock_reversion;
alter table public.order_items enable trigger trg_stock_reversion_por_item;
