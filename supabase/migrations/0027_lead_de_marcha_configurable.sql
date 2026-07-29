-- ============================================================================
-- 0027 — Lead de marcha de los pedidos programados, configurable por negocio
--
-- Spec 061. Hasta acá, cuánto antes de `scheduled_at` se marchaba un pedido
-- diferido a cocina era una constante de TS clavada en 40 min
-- (`SCHEDULED_MARCH_LEAD_MIN`), declarada deuda asumida por el propio spec 31
-- ("configurables = segundo paso, design D7"). Dos leads separados porque un
-- delivery, además de cocinarse, tiene que viajar.
--
-- Aditiva y retrocompatible: el default de retiro (40) reproduce exactamente el
-- comportamiento actual; el de delivery (60) estrena el caso que spec 061 abre.
-- Sin backfill.
--
-- Van en `businesses` (no en `settings` jsonb) por dos razones: son la misma
-- familia que `delivery_fee_cents` / `min_order_cents` /
-- `estimated_delivery_minutes`, que ya son columnas; y el cron las lee en un
-- join, no en un blob. La 0018 ya revocó el SELECT de anon/authenticated sobre
-- `businesses`, así que no hay superficie nueva expuesta.
-- ============================================================================

alter table "public"."businesses"
  add column if not exists "scheduled_march_lead_pickup_min" int not null default 40;

alter table "public"."businesses"
  add column if not exists "scheduled_march_lead_delivery_min" int not null default 60;

-- Techo 240 min (4 h): más que eso deja de ser "anticipación" y pasa a ser
-- marchar el pedido cuando entra. El mismo número acota la ventana del filtro
-- SQL del cron (`MAX_MARCH_LEAD_MIN`).
alter table "public"."businesses"
  drop constraint if exists "businesses_scheduled_march_lead_pickup_check";
alter table "public"."businesses"
  add constraint "businesses_scheduled_march_lead_pickup_check"
  check ("scheduled_march_lead_pickup_min" between 0 and 240);

alter table "public"."businesses"
  drop constraint if exists "businesses_scheduled_march_lead_delivery_check";
alter table "public"."businesses"
  add constraint "businesses_scheduled_march_lead_delivery_check"
  check ("scheduled_march_lead_delivery_min" between 0 and 240);

comment on column "public"."businesses"."scheduled_march_lead_pickup_min" is
  'Spec 061: minutos antes de `orders.scheduled_at` en que un pedido programado de RETIRO se marcha a cocina (crea comandas → imprime). Default 40 = el valor que estaba hardcodeado en spec 31.';

comment on column "public"."businesses"."scheduled_march_lead_delivery_min" is
  'Spec 061: minutos antes de `orders.scheduled_at` en que un pedido programado de DELIVERY se marcha a cocina. Default 60 — mayor que el de retiro porque además de cocinar hay que viajar.';

comment on column "public"."orders"."scheduled_at" is
  'Pedido diferido (spec 31 + 061): fecha/hora futura de retiro o entrega. Null = para ahora. Si es futuro, el pedido no marcha hasta el lead del negocio (businesses.scheduled_march_lead_{pickup,delivery}_min) vía el cron `orders-march-scheduled`, o hasta "marchar ahora". Un programado en efectivo no marcha hasta que el encargado lo acepta (status → confirmed).';
