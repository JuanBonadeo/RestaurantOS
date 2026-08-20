-- 0049_numero_de_pedido_por_dia.sql
-- El número de pedido que ve el local se reinicia en 1 cada jornada.
--
-- PROBLEMA. La comanda de cocina identificaba el ticket con los primeros 8
-- caracteres del UUID de la comanda («Comanda #0cbfafca»): un código
-- alfanumérico que en cocina no significa nada y que además es DISTINTO en cada
-- sector, así que no había forma de juntar la parrilla con la fritera del mismo
-- pedido. El correlativo que sí existe (`orders.order_number`) no se reinicia
-- nunca: sirve para trazar, pero como número de trabajo se vuelve largo e
-- incómodo de cantar en el pase.
--
-- MODELO. Se agrega un segundo numerador, POR JORNADA, que convive con el
-- global (que no se toca: los pedidos viejos conservan su número y la
-- trazabilidad histórica queda intacta).
--
-- JORNADA = día operativo con corte a las 6 AM de Buenos Aires, no medianoche:
-- una cena que sigue hasta las 2 AM es el mismo turno de trabajo y tiene que
-- seguir la misma numeración. El pedido de las 00:30 del sábado pertenece,
-- entonces, a la jornada del viernes.

-- ── 1. La jornada a la que pertenece un instante ──────────────────────────
-- STABLE y no IMMUTABLE a propósito: `at time zone` depende de la base de
-- husos horarios del server, así que no puede indexarse. Por eso la jornada se
-- materializa en una columna (abajo) en vez de calcularse en un índice.

create or replace function "public"."operating_day"("ts" timestamptz)
returns date
language sql
stable
set search_path to 'pg_catalog', 'public'
as $$
  select ((("ts" at time zone 'America/Argentina/Buenos_Aires') - interval '6 hours'))::date
$$;

comment on function "public"."operating_day"(timestamptz) is
  'Jornada operativa (día de trabajo) a la que pertenece un instante: hora de Buenos Aires con corte a las 6 AM, para que la cena que cruza medianoche no se parta en dos.';

-- ── 2. Columnas ───────────────────────────────────────────────────────────

alter table "public"."orders"
  add column if not exists "business_day" date;
alter table "public"."orders"
  add column if not exists "daily_number" integer;

comment on column "public"."orders"."business_day" is
  'Jornada operativa del pedido (corte 6 AM, hora AR). Materializada por trigger: es la clave sobre la que se reinicia `daily_number`.';
comment on column "public"."orders"."daily_number" is
  'Número de pedido DEL DÍA: arranca en 1 cada jornada. Es el que se canta en el pase, el que sale impreso en la comanda y el que ve el mozo. `order_number` sigue siendo el correlativo global, que no se reinicia nunca.';

-- ── 3. Backfill de los pedidos existentes ─────────────────────────────────
-- Se numera por orden de creación dentro de cada jornada, que es el orden en
-- que el local los trabajó.

update "public"."orders"
   set "business_day" = "public"."operating_day"("created_at")
 where "business_day" is null;

with numerados as (
  select "id",
         row_number() over (
           partition by "business_id", "business_day"
           order by "created_at", "order_number"
         ) as "n"
    from "public"."orders"
   where "daily_number" is null
)
update "public"."orders" o
   set "daily_number" = n."n"
  from numerados n
 where n."id" = o."id";

alter table "public"."orders" alter column "business_day" set not null;
alter table "public"."orders" alter column "daily_number" set not null;

-- ── 4. Unicidad dentro de la jornada ──────────────────────────────────────

create unique index if not exists "orders_business_day_daily_number_key"
  on "public"."orders" ("business_id", "business_day", "daily_number");

-- ── 5. Asignación automática ──────────────────────────────────────────────
-- Mismo patrón que `set_order_number`: advisory lock por (negocio, jornada)
-- dentro de la transacción, así dos mozos que marchan a la vez no se llevan el
-- mismo número.

create or replace function "public"."set_order_daily_number"() returns "trigger"
    language "plpgsql"
    set "search_path" to 'pg_catalog', 'public'
    as $$
declare
  lock_key bigint;
begin
  if new.business_day is null then
    new.business_day := public.operating_day(coalesce(new.created_at, now()));
  end if;

  if new.daily_number is null or new.daily_number = 0 then
    lock_key := hashtextextended(new.business_id::text || '|' || new.business_day::text, 0);
    perform pg_advisory_xact_lock(lock_key);

    select coalesce(max(daily_number), 0) + 1
    into new.daily_number
    from orders
    where business_id = new.business_id
      and business_day = new.business_day;
  end if;
  return new;
end;
$$;

alter function "public"."set_order_daily_number"() owner to "postgres";

drop trigger if exists "orders_set_daily_number" on "public"."orders";
create trigger "orders_set_daily_number"
  before insert on "public"."orders"
  for each row execute function "public"."set_order_daily_number"();

grant all on function "public"."operating_day"(timestamptz) to "anon", "authenticated", "service_role";
grant all on function "public"."set_order_daily_number"() to "anon", "authenticated", "service_role";
