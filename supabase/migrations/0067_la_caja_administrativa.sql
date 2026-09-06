-- 0067 · La caja administrativa (spec 160)
--
-- La spec 158 hizo que el pago a proveedor escriba una `sangria` sobre la caja
-- elegida, y hoy todas las cajas son cajas de turno. La sangría RESTA del efectivo
-- esperado: una orden de pago grande contra un cajón chico deja el esperado en
-- negativo y el arqueo canta un sobrante por el monto entero, muy por encima del
-- techo de $5.000. El encargado NO PUEDE CERRAR EL TURNO.
--
-- MaxiRest no tiene el problema porque tiene dos cajas: la Adición (el cajón del
-- turno, que se arquea) y la Mayor (administrativa, que no). En el Golf salieron
-- 14.589 órdenes de pago por la mayor y 2 por el cajón en 8 años.
--
-- LA CLAVE DEL DISEÑO (D1): el arqueo YA está aislado por caja —
-- `getCajaStatsEnVentana` filtra `.eq(caja_id)` y `calculateExpectedCash` sólo ve
-- los movimientos de esa caja—. Por eso alcanza con mover el pago a OTRA FILA de
-- `cajas`: el cálculo del arqueo no se toca. Es lo contrario del `kind` nuevo que
-- la 158 casi introduce (su D5), que sí lo habría roto.

-- ── 1 · el flag ─────────────────────────────────────────────────────────────
--
-- Booleano y no `kind` (D1): esto es un ROL SINGULAR de la caja, igual que
-- `is_default`, no un valor de dominio. El repo ya modela así esa distinción.
alter table public.cajas
  add column if not exists is_administrative boolean not null default false;

comment on column public.cajas.is_administrative is
  'Caja mayor (spec 160): NO se arquea y NO cobra. De acá salen los pagos a proveedor. Las dos cosas a la vez — no hay caso que las separe.';

-- Una sola por negocio, espejo de `cajas_one_default_per_business` (0025).
create unique index if not exists cajas_one_administrative_per_business
  on public.cajas (business_id)
  where is_administrative;

-- Este CHECK no es decorativo. `print-agent/route.ts` y `factura-print-actions.ts`
-- resuelven la comandera FISCAL con `.eq("is_default", true)`, y toda caja nace con
-- `fiscal_printer_enabled = true` (0035): sin esto, marcar la administrativa como
-- default le manda las facturas a la impresora de la oficina.
alter table public.cajas drop constraint if exists cajas_administrativa_no_es_default;
alter table public.cajas add constraint cajas_administrativa_no_es_default
  check (not (is_administrative and is_default));

-- ── 2 · la caja de cada negocio ─────────────────────────────────────────────
--
-- `sort_order` alto a propósito (D2 · M): hay tres fallbacks en el código que caen
-- en `cajas[0]` ordenado por `sort_order` y después por nombre — y "Caja Mayor"
-- gana alfabéticamente contra "Caja principal" y "Salon". El 1000 la saca de ahí
-- aunque el filtro de alguno de esos caminos se olvide.
create or replace function public.seed_caja_administrativa(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cajas (business_id, name, is_active, sort_order, is_administrative)
  values (p_business_id, 'Caja Mayor', true, 1000, true)
  on conflict (business_id, name) do nothing;
end;
$$;

create or replace function public.ensure_caja_administrativa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_caja_administrativa(new.id);
  return new;
end;
$$;

drop trigger if exists caja_administrativa_seed_on_business on public.businesses;
create trigger caja_administrativa_seed_on_business
  after insert on public.businesses
  for each row execute function public.ensure_caja_administrativa();

select public.seed_caja_administrativa(id) from public.businesses;

-- ── 3 · no se arquea (D3) ───────────────────────────────────────────────────
--
-- La guarda va en la RPC y no en la pantalla porque `resolveCierrePrinter` NO mira
-- `cajas`: resuelve contra columnas de `businesses`. Si la administrativa llegara a
-- cerrarse por cualquier camino, el ticket de arqueo saldría igual por la impresora
-- del encargado. `cerrar_caja_tx` es además la que estampa `caja_cortes.numero`,
-- encola el `print_job` y barre el salón: es el único punto que los cubre a los tres.
--
-- Se reescribe preservando el cuerpo actual y anteponiendo la guarda: traer 4 KB de
-- PL/pgSQL a mano para retipearlo es cómo se pierde una línea. El replace se
-- VERIFICA antes de tocar nada; si el texto no matchea, aborta y la función vieja
-- sigue intacta (todo esto corre en una transacción).
do $$
declare
  v_src   text;
  v_nuevo text;
  v_args  text;
  v_ret   text;
  -- El ancla es el ÚNICO `begin` en su propia línea del cuerpo (verificado contra
  -- el cloud: `regexp_matches(prosrc, '^\s*begin\s*$', 'ng')` devuelve 1).
  v_ancla constant text := E'\nbegin\n';
  v_guarda constant text :=
    E'\nbegin\n' ||
    '  -- spec 160 · la caja administrativa no se arquea. La guarda vive acá y no en' || E'\n' ||
    '  -- la UI porque resolveCierrePrinter no mira `cajas`: un cierre que llegue por' || E'\n' ||
    '  -- cualquier otro camino imprimiría el ticket igual.' || E'\n' ||
    '  if exists (select 1 from public.cajas' || E'\n' ||
    '             where id = p_caja_id and is_administrative) then' || E'\n' ||
    '    raise exception ''CAJA_ADMINISTRATIVA_NO_SE_ARQUEA'';' || E'\n' ||
    '  end if;' || E'\n';
begin
  -- La firma se RECONSTRUYE desde el catálogo, no se retipea: `cerrar_caja_tx`
  -- devuelve una TABLE de 5 columnas y tiene un parámetro con DEFAULT, y escribir
  -- eso a mano es cómo se cambia el contrato de la función sin querer (el primer
  -- intento de esta migración abortó justo por eso: `returns jsonb`).
  select p.prosrc, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
    into v_src, v_args, v_ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cerrar_caja_tx';
  if v_src is null then
    raise exception 'ABORTA: no encontré cerrar_caja_tx';
  end if;

  if position('CAJA_ADMINISTRATIVA_NO_SE_ARQUEA' in v_src) > 0 then
    raise notice 'cerrar_caja_tx ya tiene la guarda; no se toca';
    return;
  end if;

  -- Exactamente una ocurrencia, o abortamos: con dos, el replace pondría la guarda
  -- adentro de un bloque anidado y el cierre seguiría pasando.
  if (select count(*) from regexp_matches(v_src, '^\s*begin\s*$', 'ng')) <> 1 then
    raise exception 'ABORTA: el cuerpo de cerrar_caja_tx no tiene exactamente un `begin` de apertura — revisar a mano antes de tocar la plata';
  end if;

  v_nuevo := replace(v_src, v_ancla, v_guarda);
  if v_nuevo = v_src then
    raise exception 'ABORTA: el replace no cambió nada';
  end if;

  execute format(
    'create or replace function public.cerrar_caja_tx(%s) returns %s ' ||
    'language plpgsql security definer set search_path = public as %L',
    v_args, v_ret, v_nuevo);
end $$;

-- `create or replace` PRESERVA los grants (a diferencia del drop+create de la
-- 0065), así que esto es sólo re-afirmarlos. La identidad no lleva el DEFAULT.
revoke all on function public.cerrar_caja_tx(
  uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.cerrar_caja_tx(
  uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb
) to service_role;

-- ── 4 · quién puede tocar el flag (D · P) ───────────────────────────────────
--
-- Las policies de `cajas` eran `is_business_member`, que incluye a MOZO y TERMINAL.
-- Con `is_default` eso era una preferencia; con un flag que sostiene "esta caja no
-- la cobra nadie" es una barrera de seguridad que un mozo podría desactivar por
-- PostgREST con su propio JWT. El SELECT queda abierto: la lista de cajas no es
-- secreta y el filtrado de cobro se hace server-side.
drop policy if exists cajas_insert on public.cajas;
create policy cajas_insert on public.cajas
  for insert to authenticated
  with check (is_business_admin(business_id) or is_platform_admin());

drop policy if exists cajas_update on public.cajas;
create policy cajas_update on public.cajas
  for update to authenticated
  using (is_business_admin(business_id) or is_platform_admin())
  with check (is_business_admin(business_id) or is_platform_admin());

drop policy if exists cajas_delete on public.cajas;
create policy cajas_delete on public.cajas
  for delete to authenticated
  using (is_business_admin(business_id) or is_platform_admin());
