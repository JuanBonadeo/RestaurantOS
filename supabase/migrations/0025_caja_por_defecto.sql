-- ============================================================================
-- 0025 — Caja por defecto por negocio
--
-- El pago online de un delivery / take-away lo acredita el webhook de MP: no
-- hay cajero eligiendo dónde se asienta, pero `payments.caja_id` es NOT NULL.
-- Esta columna define a qué caja va esa plata.
--
-- Unique parcial: como mucho UNA caja por defecto por negocio. Si no hay
-- ninguna marcada, el código cae en la primera caja activa por `sort_order`
-- (ver `getDefaultCaja`), así que ningún negocio queda sin destino.
-- ============================================================================

alter table "public"."cajas"
  add column if not exists "is_default" boolean not null default false;

create unique index if not exists "cajas_one_default_per_business"
  on "public"."cajas" ("business_id")
  where "is_default";

comment on column "public"."cajas"."is_default" is
  'Caja donde se asientan los cobros sin cajero (pago online de delivery/takeaway). Máx 1 por negocio.';
