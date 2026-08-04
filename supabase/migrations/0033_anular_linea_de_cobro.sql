-- Spec 070 · Anular UNA línea de cobro desde el libro de movimientos.
--
-- Pedido de Juan (2026-08-03): poder sacar una línea de la caja directamente.
-- No se borra: se **anula**. Una fila borrada deja el arqueo sin explicación
-- (la plata cambia y no hay rastro de por qué) y rompe el principio del
-- producto — "todo peso que entra se registra y se puede auditar". Anulada, la
-- línea deja de sumar pero sigue visible, tachada, con motivo y responsable.
--
-- Ya existía `anularCobro`, pero anula **todos** los pagos de la orden, la
-- reabre y devuelve la mesa a `pidio_cuenta`: sirve cuando se deshace el cobro
-- entero, no cuando de tres pagos hay uno que no existió.
--
-- Qué le pasa a la cuenta: NO se reabre (misma regla que la corrección de
-- monto — la mesa ya se liberó y puede estar ocupada por otra cuenta). La orden
-- queda cerrada y su `payment_status` vuelve a `pending` si los pagos que
-- quedan no la cubren: cerrada e impaga es exactamente lo que pasó, y así el
-- board de pedidos la muestra en el filtro de impagos en vez de esconderla.

create or replace function public.anular_pago_tx(
  p_payment_id  uuid,
  p_business_id uuid,
  p_by_user_id  uuid,
  p_reason      text
)
returns table (
  payment    jsonb,
  fully_paid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old           payments%rowtype;
  v_new           payments%rowtype;
  v_order         orders%rowtype;
  v_split_paid    bigint;
  v_paid_sum      bigint;
  v_active_splits int;
  v_all_paid      boolean;
  v_fully_paid    boolean := false;
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
  -- La plata de MP la devuelve MP: anularla acá dejaría la caja diciendo una
  -- cosa y la cuenta de Mercado Pago otra.
  if v_old.mp_payment_id is not null or v_old.method in ('mp_link', 'mp_qr') then
    raise exception 'PAYMENT_IS_MP' using errcode = 'P0001';
  end if;

  select * into v_order from orders where id = v_old.order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  update payments set
    payment_status  = 'refunded',
    refunded_at     = now(),
    refunded_reason = v_reason
  where id = v_old.id
  returning * into v_new;

  -- El split del pago se recalcula desde los pagos que quedan vivos.
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

  -- `lifecycle_status` NO se toca (la mesa ya siguió su vida). Sí la verdad de
  -- si está paga: una cuenta a la que le sacaron un cobro no está paga.
  update orders set
    total_paid_cents = v_paid_sum,
    payment_status = case when v_fully_paid then payment_status else 'pending' end
  where id = v_order.id;

  insert into caja_audit_log (
    business_id, caja_id, entity_type, entity_id, field,
    from_value, to_value, by_user_id, reason
  ) values (
    p_business_id, v_new.caja_id, 'payment', v_new.id, 'cancelled',
    'activo', 'anulado', p_by_user_id, v_reason
  );

  return query select to_jsonb(v_new), v_fully_paid;
end;
$$;

revoke all on function public.anular_pago_tx(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.anular_pago_tx(uuid, uuid, uuid, text)
  to service_role;
