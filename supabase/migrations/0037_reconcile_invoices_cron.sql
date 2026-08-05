-- 0037_reconcile_invoices_cron.sql
-- Spec 088 (#140): cierre server-side de las facturas `pending`.
--
-- El gateway ARCA es asíncrono y lento (backoff 1→5→15→60 min, hasta 5
-- intentos; ~28 min de promedio real hasta terminal, 85 en el peor caso),
-- mientras que el polling del cliente corta a los 120s. Sin este cron, una
-- factura queda `pending` para siempre en cuanto el operador cierra la
-- pantalla — y nadie se entera de que ARCA la rechazó.
--
-- Mismo patrón que los otros crons: función SECURITY DEFINER que lee la config
-- de `public.app_config` (los GUC `app.settings.*` NO sirven — Supabase no
-- permite `ALTER DATABASE SET`, ver 0012/0013) y dispara `net.http_post`.

create or replace function "public"."reconcile_pending_invoices"()
  returns "void" language "plpgsql" security definer set "search_path" to 'public'
  as $$
declare
  v_base_url text := (select value from public.app_config where key = 'cron_base_url');
  v_secret   text := (select value from public.app_config where key = 'cron_secret');
begin
  if v_base_url is null or v_base_url = '' or v_secret is null or v_secret = '' then
    raise notice 'reconcile_pending_invoices: falta config en app_config; no dispara';
    return;
  end if;
  perform net.http_post(
    url     := v_base_url || '/api/cron/reconcile-invoices',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
end;
$$;

alter function "public"."reconcile_pending_invoices"() owner to "postgres";

-- Bypass del CRON_SECRET (regla de 0017): la función es SECURITY DEFINER y se
-- pone ella misma el Bearer, así que si quedara ejecutable por PostgREST
-- cualquiera con la publishable key podría dispararla sin conocer el secreto.
revoke all on function "public"."reconcile_pending_invoices"() from public;
revoke execute on function "public"."reconcile_pending_invoices"() from anon, authenticated;
grant execute on function "public"."reconcile_pending_invoices"() to service_role;

-- Cada 2 min: el caso feliz se resuelve en segundos y el reintento del gateway
-- tiene granularidad de minutos, así que bajar más no compra nada.
select cron.schedule(
  'invoices-reconcile',
  '*/2 * * * *',
  $$ select public.reconcile_pending_invoices(); $$
);

-- El índice existente `invoices_business_status_idx` lidera por business_id, así
-- que no sirve para un barrido global por status.
create index if not exists "invoices_pending_poll_idx"
  on "public"."invoices" ("created_at")
  where "status" = 'pending' and "provider_job_id" is not null;
