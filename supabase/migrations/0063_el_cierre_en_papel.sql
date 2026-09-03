-- Spec 139 · Parte B — el cierre en papel.
--
-- Cerrar la caja produce el documento más denso del día y hasta hoy no dejaba
-- **nada en la mano**: ni el papel que va en el sobre con la plata, ni una foto
-- de lo que el encargado vio al apretar el botón.
--
-- Tres cosas acá, y las tres existen por el mismo motivo — que el papel diga
-- exactamente lo que se vio, para siempre:
--
--   D9 · `caja_cortes.resumen jsonb` — snapshot CONGELADO.
--        La alternativa (reconstruir el período cuando el agente hace el poll)
--        se descarta por dos motivos concretos: `getCajaLiveStats` calcula el
--        período **abierto**, que después de cerrar ya es el nuevo; y una
--        corrección de pago posterior (spec 070) cambiaría retroactivamente un
--        papel que alguien ya firmó.
--
--        Efecto lateral que importa: esto también arregla el caveat que la
--        spec 149 documentó en el resumen en pantalla. Con el snapshot, un
--        cierre viejo deja de moverse.
--
--   D14 · `caja_cortes.numero` — correlativo POR NEGOCIO.
--        Un papel que se firma y se archiva necesita un identificador que se
--        pueda cantar por teléfono: «el cierre 3969». Un UUID no lo es. La foto
--        de MaxiRest lo trae (`Cierre nº 3969.`) y el valor alto sugiere
--        correlativo por local, no por caja — que además es el que no tiene
--        ambigüedad cuando hay dos cajas.
--
--   D10 · La fila del papel se inserta DENTRO de `cerrar_caja_tx`.
--        Encolar es un `insert` en `print_jobs` —el agente hace *pull*, no hay
--        I/O externo— así que entra en la misma transacción que el corte, el
--        retiro y el barrido del salón. Un cierre sin su papel pendiente sería
--        un cierre sin constancia, y el modo de falla (el proceso muere entre
--        la RPC y el insert) es justo el peor: la plata retirada y ningún papel.
--
-- Aditiva: no cambia ninguna fila existente. Los cortes viejos quedan con
-- `numero` y `resumen` en NULL — no se retro-numeran ni se les inventa un
-- snapshot que nadie vio.

-- ── Las columnas del corte ──────────────────────────────────────

alter table public.caja_cortes
  add column if not exists numero  integer,
  add column if not exists resumen jsonb;

comment on column public.caja_cortes.numero is
  'Spec 139 · D14 — correlativo por negocio, para poder nombrar el cierre por teléfono. NULL en los cortes anteriores a la spec: no se retro-numeran.';
comment on column public.caja_cortes.resumen is
  'Spec 139 · D9 — snapshot congelado de lo que el encargado vio al cerrar. El papel dice esto, no lo que la base diga mañana.';

-- Correlativo por negocio: dos cierres del mismo local no comparten número.
-- Parcial para no chocar con los cortes viejos, que quedan en NULL.
create unique index if not exists caja_cortes_numero_uniq
  on public.caja_cortes (business_id, numero)
  where numero is not null;

-- ── El papel en la cola de impresión ────────────────────────────

alter table public.print_jobs
  add column if not exists corte_id uuid references public.caja_cortes(id) on delete cascade;

comment on column public.print_jobs.corte_id is
  'Spec 139 · Parte B — a qué cierre pertenece este papel (kind=''cierre''). Igual que `invoice_id` para la factura.';

create index if not exists print_jobs_corte_idx
  on public.print_jobs (corte_id)
  where corte_id is not null;

-- Un papel por cierre. La REIMPRESIÓN no inserta una fila nueva: sella
-- `reprint_requested_at` sobre la que ya está, igual que la cuenta (080) y la
-- factura (084). Por eso el único es total y no parcial como el de `control`.
create unique index if not exists print_jobs_cierre_uniq
  on public.print_jobs (corte_id)
  where kind = 'cierre';

-- ── El cierre, ahora con número, snapshot y papel ───────────────

-- Se reemplaza la firma: `p_resumen` entra como parámetro porque la server
-- action **ya calculó** esas stats para validar la diferencia (D9). No hay
-- cálculo nuevo acá adentro: sólo se persiste el que había.
create or replace function public.cerrar_caja_tx(
  p_caja_id            uuid,
  p_business_id        uuid,
  p_encargado_id       uuid,
  p_expected_cash_cents bigint,
  p_closing_cash_cents  bigint,
  p_closing_notes      text,
  p_denomination_count jsonb,
  p_retirar            boolean,
  p_barrer_salon       boolean,
  p_resumen            jsonb default null
)
returns table (
  corte            jsonb,
  retiro_id        uuid,
  mesas_liberadas  integer,
  mozos_limpiados  integer,
  print_job_id     uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caja            cajas%rowtype;
  v_corte           caja_cortes%rowtype;
  v_retiro_id       uuid := null;
  v_print_job_id    uuid := null;
  v_mesas           integer := 0;
  v_mozos           integer := 0;
  v_abiertas        integer := 0;
  v_plan_ids        uuid[];
  v_numero          integer;
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

  -- D14 · El correlativo se toma con el lock del negocio ya puesto por la fila
  -- de la caja. Dos cierres simultáneos de dos cajas distintas del mismo local
  -- podrían pedir el mismo número, así que además está el único parcial: el
  -- segundo revienta y reintenta, en vez de quedar duplicado en el papel.
  select coalesce(max(numero), 0) + 1 into v_numero
    from caja_cortes
    where business_id = p_business_id;

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
$$;

comment on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb) is
  'Spec 139 Parte B — cierre atómico: número correlativo + snapshot congelado + corte + sangría del retiro (ya con su corte_id, issue #218) + papel encolado + salón liberado. Sólo service_role: las guardas de rol y el techo de diferencia viven en la server action.';

revoke all on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb)
  to service_role;

-- La firma vieja (9 parámetros) se borra: dejarla viva significaría que un
-- caller desactualizado cierra la caja **sin número, sin snapshot y sin papel**,
-- en silencio y por resolución de sobrecarga.
drop function if exists public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean);
