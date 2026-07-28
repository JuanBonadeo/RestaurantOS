-- 0022_reservations_modo_flexible.sql — Spec 059
-- Modo de reservas por negocio: `estricto` (modelo actual) | `flexible` (libro de reservas).
-- ADITIVA y retrocompatible: default 'estricto' → cero cambio de comportamiento para los
-- negocios existentes (golf-jcr incluido). No toca el motor estricto.
--
-- NOTA: pendiente de aplicar al cloud vía MCP (`apply_migration`) junto con el wiring de
-- booking/queries. Ver specs/059-reservas-modo-flexible/plan.md.

-- ── 1) Modo de reservas por negocio (en reservation_settings; hereda su RLS) ──
alter table public.reservation_settings
  add column if not exists mode text not null default 'estricto';

alter table public.reservation_settings
  drop constraint if exists reservation_settings_mode_check;
alter table public.reservation_settings
  add constraint reservation_settings_mode_check check (mode in ('estricto', 'flexible'));

comment on column public.reservation_settings.mode is
  'Spec 059: estrategia de reservas. estricto = slots + pickTable + GIST (actual). flexible = libro de reservas (mesa opcional, una por mesa/servicio, la hora ancla el bloqueo, capacidad blanda).';

-- ── 2) Servicio + zona en la reserva (modo flexible). Nullable → no toca estricto ──
alter table public.reservations
  add column if not exists service text;
alter table public.reservations
  add column if not exists floor_plan_id uuid references public.floor_plans(id) on delete set null;

comment on column public.reservations.service is
  'Spec 059 (flexible): servicio (mediodia/cena/…) al que pertenece la reserva. NULL en modo estricto.';
comment on column public.reservations.floor_plan_id is
  'Spec 059 (flexible): zona/salón de una reserva genérica (sin mesa). Las con-mesa derivan la zona de la mesa.';

-- ── 3) Servicios configurables por negocio (modo flexible) + cupo blando (advisory) ──
create table if not exists public.reservation_services (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,                 -- 'Mediodía' | 'Cena' | …
  day_of_week   int  check (day_of_week is null or day_of_week between 0 and 6),  -- NULL = todos los días
  opens_at      time not null,
  closes_at     time not null,                 -- si <= opens_at, cruza medianoche (cena 20:00→00:30)
  soft_capacity int  check (soft_capacity is null or soft_capacity > 0),          -- umbral advisory (no bloquea)
  floor_plan_id uuid references public.floor_plans(id) on delete cascade,         -- NULL = cupo del servicio entero
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.reservation_services is
  'Spec 059: servicios del negocio en modo flexible (Mediodía/Cena…) con ventana de atención y cupo blando (advisory, no bloquea). Reemplaza schedule.slots del modo estricto.';

create index if not exists reservation_services_business_idx
  on public.reservation_services (business_id);

alter table public.reservation_services enable row level security;

-- SELECT: público como reservation_settings — el flujo de reserva (web/chatbot) necesita los horarios.
drop policy if exists reservation_services_select on public.reservation_services;
create policy reservation_services_select on public.reservation_services
  for select to authenticated, anon
  using (true);

-- WRITE: manager (admin/encargado) — matchea canConfigureReservations. Check inline como spec 19.
drop policy if exists reservation_services_write on public.reservation_services;
create policy reservation_services_write on public.reservation_services
  for all to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = reservation_services.business_id
        and bu.user_id = auth.uid()
        and bu.role in ('admin', 'encargado')
        and bu.disabled_at is null
    ) or public.is_platform_admin()
  )
  with check (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = reservation_services.business_id
        and bu.user_id = auth.uid()
        and bu.role in ('admin', 'encargado')
        and bu.disabled_at is null
    ) or public.is_platform_admin()
  );

grant select, insert, update, delete on public.reservation_services to authenticated;
grant select on public.reservation_services to anon;
