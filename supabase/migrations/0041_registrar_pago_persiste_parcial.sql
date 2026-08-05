-- Spec 094 · H-07 — `registrar_pago_tx` persiste el progreso del cobro parcial.
--
-- Sólo cambia el cuerpo de la función: se agrega el UPDATE de
-- `orders.total_paid_cents` antes del return, con el valor que la propia RPC ya
-- venía calculando para decidir `fully_paid`. Todo lo demás queda igual (la
-- idempotencia por `request_id`, el lock de la orden, los guards).
--
-- El `revoke`/`grant` de 0007 sobrevive a un `create or replace`, así que no
-- hace falta repetirlo.

create or replace function "public"."registrar_pago_tx"(
  p_order_id           uuid,
  p_business_id        uuid,
  p_split_id           uuid,
  p_caja_id            uuid,
  p_operated_by        uuid,
  p_attributed_mozo_id uuid,
  p_method             text,
  p_amount_cents       bigint,
  p_tip_cents          bigint,
  p_last_four          text,
  p_card_brand         text,
  p_notes              text,
  p_adjustment_percent numeric,
  p_adjustment_cents   bigint,
  p_request_id         uuid
)
returns table (
  payment     jsonb,
  split_done  boolean,
  fully_paid  boolean,
  idempotent  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order         orders%rowtype;
  v_split         order_splits%rowtype;
  v_existing      payments%rowtype;
  v_payment       payments%rowtype;
  v_new_paid      bigint;
  v_split_done    boolean := false;
  v_fully_paid    boolean := false;
  v_paid_sum      bigint;
  v_active_splits int;
  v_all_paid      boolean;
begin
  -- Lock de la orden: serializa cobros concurrentes sobre la misma orden.
  select * into v_order
    from orders
    where id = p_order_id and business_id = p_business_id
    for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.lifecycle_status <> 'open' then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
  end if;

  -- Idempotencia: si ya existe un pago con este request_id, devolverlo sin
  -- insertar. El chequeo va bajo el lock de la orden, así que no puede
  -- interleavearse con un insert concurrente del mismo request_id.
  if p_request_id is not null then
    select * into v_existing
      from payments
      where business_id = p_business_id and request_id = p_request_id
      limit 1;
    if found then
      return query
        select to_jsonb(v_existing),
               coalesce((select s.status = 'paid' from order_splits s
                          where s.id = v_existing.split_id), false),
               false,
               true;
      return;
    end if;
  end if;

  -- Split (si aplica): lock + guardas anti-duplicado.
  if p_split_id is not null then
    select * into v_split
      from order_splits
      where id = p_split_id and business_id = p_business_id
      for update;
    if not found then
      raise exception 'SPLIT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_split.order_id <> p_order_id then
      raise exception 'SPLIT_ORDER_MISMATCH' using errcode = 'P0001';
    end if;
    if v_split.status = 'cancelled' then
      raise exception 'SPLIT_CANCELLED' using errcode = 'P0001';
    end if;
    -- Anti-duplicado: un split ya saldado no acepta más pagos.
    if v_split.paid_amount_cents >= v_split.expected_amount_cents then
      raise exception 'SPLIT_ALREADY_PAID' using errcode = 'P0001';
    end if;
  else
    -- Sin split: rechazar si la orden ya está cubierta por pagos 'paid'.
    select coalesce(sum(amount_cents), 0) into v_paid_sum
      from payments
      where order_id = p_order_id and payment_status = 'paid';
    if v_order.total_cents > 0 and v_paid_sum >= v_order.total_cents then
      raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
    end if;
  end if;

  -- Insert del pago. En este path el pago siempre entra 'paid'
  -- (cash / card_manual / transfer / other). MP va por otra acción.
  insert into payments (
    order_id, business_id, split_id, caja_id, operated_by, attributed_mozo_id,
    method, amount_cents, tip_cents, last_four, card_brand, payment_status,
    notes, adjustment_percent, adjustment_cents, request_id
  ) values (
    p_order_id, p_business_id, p_split_id, p_caja_id, p_operated_by, p_attributed_mozo_id,
    p_method, p_amount_cents, p_tip_cents, p_last_four, p_card_brand, 'paid',
    p_notes, coalesce(p_adjustment_percent, 0), coalesce(p_adjustment_cents, 0), p_request_id
  )
  returning * into v_payment;

  -- Update del split saldado.
  if p_split_id is not null then
    v_new_paid   := v_split.paid_amount_cents + p_amount_cents;
    v_split_done := v_new_paid >= v_split.expected_amount_cents;
    update order_splits
      set paid_amount_cents = v_new_paid,
          status = case when v_split_done then 'paid' else 'pending' end
      where id = p_split_id;
  end if;

  -- ¿Orden completamente paga? (misma lógica que closeOrderIfFullyPaid:
  -- el cierre + liberación de mesa lo hace el caller en TS, guardado por
  -- lifecycle_status, para no duplicar esa lógica en SQL.)
  select coalesce(sum(amount_cents), 0) into v_paid_sum
    from payments
    where order_id = p_order_id and payment_status = 'paid';
  select count(*) into v_active_splits
    from order_splits
    where order_id = p_order_id and status <> 'cancelled';
  if v_active_splits = 0 then
    v_fully_paid := v_paid_sum >= v_order.total_cents and v_order.total_cents > 0;
  else
    select bool_and(paid_amount_cents >= expected_amount_cents) into v_all_paid
      from order_splits
      where order_id = p_order_id and status <> 'cancelled';
    v_fully_paid := coalesce(v_all_paid, false);
  end if;

  -- spec 094 · H-07 — el progreso del cobro parcial se persiste.
  --
  -- Esta RPC insertaba el pago, actualizaba el split y calculaba `fully_paid`,
  -- y nada más: `orders.total_paid_cents` sólo lo escribía
  -- `closeOrderIfFullyPaid`, o sea **al cerrar**. En un parcial sin split
  -- (tarjeta / transferencia / MP) el avance no quedaba en ningún lado
  -- consultable, y la pantalla lo sostenía sólo en memoria.
  --
  -- Lo que se veía: cuenta de $20.000, el cliente paga $12.000 con tarjeta, la
  -- pantalla dice «Falta $8.000». El mozo cambia de pantalla y vuelve: dice
  -- «Falta $20.000», barra en 0%. Cobra $20.000 más → $32.000 en caja. Y sin
  -- recargar nada: al querer cobrar los $8.000 restantes en efectivo el server
  -- responde «no se puede cobrar menos de lo que falta ($20.000)» — la pantalla
  -- dice 8.000 y el sistema exige 20.000, en hora pico.
  --
  -- El valor ya estaba calculado unas líneas más arriba. Es lo que las tres RPC
  -- de corrección (0031, 0032, 0033) ya hacían: la convención existía, faltaba
  -- acá.
  update orders set total_paid_cents = v_paid_sum where id = p_order_id;

  return query select to_jsonb(v_payment), v_split_done, v_fully_paid, false;
end;
$$;
