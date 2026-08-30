-- Spec 130 · Cerrar caja: un botón que registra el corte, retira el efectivo y
-- deja el salón en cero — todo en una transacción.
--
-- Hoy cerrar el día son tres pasos sueltos: rendir mozos, **sangría manual
-- escribiendo el total del cajón a mano**, y «hacer corte» contando lo que
-- quedó (que después de la sangría es $0). El del medio es el encargado
-- tipeando la plata entera del día en un campo libre, a la 1 de la mañana.
--
-- Acá el retiro deja de ser un número tipeado: es una sangría que escribe el
-- sistema por el monto contado, dentro de la misma transacción que el corte.
--
-- Tres decisiones que están en el SQL y conviene no perder:
--
--   D3 · El retiro es una sangría de verdad, no una columna `retiro_cents` en
--        `caja_cortes`. Así queda como una línea del libro (spec 070):
--        visible, auditable, corregible y anulable con lo que ya existe, y
--        `calculateExpectedCash` no se toca — el período nuevo arranca con
--        apertura = lo contado y una sangría por el mismo monto, o sea $0.
--
--   ⚠️ El `+ 1 millisecond` NO es cosmético. El período se calcula con
--        `created_at > ultimo_corte.created_at` (estricto), y adentro de una
--        transacción `now()` es constante: una sangría con el mismo timestamp
--        que el corte no cae en el período nuevo **ni** en el viejo, y el
--        retiro se evapora — la plata desaparece del libro sin que nadie la
--        haya sacado.
--
--   D4 · Corte + retiro + salón van juntos o no va ninguno. Un corte sin su
--        retiro deja al sistema esperando plata que ya no está en el cajón.
--
--   D7/D9 · Sólo la caja principal barre el salón, y sólo ella bloquea por
--        cuentas abiertas. El cierre del bar puede pasar en plena cena: no
--        tiene por qué liberar mesas ni esperar a que se cobre la 12.
--
-- Aditiva: no cambia ninguna fila existente ni ninguna función previa.

create or replace function public.cerrar_caja_tx(
  p_caja_id            uuid,
  p_business_id        uuid,
  p_encargado_id       uuid,
  p_expected_cash_cents bigint,
  p_closing_cash_cents  bigint,
  p_closing_notes      text,
  p_denomination_count jsonb,
  p_retirar            boolean,
  p_barrer_salon       boolean
)
returns table (
  corte            jsonb,
  retiro_id        uuid,
  mesas_liberadas  integer,
  mozos_limpiados  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja            cajas%rowtype;
  v_corte           caja_cortes%rowtype;
  v_retiro_id       uuid := null;
  v_mesas           integer := 0;
  v_mozos           integer := 0;
  v_abiertas        integer := 0;
  v_plan_ids        uuid[];
begin
  select * into v_caja from cajas where id = p_caja_id for update;
  if not found then
    raise exception 'CAJA_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Multi-tenant estricto: la caja de otro negocio no se cierra ni con el id
  -- correcto en la mano.
  if v_caja.business_id <> p_business_id then
    raise exception 'CAJA_WRONG_BUSINESS' using errcode = 'P0001';
  end if;
  if not v_caja.is_active then
    raise exception 'CAJA_INACTIVE' using errcode = 'P0001';
  end if;
  if p_closing_cash_cents < 0 then
    raise exception 'CLOSING_CASH_NEGATIVE' using errcode = 'P0001';
  end if;

  -- Las mesas del negocio se alcanzan por `floor_plans`: `tables` no tiene
  -- `business_id`.
  select coalesce(array_agg(id), '{}'::uuid[]) into v_plan_ids
    from floor_plans where business_id = p_business_id;

  -- D7 · Cerrar con una cuenta abierta es cerrar el día con plata sin cobrar.
  -- La guarda vive también acá (y no sólo en la server action) por la carrera:
  -- entre que el modal lista las mesas y el encargado aprieta, un mozo puede
  -- abrir la 14. Los pedidos de delivery / take away NO bloquean: el
  -- repartidor puede estar en la calle y ese cobro cae en el período nuevo,
  -- que es lo correcto.
  if p_barrer_salon then
    select count(*) into v_abiertas
      from orders
      where business_id = p_business_id
        and lifecycle_status = 'open'
        and table_id is not null;
    if v_abiertas > 0 then
      raise exception 'OPEN_TABLE_ORDERS:%', v_abiertas using errcode = 'P0001';
    end if;
  end if;

  insert into caja_cortes (
    caja_id, business_id, encargado_id,
    expected_cash_cents, closing_cash_cents, difference_cents,
    closing_notes, denomination_count
  ) values (
    p_caja_id, p_business_id, p_encargado_id,
    p_expected_cash_cents, p_closing_cash_cents,
    p_closing_cash_cents - p_expected_cash_cents,
    nullif(btrim(coalesce(p_closing_notes, '')), ''), p_denomination_count
  )
  returning * into v_corte;

  -- D2 · Se retira todo o nada. El monto es lo **contado**, no lo esperado:
  -- se saca del cajón lo que hay adentro, no lo que debería haber.
  if p_retirar and p_closing_cash_cents > 0 then
    insert into caja_movimientos (
      caja_id, business_id, kind, amount_cents, reason, created_by, created_at
    ) values (
      p_caja_id, p_business_id, 'sangria', p_closing_cash_cents,
      'Retiro del cierre de caja', p_encargado_id,
      v_corte.created_at + interval '1 millisecond'
    )
    returning id into v_retiro_id;
  end if;

  -- D8 · El cierre deja el salón en cero. Sin cuentas abiertas (ya se
  -- verificó), lo que queda son mesas zombi: `ocupada` / `pidio_cuenta` sin
  -- orden viva, que arrancarían el día siguiente ocupadas por nadie.
  if p_barrer_salon and coalesce(array_length(v_plan_ids, 1), 0) > 0 then
    -- El estado previo se lee en su propia CTE porque el `returning` de un
    -- UPDATE devuelve la fila **nueva**: sin esto el audit diría que la mesa
    -- pasó de 'libre' a 'libre' y no quedaría rastro de qué se barrió.
    with previas as (
      select id, operational_status
        from tables
       where floor_plan_id = any(v_plan_ids)
         and operational_status <> 'libre'
       for update
    ), liberadas as (
      update tables t set
        operational_status = 'libre',
        opened_at = null,
        current_order_id = null
      from previas p
      where t.id = p.id
      returning t.id, p.operational_status as desde
    ), auditadas as (
      insert into tables_audit_log (
        table_id, business_id, kind, from_value, to_value, by_user_id, reason
      )
      select id, p_business_id, 'status', desde, 'libre', p_encargado_id,
             'Cierre de caja'
        from liberadas
      returning 1
    )
    select count(*) into v_mesas from auditadas;

    -- La distribución de mozos también se limpia: si no, la asignación es fija
    -- y el turno que viene arranca pegada la de ayer.
    with previas as (
      select id, mozo_id
        from tables
       where floor_plan_id = any(v_plan_ids)
         and mozo_id is not null
       for update
    ), limpiadas as (
      update tables t set mozo_id = null
      from previas p
      where t.id = p.id
      returning t.id, p.mozo_id as desde
    ), auditadas as (
      insert into tables_audit_log (
        table_id, business_id, kind, from_value, to_value, by_user_id, reason
      )
      select id, p_business_id, 'assignment', desde::text, null,
             p_encargado_id, 'Cierre de caja'
        from limpiadas
      returning 1
    )
    select count(*) into v_mozos from auditadas;
  end if;

  return query select to_jsonb(v_corte), v_retiro_id, v_mesas, v_mozos;
end;
$$;

comment on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean) is
  'Spec 130 — cierre de caja atómico: corte + sangría del retiro (+1 ms, para que caiga en el período nuevo) + salón liberado + distribución de mozos limpia. Sólo service_role: las guardas de rol y el techo de diferencia viven en la server action.';

revoke all on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean)
  to service_role;
