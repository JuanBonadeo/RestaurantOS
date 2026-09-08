-- ────────────────────────────────────────────────────────────────────────
-- 0080 — el encargado no rinde
--
-- Decisión de operación: en este local la caja la manejan los encargados, así
-- que su efectivo entra derecho al cajón y no tienen nada que entregar. Antes
-- se los excluía sólo si alguien se acordaba de asignarlos como operadores de
-- la caja (`caja_user_assignments`, D3); ahora es por rol.
--
-- El síntoma que lo destapó era la pantalla: la tab «Rendición» los listaba
-- todas las noches **con los botones «Rindió» y «No entregó» disponibles**, y
-- tomarle una rendición a alguien cuyo efectivo ya está en el cajón deja una
-- diferencia negativa por todo lo que cobró, más un aviso de faltante al dueño.
--
-- Esta migración es la tercera capa del mismo cambio (la tab y la server action
-- van en TS, por `mozosQueDebenRendir`). Tiene que estar: si sólo se arreglara
-- la pantalla, el cierre seguiría bloqueando por alguien que la pantalla ya no
-- muestra, que es peor que el bug original.
--
-- Lo que se pierde a cambio, dicho para que esté dicho: un encargado que cobra
-- en el salón y se guarda el efectivo ya no queda trackeado por esta vía. Su
-- plata queda contada como que está EN el cajón, así que si no está aparece
-- como faltante del arqueo.
--
-- Hallazgo: issue #264 · caso de uso: wiki/qa/procesos/P11-rendir-el-turno.md
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cerrar_caja_tx(p_caja_id uuid, p_business_id uuid, p_encargado_id uuid, p_expected_cash_cents bigint, p_closing_cash_cents bigint, p_closing_notes text, p_denomination_count jsonb, p_retirar boolean, p_barrer_salon boolean, p_resumen jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(corte jsonb, retiro_id uuid, mesas_liberadas integer, mozos_limpiados integer, print_job_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caja            cajas%rowtype;
  v_corte           caja_cortes%rowtype;
  v_retiro_id       uuid := null;
  v_print_job_id    uuid := null;
  v_mesas           integer := 0;
  v_mozos           integer := 0;
  v_abiertas        integer := 0;
  v_sin_rendir      integer := 0;
  v_plan_ids        uuid[];
  v_numero          integer;
begin
  -- spec 160 · la caja administrativa no se arquea. La guarda vive acá y no en
  -- la UI porque resolveCierrePrinter no mira `cajas`: un cierre que llegue por
  -- cualquier otro camino imprimiría el ticket igual.
  if exists (select 1 from public.cajas
             where id = p_caja_id and is_administrative) then
    raise exception 'CAJA_ADMINISTRATIVA_NO_SE_ARQUEA';
  end if;
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

  -- D14 · El correlativo se toma con el lock del negocio ya puesto por la fila
  -- de la caja. Dos cierres simultáneos de dos cajas distintas del mismo local
  -- podrían pedir el mismo número, así que además está el único parcial: el
  -- segundo revienta y reintenta, en vez de quedar duplicado en el papel.
  select coalesce(max(numero), 0) + 1 into v_numero
    from caja_cortes
    where business_id = p_business_id;


  -- Spec 139 · D1/D5 — el día no se cierra dejando a un mozo sin resolver.
  --
  -- REPUESTA (issue #264). La metió la 0056 acá a propósito —«y no sólo en la
  -- server action por la misma carrera que las cuentas abiertas: entre que el
  -- modal lista y el encargado aprieta, un mozo puede cobrar la 14»— y la 0063
  -- la borró sin querer, al hacer `create or replace` de la función entera para
  -- otra cosa. `OPEN_TABLE_ORDERS`, que estaba al lado, sobrevivió: no fue un
  -- cambio de criterio, se perdió al reescribir. Desde entonces la única
  -- defensa era el chequeo en TS, que es justo el que la carrera saltea.
  --
  -- «Resolver» no es «entregar»: la rendición puede registrarse como
  -- `no_entrego` con motivo, y eso alcanza para pasar. Lo que no se puede es
  -- ignorar a alguien que cobró.
  --
  -- Debe rendir el que cobró (D4: cualquier método, no sólo efectivo) y que no
  -- sea operador de ESTA caja (D3: el que está parado en la caja cobra directo
  -- al cajón, su plata ya está adentro).
  --
  -- El período de cada mozo es el suyo, desde su última rendición — no el de la
  -- caja: es la misma cuenta que hace `getRendicionPendienteMozo`.
  if p_barrer_salon then
    select count(*) into v_sin_rendir
      from (
        select p.attributed_mozo_id as mozo_id, max(p.created_at) as ultimo_pago
          from payments p
         where p.business_id = p_business_id
           and p.payment_status = 'paid'
           and p.attributed_mozo_id is not null
         group by p.attributed_mozo_id
      ) cobros
     where not exists (
             select 1
               from caja_user_assignments a
              where a.business_id = p_business_id
                and a.caja_id     = p_caja_id
                and a.user_id     = cobros.mozo_id
           )
       -- issue #264 · el encargado tampoco rinde. Misma razón que D3 y sin
       -- depender de que alguien lo asigne como operador: en este local la caja
       -- la manejan los encargados, así que su efectivo entra derecho al cajón.
       -- Va acá además de en la server action porque si sólo se arreglara la
       -- pantalla, el cierre bloquearía por alguien que la pantalla ya no
       -- muestra — peor que el bug original.
       and not exists (
             select 1
               from business_users bu
              where bu.business_id = p_business_id
                and bu.user_id     = cobros.mozo_id
                and bu.role in ('admin', 'encargado')
           )
       and cobros.ultimo_pago > coalesce(
             (select max(r.created_at)
                from mozo_rendiciones r
               where r.business_id = p_business_id
                 and r.mozo_id     = cobros.mozo_id),
             '-infinity'::timestamptz
           );

    if v_sin_rendir > 0 then
      raise exception 'UNRENDERED_MOZOS:%', v_sin_rendir using errcode = 'P0001';
    end if;
  end if;

  insert into caja_cortes (
    caja_id, business_id, encargado_id,
    expected_cash_cents, closing_cash_cents, difference_cents,
    closing_notes, denomination_count, numero, resumen
  ) values (
    p_caja_id, p_business_id, p_encargado_id,
    p_expected_cash_cents, p_closing_cash_cents,
    p_closing_cash_cents - p_expected_cash_cents,
    nullif(btrim(coalesce(p_closing_notes, '')), ''), p_denomination_count,
    v_numero, p_resumen
  )
  returning * into v_corte;

  -- D2 · Se retira todo o nada. El monto es lo **contado**, no lo esperado:
  -- se saca del cajón lo que hay adentro, no lo que debería haber.
  if p_retirar and p_closing_cash_cents > 0 then
    insert into caja_movimientos (
      caja_id, business_id, kind, amount_cents, reason, created_by, created_at,
      corte_id
    ) values (
      p_caja_id, p_business_id, 'sangria', p_closing_cash_cents,
      'Retiro del cierre de caja', p_encargado_id,
      v_corte.created_at + interval '1 millisecond',
      -- Issue #218 · el estampado del `corte_id` se muda acá adentro: era un
      -- UPDATE best-effort después de la transacción, así que un cierre cuyo
      -- update fallaba quedaba con el retiro hecho y sin atar — y el resumen
      -- (spec 149) no podía decir cuánto se había retirado.
      v_corte.id
    )
    returning id into v_retiro_id;
  end if;

  -- D10 · El papel se encola acá adentro. Un cierre sin su papel pendiente es
  -- un cierre sin constancia, y el peor modo de falla es la plata retirada sin
  -- ningún papel. `status='pendiente'`: el agente hace pull.
  insert into print_jobs (business_id, kind, status, corte_id)
  values (p_business_id, 'cierre', 'pendiente', v_corte.id)
  returning id into v_print_job_id;

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

  return query select to_jsonb(v_corte), v_retiro_id, v_mesas, v_mozos, v_print_job_id;
end;
$function$
