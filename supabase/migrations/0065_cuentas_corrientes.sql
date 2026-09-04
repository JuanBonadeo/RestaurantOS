-- 0065 · Cuentas corrientes (spec 141)
--
-- El fiado es una FORMA DE COBRO, no una cuenta abierta (D1): el ticket se cierra
-- en el momento, la mesa se libera y la factura sale igual. Lo que queda vivo es
-- el saldo del cliente.
--
-- El saldo se DERIVA, no se lleva en un libro paralelo (D4):
--   saldo = Σ payments(method='cuenta_corriente', credit_customer_id=X, vivos)
--         − Σ customer_credit_settlements(customer_id=X, vivas)
-- Un libro aparte obligaría a mantener dos filas en sync en cada anulación y en
-- cada corrección de monto (spec 070), y la única forma de que un saldo mienta es
-- que tenga dos fuentes.

-- ── 1 · el método nuevo ─────────────────────────────────────────────────────
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method = any (array['cash','card_manual','mp_link','mp_qr',
                             'transfer','other','cuenta_corriente']));

-- ── 2 · a quién se le fió ───────────────────────────────────────────────────
alter table public.payments
  add column if not exists credit_customer_id uuid references public.customers(id);

-- ESTE check es el que hace que el saldo no pueda mentir: no existe un fiado sin
-- dueño ni un cobro normal con dueño. Sin él, un `method` mal seteado deja plata
-- fuera del saldo de alguien y nadie se entera hasta que el cliente reclama.
alter table public.payments drop constraint if exists payments_credit_customer_coherente;
alter table public.payments add constraint payments_credit_customer_coherente
  check ((method = 'cuenta_corriente') = (credit_customer_id is not null));

create index if not exists payments_credit_customer_idx
  on public.payments (credit_customer_id, created_at desc)
  where credit_customer_id is not null;

-- ── 3 · quién puede fiar (D2: sin tope, el control es el gate + el saldo) ───
alter table public.customers
  add column if not exists credit_enabled boolean not null default false;

-- ── 4 · la cobranza del saldo ───────────────────────────────────────────────
create table if not exists public.customer_credit_settlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- RESTRICT y no CASCADE: borrar un cliente con cobranzas registradas borraría
  -- el rastro de plata que entró al cajón. Que falle y se resuelva a mano.
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('cash','transfer','card_manual','other')),
  caja_id uuid references public.cajas(id),
  caja_movimiento_id uuid references public.caja_movimientos(id),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- Nunca se borra: se anula con motivo, como un movimiento de caja (spec 070).
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_reason text
);

create index if not exists ccs_business_customer_idx
  on public.customer_credit_settlements (business_id, customer_id, created_at desc);

alter table public.customer_credit_settlements enable row level security;

drop policy if exists ccs_select on public.customer_credit_settlements;
create policy ccs_select on public.customer_credit_settlements
  for select to authenticated
  using (is_business_member(business_id) or is_platform_admin());

-- ── 5 · la RPC de pagos aprende a fiar ──────────────────────────────────────
--
-- `registrar_pago_tx` es la única puerta transaccional del pago (lock de la
-- orden, anti-duplicado, idempotencia por request_id). El fiado tiene que entrar
-- POR ACÁ y no por un INSERT paralelo, o pierde las tres cosas — y encima el
-- check de coherencia de arriba lo rechazaría.
--
-- Se reescribe preservando el cuerpo actual y agregando la columna al INSERT:
-- traer 4 KB de PL/pgSQL a mano para retipearlo es cómo se pierde una línea.
-- El replace se VERIFICA antes de tocar nada; si el texto no matchea, aborta y
-- la función vieja sigue intacta (todo esto corre en una transacción).
do $$
declare
  v_src   text;
  v_nuevo text;
  v_viejo_insert constant text :=
    'notes, adjustment_percent, adjustment_cents, request_id' || E'\n' ||
    '  ) values (';
  v_nuevo_insert constant text :=
    'notes, adjustment_percent, adjustment_cents, request_id, credit_customer_id' || E'\n' ||
    '  ) values (';
  v_viejo_values constant text :=
    'p_notes, coalesce(p_adjustment_percent, 0), coalesce(p_adjustment_cents, 0), p_request_id';
  v_nuevo_values constant text :=
    'p_notes, coalesce(p_adjustment_percent, 0), coalesce(p_adjustment_cents, 0), p_request_id, p_credit_customer_id';
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'registrar_pago_tx';
  if v_src is null then
    raise exception 'ABORTA: no encontré registrar_pago_tx';
  end if;

  if position(v_viejo_insert in v_src) = 0 or position(v_viejo_values in v_src) = 0 then
    raise exception 'ABORTA: el INSERT de registrar_pago_tx cambió — revisar a mano antes de tocar la plata';
  end if;

  v_nuevo := replace(v_src, v_viejo_insert, v_nuevo_insert);
  v_nuevo := replace(v_nuevo, v_viejo_values, v_nuevo_values);
  if v_nuevo = v_src then
    raise exception 'ABORTA: el replace no cambió nada';
  end if;

  drop function if exists public.registrar_pago_tx(
    uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
    text, text, text, numeric, bigint, uuid);

  execute format($f$
    create function public.registrar_pago_tx(
      p_order_id uuid, p_business_id uuid, p_split_id uuid, p_caja_id uuid,
      p_operated_by uuid, p_attributed_mozo_id uuid, p_method text,
      p_amount_cents bigint, p_tip_cents bigint, p_last_four text,
      p_card_brand text, p_notes text, p_adjustment_percent numeric,
      p_adjustment_cents bigint, p_request_id uuid,
      p_credit_customer_id uuid default null
    )
    returns table(payment jsonb, split_done boolean, fully_paid boolean, idempotent boolean)
    language plpgsql
    security definer
    set search_path = public
    as %L
  $f$, v_nuevo);
end $$;

-- El DROP+CREATE PIERDE LOS GRANTS. La original sólo la podían ejecutar
-- `service_role` y `postgres`; sin restaurarlo, la app deja de poder cobrar —
-- todas las server actions van por el service client. Se replica tal cual, y se
-- revoca al resto explícitamente por si el default de la base los incluyera.
revoke all on function public.registrar_pago_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
  text, text, text, numeric, bigint, uuid, uuid) from public, anon, authenticated;
grant execute on function public.registrar_pago_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
  text, text, text, numeric, bigint, uuid, uuid) to service_role;

comment on column public.payments.credit_customer_id is
  'Cliente al que se le fió. NOT NULL sii method = cuenta_corriente (spec 141 · D4).';
comment on column public.customers.credit_enabled is
  'Habilitado para fiar. Sin tope: el control es el gate de rol + el saldo a la vista (spec 141 · D2).';
comment on table public.customer_credit_settlements is
  'Cobranzas del saldo de una cuenta corriente. El saldo se deriva de payments − esto (spec 141 · D4).';
