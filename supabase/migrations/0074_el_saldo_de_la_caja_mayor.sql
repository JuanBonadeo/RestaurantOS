-- 0074 · El saldo de la Caja Mayor (spec 168)
--
-- La spec 160 creó la caja administrativa y le mandó los pagos, pero su D5 —el
-- saldo y el fondeo— quedó sin construir: la caja arranca en $0, sólo baja, y la
-- única forma de verla es el libro de movimientos.
--
-- POR QUÉ UNA RPC Y NO UN SELECT (D1): una caja SIN CORTES se lee desde su
-- `created_at` hasta hoy, sin frontera. PostgREST trunca en `max_rows` = 1000 EN
-- SILENCIO, así que a 7,6 movimientos por día hábil el saldo empezaría a mentir
-- hacia arriba a los 4-6 meses, sin ningún error. Es el mismo bug que la spec 161
-- acaba de sacar de las lecturas de proveedores: no se reintroduce acá.

create or replace function public.saldo_caja_administrativa(p_business_id uuid)
returns table (
  caja_id uuid,
  caja_name text,
  saldo_cents bigint,
  movimientos integer,
  ultimo_movimiento timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    -- El mismo signo que usa el arqueo: el ingreso suma al cajón, la sangría resta.
    -- Lo anulado (spec 070) no cuenta, igual que en el libro.
    coalesce(sum(
      case when m.kind = 'ingreso' then m.amount_cents else -m.amount_cents end
    ) filter (where m.cancelled_at is null), 0)::bigint,
    count(m.id) filter (where m.cancelled_at is null)::integer,
    max(m.created_at) filter (where m.cancelled_at is null)
  from public.cajas c
  left join public.caja_movimientos m on m.caja_id = c.id
  where c.business_id = p_business_id
    and c.is_administrative
  group by c.id, c.name;
$$;

comment on function public.saldo_caja_administrativa(uuid) is
  'Saldo de la caja mayor (spec 168), agregado en Postgres: leerlo por PostgREST lo truncaría en 1000 filas en silencio.';

-- Se llama desde una server action con el service client, igual que el resto del
-- módulo. `stable` + `security definer` con search_path fijo.
revoke all on function public.saldo_caja_administrativa(uuid) from public, anon, authenticated;
grant execute on function public.saldo_caja_administrativa(uuid) to service_role;
