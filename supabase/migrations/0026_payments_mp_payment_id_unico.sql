-- ============================================================================
-- 0026 — Un pago de Mercado Pago = una fila en `payments`
--
-- El webhook de MP reintenta hasta recibir un 2xx, y con el flow de delivery
-- creando ahora su propia fila en `payments` (antes sólo tocaba
-- `orders.payment_status`), un reintento podría acreditar la misma plata dos
-- veces e inflar la caja — el mismo bug que ya nos costó el doble-submit de
-- cobro (#58, migración 0007).
--
-- `request_id` no sirve acá: es `uuid` y el id de MP es un entero externo. El
-- índice va sobre `mp_payment_id`, que es exactamente lo que identifica al pago
-- del lado de MP.
--
-- Parcial: las filas sin `mp_payment_id` (efectivo, tarjeta manual) no entran.
-- Verificado antes de aplicar: cero duplicados existentes.
-- ============================================================================

create unique index if not exists "payments_business_mp_payment_uidx"
  on "public"."payments" ("business_id", "mp_payment_id")
  where "mp_payment_id" is not null;
