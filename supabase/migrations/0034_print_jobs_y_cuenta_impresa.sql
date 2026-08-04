-- ============================================================================
-- 0034 — Cuenta impresa para el cliente (spec 080)
--
-- Dos cosas:
--   1) `control_tickets` (spec 063) se generaliza en `print_jobs` con un `kind`.
--   2) Comandera de cuentas: por salón, con el negocio como fallback.
--
-- Por qué generalizar y no crear `cuenta_tickets` al lado: la cuenta necesita
-- exactamente la misma maquinaria que el control (fila pendiente → el agente la
-- levanta, imprime y confirma; `print_failed_at` para el fallo). Una segunda
-- tabla idéntica sería también una tercera rama del mismo `if` en el endpoint.
-- `control_tickets` tiene <1 día de vida y un puñado de filas, así que migrarla
-- es un `insert … select`.
--
-- La diferencia REAL entre los dos tipos queda expresada en el esquema y no en
-- código: el control sale UNA vez por orden (idempotencia de la marcha), la
-- cuenta se vuelve a pedir cuando la mesa agrega un café. Eso es el índice
-- único parcial de abajo.
-- ============================================================================

-- ── 1) print_jobs ───────────────────────────────────────────────────────────

create table if not exists "public"."print_jobs" (
  "id"                   uuid primary key default gen_random_uuid(),
  "business_id"          uuid not null references "public"."businesses"(id) on delete cascade,
  "order_id"             uuid not null references "public"."orders"(id) on delete cascade,
  "kind"                 text not null,
  "status"               text not null default 'pendiente',
  "emitted_at"           timestamptz not null default now(),
  "printed_at"           timestamptz,
  "print_failed_at"      timestamptz,
  "reprint_requested_at" timestamptz,
  -- Quién pidió el papel. Null en los que emite el sistema (el control lo emite
  -- `routeOrderToCocina`, que corre sin usuario en el cron y en el webhook).
  "requested_by"         uuid references "public"."users"(id) on delete set null,
  constraint "print_jobs_kind_check"   check ("kind" in ('control', 'cuenta')),
  constraint "print_jobs_status_check" check ("status" in ('pendiente', 'impreso'))
);

comment on table "public"."print_jobs" is
  'Specs 063 + 080: papeles que no son comanda de cocina. kind=control -> el que se lleva el repartidor (pedido completo, plata, destino). kind=cuenta -> el resumen que se le da a la mesa antes de pagar.';

comment on column "public"."print_jobs"."kind" is
  'control = uno por orden, lo emite la marcha a cocina. cuenta = las veces que la mesa la pida.';

-- UN control por orden: es la idempotencia de `routeOrderToCocina` (reintentos,
-- ticks solapados del cron, "marchar ahora" sobre algo ya tomado). Las cuentas
-- quedan deliberadamente fuera del único.
create unique index if not exists "print_jobs_control_uniq"
  on "public"."print_jobs" ("order_id")
  where "kind" = 'control';

-- Sirve el pull del print-agent: los pendientes de un negocio, en orden.
create index if not exists "print_jobs_pendientes_idx"
  on "public"."print_jobs" ("business_id", "emitted_at")
  where "status" = 'pendiente';

-- Sirve el chequeo de "¿ya se imprimió antes esta cuenta?" (marca REIMPRESION).
create index if not exists "print_jobs_order_kind_idx"
  on "public"."print_jobs" ("order_id", "kind");

-- ── 2) Migrar control_tickets → print_jobs y darla de baja ──────────────────

insert into "public"."print_jobs"
  (id, business_id, order_id, kind, status, emitted_at, printed_at, print_failed_at, reprint_requested_at)
select
  id, business_id, order_id, 'control', status, emitted_at, printed_at, print_failed_at, reprint_requested_at
from "public"."control_tickets"
on conflict do nothing;

drop table if exists "public"."control_tickets";

-- ── 3) RLS (misma política que tenía control_tickets) ───────────────────────
-- Lectura scopeada por membresía. Escritura: nadie por API — el ciclo entero lo
-- maneja el service client (emisión desde el server, confirmación desde el
-- endpoint del print-agent, que se autentica con su propia key).

alter table "public"."print_jobs" enable row level security;

drop policy if exists "print_jobs_select" on "public"."print_jobs";
create policy "print_jobs_select" on "public"."print_jobs"
  for select to authenticated
  using (
    exists (
      select 1 from "public"."business_users" bu
      where bu."business_id" = "print_jobs"."business_id"
        and bu."user_id" = auth.uid()
    )
  );

-- ── 4) Comandera de cuentas: negocio (fallback) + salón (override) ──────────

alter table "public"."businesses"
  add column if not exists "cuenta_printer_ip" text;
alter table "public"."businesses"
  add column if not exists "cuenta_printer_port" int not null default 9100;
alter table "public"."businesses"
  add column if not exists "cuenta_printer_enabled" boolean not null default true;

comment on column "public"."businesses"."cuenta_printer_ip" is
  'Spec 080: comandera donde sale la cuenta que se le da al cliente. Es el DEFAULT del local; un salon puede pisarla con la suya (floor_plans.cuenta_printer_ip). NULL o vacia = el negocio no imprime cuentas.';

alter table "public"."floor_plans"
  add column if not exists "cuenta_printer_ip" text;
alter table "public"."floor_plans"
  add column if not exists "cuenta_printer_port" int not null default 9100;
alter table "public"."floor_plans"
  add column if not exists "cuenta_printer_enabled" boolean not null default true;

comment on column "public"."floor_plans"."cuenta_printer_ip" is
  'Spec 080: comandera de cuentas propia del salon. NULL = hereda la del negocio. Sirve para el local con terraza y salon interno, que quiere el papel cerca de cada uno.';

comment on column "public"."floor_plans"."cuenta_printer_enabled" is
  'Spec 080: apagar la impresion de cuentas de ESTE salon. El off explicito gana: no cae al fallback del negocio.';
