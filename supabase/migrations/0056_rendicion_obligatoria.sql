-- ============================================================================
-- 0056 — La rendición, obligatoria y manual (spec 139 · parte A)
--
-- Dos cosas:
--   1) `mozo_rendiciones.estado`: una rendición ahora puede ser «rendida» o
--      «no_entrego».
--   2) `cerrar_caja_tx` bloquea el cierre de la caja principal mientras haya
--      un mozo que cobró y no fue resuelto.
--
-- Por qué el estado y no simplemente `delivered_cash_cents = 0`: son dos cosas
-- distintas. Un mozo que cobró todo con tarjeta entrega $0 y está perfecto; un
-- mozo que se fue con $71.200 encima también entrega $0. Sin la columna, el
-- papel del cierre, el mail del dueño y cualquier consulta futura de deuda no
-- pueden distinguirlos.
--
-- Y por qué existe `no_entrego` en absoluto: porque «obligatoria» tiene que
-- poder convivir con la 1 de la mañana. Si el mozo se fue, el sistema no puede
-- exigir plata que no está — pero sí puede exigir que alguien firme que no
-- está. Sin esa salida, la única manera de cerrar la caja sería inventar una
-- rendición que cuadre, que es exactamente lo que esto viene a evitar.
--
-- Aditiva: `default 'rendida'` deja las filas existentes (hoy: ninguna, en los
-- tres negocios) exactamente como estaban.
-- ============================================================================

-- ── 1) El estado de la rendición ────────────────────────────────────────────

alter table "public"."mozo_rendiciones"
  add column if not exists "estado" text not null default 'rendida';

alter table "public"."mozo_rendiciones"
  drop constraint if exists "mozo_rendiciones_estado_check";
alter table "public"."mozo_rendiciones"
  add constraint "mozo_rendiciones_estado_check"
  check ("estado" in ('rendida', 'no_entrego'));

comment on column "public"."mozo_rendiciones"."estado" is
  'Spec 139: rendida = el mozo entregó (el monto va en delivered_cash_cents). no_entrego = quedó pendiente, con el motivo en notes; delivered_cash_cents = 0 y difference_cents = -expected. Es deuda declarada, no un arqueo aceptado.';

-- Sirve la guarda de `cerrar_caja_tx` y la lista de pendientes del modal.
create index if not exists "mozo_rendiciones_business_mozo_created_idx"
  on "public"."mozo_rendiciones" ("business_id", "mozo_id", "created_at" desc);

-- ── 2) El cierre bloquea mientras falte rendir ──────────────────────────────

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
  v_sin_rendir      integer := 0;
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

  -- Spec 139 · D1/D5 — el día no se cierra dejando a un mozo sin resolver.
  --
  -- «Resolver» no es «entregar»: la rendición puede registrarse como
  -- `no_entrego` con motivo, y eso alcanza para pasar. Lo que no se puede es
  -- ignorar a alguien que cobró — que hasta hoy era, además, la forma más
  -- rápida de cerrar la caja a la 1 de la mañana.
  --
  -- Debe rendir el que cobró (D4: cualquier método, no sólo efectivo) y que no
  -- sea operador de ESTA caja (D3: el que está parado en la caja cobra directo
  -- al cajón, su plata ya está adentro).
  --
  -- El período de cada mozo es el suyo, desde su última rendición — no el de la
  -- caja: es la misma cuenta que hace `getRendicionPendienteMozo`.
  --
  -- Vive acá y no sólo en la server action por la misma carrera que las cuentas
  -- abiertas: entre que el modal lista y el encargado aprieta, un mozo puede
  -- cobrar la 14.
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
  'Specs 130 + 139 — cierre de caja atómico: bloqueo por cuentas abiertas y por mozos sin rendir, corte + sangría del retiro (+1 ms, para que caiga en el período nuevo) + salón liberado + distribución de mozos limpia. Sólo service_role: las guardas de rol y el techo de diferencia viven en la server action.';

revoke all on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean)
  to service_role;
