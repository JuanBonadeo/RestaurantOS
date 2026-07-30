-- Spec 070 · Corregir las líneas de la caja con motivo + libro de movimientos.
--
-- Hoy un cobro se escribe una vez y no se toca más: lo único que existe es
-- `anularCobro`, que deshace la orden entera (pagos, splits, mesa) para
-- arreglar un dato de una línea. En hora pico nadie hace eso, así que el dato
-- queda mal — y los tres campos que se cargan mal son los tres que rompen la
-- plata: el método (calculateExpectedCash sólo suma `cash`), el monto, y el
-- mozo atribuido (que lo deriva el server, no lo elige nadie).
--
-- Esta migración trae:
--   1. `caja_audit_log` — el rastro de toda corrección de caja, un renglón por
--      campo cambiado, sobre pagos Y movimientos.
--   2. Anulación de `caja_movimientos` (sangrías/ingresos) — antes no había
--      forma de deshacer una sangría mal cargada. Nunca se borra: se anula.
--   3. `corregir_pago_tx` / `corregir_movimiento_tx` — las correcciones son
--      atómicas (patch + recálculo de split/orden + auditoría en una sola
--      transacción con lock), mismo criterio que `registrar_pago_tx` (0007).
--
-- Guarda dura del monto (FR-012): una orden CERRADA nunca se reabre desde acá.
-- Si el monto corregido no la cubriría, la RPC levanta ORDER_WOULD_BE_UNCOVERED
-- y todo se revierte. La razón es concreta: la mesa de esa orden ya se liberó y
-- puede estar ocupada por otra cuenta — reabrir la vieja dejaría dos órdenes
-- abiertas sobre la misma mesa.
--
-- Aditiva: ninguna fila existente cambia de valor.

-- ── 1. Auditoría de caja ──────────────────────────────────────────────
create table if not exists public.caja_audit_log (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    caja_id uuid references public.cajas(id) on delete set null,
    -- 'payment' | 'movimiento'. Una sola tabla para los dos: el libro de
    -- movimientos los muestra mezclados y con dos tablas idénticas habría que
    -- unir en cada lectura para mostrar lo mismo.
    entity_type text not null,
    entity_id uuid not null,
    -- Nombre de la columna corregida ('method', 'amount_cents', ...) o
    -- 'cancelled' cuando la corrección es una anulación.
    field text not null,
    from_value text,
    to_value text,
    by_user_id uuid references public.users(id) on delete set null,
    reason text not null,
    created_at timestamptz not null default now(),
    constraint caja_audit_log_entity_type_check
      check (entity_type in ('payment', 'movimiento')),
    constraint caja_audit_log_reason_check
      check (btrim(reason) <> '')
);

comment on table public.caja_audit_log is
    'Rastro de toda corrección de una línea de caja (cobro o movimiento), un renglón por campo cambiado. Escritura sólo desde las RPC corregir_*_tx (service role). Nunca se borra una fila de caja: se corrige o se anula, y queda acá.';

create index if not exists caja_audit_log_entity_idx
    on public.caja_audit_log (entity_type, entity_id, created_at desc);

create index if not exists caja_audit_log_business_idx
    on public.caja_audit_log (business_id, created_at desc);

alter table public.caja_audit_log enable row level security;

-- Lectura: admin del negocio (o platform admin). El libro de movimientos lo
-- lee el encargado, pero por service role desde el server — nadie consulta esta
-- tabla desde el cliente. Sin policies de insert/update/delete: sólo el service
-- role escribe (bypassa RLS), que es lo que hacen las RPC de abajo.
create policy "caja_audit_log_select" on public.caja_audit_log
    for select to authenticated using (public.is_business_admin(business_id));

grant all on table public.caja_audit_log to anon, authenticated, service_role;

-- ── 2. Anulación de sangrías / ingresos ───────────────────────────────
alter table public.caja_movimientos
    add column if not exists cancelled_at timestamptz,
    add column if not exists cancelled_reason text,
    add column if not exists cancelled_by uuid references public.users(id) on delete set null;

comment on column public.caja_movimientos.cancelled_at is
    'Movimiento anulado: deja de contar para el efectivo esperado pero sigue visible en el libro. Espejo de payments.refunded_at — la caja nunca borra, marca.';

-- ── 3. Corrección atómica de un cobro ─────────────────────────────────
-- El patch viaja como jsonb para poder distinguir "no tocar este campo" (clave
-- ausente) de "ponelo en null" (clave presente con null) — con parámetros
-- nullables las dos cosas serían indistinguibles, y desatribuir el mozo es un
-- caso real (venta de caja que se había atribuido mal).
--
-- Claves aceptadas: method, amount_cents, tip_cents, attributed_mozo_id,
-- caja_id, last_four, card_brand, notes.
--
-- Las guardas de CONTEXTO (arqueo cerrado, factura emitida, rendición del mozo
-- ya cerrada, rol) viven en la server action: necesitan leer otras tablas y dar
-- mensajes con nombres propios. Acá quedan las invariantes duras, las que no
-- pueden violarse ni con un caller equivocado.
create or replace function public.corregir_pago_tx(
  p_payment_id  uuid,
  p_business_id uuid,
  p_by_user_id  uuid,
  p_reason      text,
  p_patch       jsonb
)
returns table (
  payment        jsonb,
  fully_paid     boolean,
  changed_fields text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old           payments%rowtype;
  v_new           payments%rowtype;
  v_order         orders%rowtype;
  v_new_method    text;
  v_new_amount    bigint;
  v_new_tip       bigint;
  v_new_mozo      uuid;
  v_new_caja      uuid;
  v_new_last_four text;
  v_new_brand     text;
  v_new_notes     text;
  v_split_paid    bigint;
  v_paid_sum      bigint;
  v_active_splits int;
  v_all_paid      boolean;
  v_fully_paid    boolean := false;
  v_changed       text[] := '{}';
  v_reason        text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_old from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.business_id <> p_business_id then
    raise exception 'PAYMENT_OTHER_BUSINESS' using errcode = 'P0001';
  end if;
  if v_old.payment_status <> 'paid' then
    raise exception 'PAYMENT_NOT_PAID' using errcode = 'P0001';
  end if;
  -- La plata de MP la confirmó Mercado Pago y mp_payment_id la ata a esa
  -- acreditación: ni el método ni el monto son nuestros para cambiar.
  if v_old.mp_payment_id is not null or v_old.method in ('mp_link', 'mp_qr') then
    raise exception 'PAYMENT_IS_MP' using errcode = 'P0001';
  end if;

  select * into v_order from orders where id = v_old.order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new_method := case when p_patch ? 'method'
    then p_patch->>'method' else v_old.method end;
  v_new_amount := case when p_patch ? 'amount_cents'
    then (p_patch->>'amount_cents')::bigint else v_old.amount_cents end;
  v_new_tip := case when p_patch ? 'tip_cents'
    then (p_patch->>'tip_cents')::bigint else v_old.tip_cents end;
  v_new_mozo := case when p_patch ? 'attributed_mozo_id'
    then nullif(p_patch->>'attributed_mozo_id', '')::uuid else v_old.attributed_mozo_id end;
  v_new_caja := case when p_patch ? 'caja_id'
    then (p_patch->>'caja_id')::uuid else v_old.caja_id end;
  v_new_last_four := case when p_patch ? 'last_four'
    then nullif(p_patch->>'last_four', '') else v_old.last_four end;
  v_new_brand := case when p_patch ? 'card_brand'
    then nullif(p_patch->>'card_brand', '') else v_old.card_brand end;
  v_new_notes := case when p_patch ? 'notes'
    then nullif(btrim(p_patch->>'notes'), '') else v_old.notes end;

  if v_new_method not in ('cash', 'card_manual', 'transfer', 'other') then
    raise exception 'METHOD_NOT_MANUAL' using errcode = 'P0001';
  end if;
  -- Un cobro de $0 es una anulación, y para eso está anularCobro.
  if v_new_amount <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = 'P0001';
  end if;
  -- La propina viaja DENTRO del monto (calcularRendicionMozo hace
  -- neto = amount - tip): tip > amount rompe la rendición en silencio.
  if v_new_tip < 0 or v_new_tip > v_new_amount then
    raise exception 'TIP_GT_AMOUNT' using errcode = 'P0001';
  end if;
  if v_new_caja is distinct from v_old.caja_id then
    perform 1 from cajas
      where id = v_new_caja and business_id = p_business_id and is_active;
    if not found then
      raise exception 'CAJA_INVALID' using errcode = 'P0001';
    end if;
  end if;
  if v_new_mozo is not null and v_new_mozo is distinct from v_old.attributed_mozo_id then
    perform 1 from business_users
      where user_id = v_new_mozo
        and business_id = p_business_id
        and disabled_at is null
        and role in ('mozo', 'encargado', 'admin');
    if not found then
      raise exception 'MOZO_INVALID' using errcode = 'P0001';
    end if;
  end if;

  update payments set
    method             = v_new_method,
    amount_cents       = v_new_amount,
    tip_cents          = v_new_tip,
    attributed_mozo_id = v_new_mozo,
    caja_id            = v_new_caja,
    last_four          = v_new_last_four,
    card_brand         = v_new_brand,
    notes              = v_new_notes
  where id = v_old.id
  returning * into v_new;

  -- Recálculo del split (desde los pagos, no incremental).
  if v_old.split_id is not null then
    select coalesce(sum(amount_cents), 0) into v_split_paid
      from payments
      where split_id = v_old.split_id and payment_status = 'paid';
    update order_splits set
      paid_amount_cents = v_split_paid,
      status = case
        when status = 'cancelled' then status
        when v_split_paid >= expected_amount_cents then 'paid'
        else 'pending'
      end
    where id = v_old.split_id;
  end if;

  -- ¿La orden sigue cubierta? Misma lógica que registrar_pago_tx.
  select coalesce(sum(amount_cents), 0) into v_paid_sum
    from payments
    where order_id = v_order.id and payment_status = 'paid';
  select count(*) into v_active_splits
    from order_splits
    where order_id = v_order.id and status <> 'cancelled';
  if v_active_splits = 0 then
    v_fully_paid := v_paid_sum >= v_order.total_cents and v_order.total_cents > 0;
  else
    select bool_and(paid_amount_cents >= expected_amount_cents) into v_all_paid
      from order_splits
      where order_id = v_order.id and status <> 'cancelled';
    v_fully_paid := coalesce(v_all_paid, false);
  end if;

  -- FR-012: una orden cerrada no se reabre desde la caja. El raise revierte
  -- todo lo de arriba (mismo transaction scope).
  if v_order.lifecycle_status = 'closed' and not v_fully_paid then
    raise exception 'ORDER_WOULD_BE_UNCOVERED' using errcode = 'P0001';
  end if;

  update orders set total_paid_cents = v_paid_sum where id = v_order.id;

  -- Auditoría: un renglón por campo efectivamente cambiado.
  if v_old.method is distinct from v_new.method then
    v_changed := array_append(v_changed, 'method');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'method', v_old.method, v_new.method, p_by_user_id, v_reason);
  end if;
  if v_old.amount_cents is distinct from v_new.amount_cents then
    v_changed := array_append(v_changed, 'amount_cents');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'amount_cents', v_old.amount_cents::text, v_new.amount_cents::text, p_by_user_id, v_reason);
  end if;
  if v_old.tip_cents is distinct from v_new.tip_cents then
    v_changed := array_append(v_changed, 'tip_cents');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'tip_cents', v_old.tip_cents::text, v_new.tip_cents::text, p_by_user_id, v_reason);
  end if;
  if v_old.attributed_mozo_id is distinct from v_new.attributed_mozo_id then
    v_changed := array_append(v_changed, 'attributed_mozo_id');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'attributed_mozo_id', v_old.attributed_mozo_id::text, v_new.attributed_mozo_id::text, p_by_user_id, v_reason);
  end if;
  if v_old.caja_id is distinct from v_new.caja_id then
    v_changed := array_append(v_changed, 'caja_id');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'caja_id', v_old.caja_id::text, v_new.caja_id::text, p_by_user_id, v_reason);
  end if;
  if v_old.last_four is distinct from v_new.last_four then
    v_changed := array_append(v_changed, 'last_four');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'last_four', v_old.last_four, v_new.last_four, p_by_user_id, v_reason);
  end if;
  if v_old.card_brand is distinct from v_new.card_brand then
    v_changed := array_append(v_changed, 'card_brand');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'card_brand', v_old.card_brand, v_new.card_brand, p_by_user_id, v_reason);
  end if;
  if v_old.notes is distinct from v_new.notes then
    v_changed := array_append(v_changed, 'notes');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'notes', v_old.notes, v_new.notes, p_by_user_id, v_reason);
  end if;

  if array_length(v_changed, 1) is null then
    raise exception 'NOTHING_TO_CHANGE' using errcode = 'P0001';
  end if;

  return query select to_jsonb(v_new), v_fully_paid, v_changed;
end;
$$;

-- ── 4. Corrección / anulación de un movimiento ────────────────────────
create or replace function public.corregir_movimiento_tx(
  p_movimiento_id uuid,
  p_business_id   uuid,
  p_by_user_id    uuid,
  p_reason        text,
  p_amount_cents  bigint,   -- null = no tocar el monto
  p_cancel        boolean   -- true = anular
)
returns table (
  movimiento     jsonb,
  changed_fields text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     caja_movimientos%rowtype;
  v_new     caja_movimientos%rowtype;
  v_changed text[] := '{}';
  v_reason  text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_old from caja_movimientos where id = p_movimiento_id for update;
  if not found then
    raise exception 'MOVIMIENTO_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.business_id <> p_business_id then
    raise exception 'MOVIMIENTO_OTHER_BUSINESS' using errcode = 'P0001';
  end if;
  if v_old.cancelled_at is not null then
    raise exception 'MOVIMIENTO_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if p_amount_cents is not null and p_amount_cents <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = 'P0001';
  end if;

  update caja_movimientos set
    amount_cents     = coalesce(p_amount_cents, amount_cents),
    cancelled_at     = case when p_cancel then now() else cancelled_at end,
    cancelled_reason = case when p_cancel then v_reason else cancelled_reason end,
    cancelled_by     = case when p_cancel then p_by_user_id else cancelled_by end
  where id = v_old.id
  returning * into v_new;

  if v_old.amount_cents is distinct from v_new.amount_cents then
    v_changed := array_append(v_changed, 'amount_cents');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'movimiento', v_new.id, 'amount_cents', v_old.amount_cents::text, v_new.amount_cents::text, p_by_user_id, v_reason);
  end if;
  if v_old.cancelled_at is distinct from v_new.cancelled_at then
    v_changed := array_append(v_changed, 'cancelled');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'movimiento', v_new.id, 'cancelled', 'activo', 'anulado', p_by_user_id, v_reason);
  end if;

  if array_length(v_changed, 1) is null then
    raise exception 'NOTHING_TO_CHANGE' using errcode = 'P0001';
  end if;

  return query select to_jsonb(v_new), v_changed;
end;
$$;

-- Sólo el service role ejecuta las correcciones (lección de la 0004: un
-- SECURITY DEFINER ejecutable por anon/authenticated es un agujero abierto).
revoke all on function public.corregir_pago_tx(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.corregir_pago_tx(uuid, uuid, uuid, text, jsonb)
  to service_role;

revoke all on function public.corregir_movimiento_tx(uuid, uuid, uuid, text, bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.corregir_movimiento_tx(uuid, uuid, uuid, text, bigint, boolean)
  to service_role;
