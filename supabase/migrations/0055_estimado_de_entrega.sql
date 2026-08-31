-- 0055_estimado_de_entrega.sql
-- Spec 133 · el «para cuándo» del checkout dice la verdad (#205).
--
-- El checkout prometía «40 min» en envío y «15–20 min» en retiro, dos números
-- escritos a mano que ninguna cocina sostiene un sábado. Juan: el envío es de
-- 1 h a 1 h 30 y el retiro de 40 min a 1 h.
--
-- El piso de cada modo pasa a ser config del negocio (el techo lo redondea la
-- app al siguiente medio horario). `estimated_delivery_minutes` ya existía;
-- faltaba el de retiro.

alter table "public"."businesses"
  add column if not exists "estimated_pickup_minutes" integer;

alter table "public"."businesses"
  drop constraint if exists "businesses_estimated_pickup_minutes_check";

alter table "public"."businesses"
  add constraint "businesses_estimated_pickup_minutes_check"
  check ("estimated_pickup_minutes" is null or ("estimated_pickup_minutes" between 5 and 240));

comment on column "public"."businesses"."estimated_pickup_minutes" is
  'Spec 133 — piso del estimado de retiro que ve el cliente, en minutos. NULL = default del producto (40). El techo lo calcula la app: siguiente múltiplo de 30.';

comment on column "public"."businesses"."estimated_delivery_minutes" is
  'Spec 133 — piso del estimado de envío que ve el cliente, en minutos. NULL = default del producto (60). El techo lo calcula la app: siguiente múltiplo de 30.';

-- Los dos negocios vivos tenían 40 min de envío, que es el número que Juan
-- marcó como equivocado: un delivery no sale en 40 minutos. Se corrige al
-- default nuevo. Los que ya lo tenían ajustado a mano (≠ 40) no se tocan.
update "public"."businesses"
set "estimated_delivery_minutes" = 60
where "estimated_delivery_minutes" = 40;
