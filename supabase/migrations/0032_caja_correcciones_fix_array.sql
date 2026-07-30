-- Spec 070 · Fix de `corregir_pago_tx` / `corregir_movimiento_tx`.
--
-- `v_changed := v_changed || 'method'` parecía "agregar un elemento al array" y
-- no lo es: con `text[] || unknown`, Postgres resuelve el literal como ARRAY y
-- explota con «malformed array literal». Toda corrección fallaba en la primera
-- línea de auditoría — o sea, la RPC no funcionaba en ningún caso.
--
-- Lo encontró una prueba de la RPC contra la base real dentro de una
-- transacción que se revierte: el typecheck de TS no ve adentro del plpgsql.
--
-- Va como migración aparte porque la 0031 ya estaba aplicada al cloud. El
-- archivo de la 0031 quedó corregido para que una base nueva salga bien de
-- entrada (las funciones son `create or replace`, así que aplicar las dos en
-- orden deja exactamente el mismo resultado).

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
