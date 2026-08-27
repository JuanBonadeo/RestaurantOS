-- ============================================================================
-- 0050 — Los dos horarios del pedido
--
-- Spec 127 (#197). El encargue telefónico no tenía dónde escribir su hora, así
-- que se la escribía encima a `kitchen_notes` —el campo de texto libre que sale
-- como «ENTREGAR x» arriba de la comanda—. Funcionaba para cocina y para nadie
-- más: el sistema no podía ordenar por esa hora, ni mostrarla, ni usarla para
-- avanzar el pedido a tiempo.
--
-- MODELO. Un pedido pasa a tener DOS horas, las dos a mano:
--
--   · hora de cocina  (`kitchen_at`)   para cuándo el plato tiene que estar
--                                      LISTO. Es la que se imprime.
--   · hora del pedido (`scheduled_at`) cuándo el cliente lo retira o lo recibe.
--                                      Ya existía; ahora la escribe también el
--                                      staff, no sólo el checkout.
--
-- El momento en que el pedido se pone en marcha es `kitchen_at − lead`, y es el
-- mismo en los dos casos que distingue la spec; lo único que cambia es si la
-- comanda ya se imprimió antes (pedido de hoy) o se imprime recién ahí (pedido
-- programado, que por definición es para otro día).
--
-- Aditiva y retrocompatible: sin `kitchen_at` todo se comporta exactamente como
-- hoy — la ventana se sigue calculando con `scheduled_at` y el lead por tipo de
-- entrega, que es el camino del canal web y no se toca. Sin backfill: la hora
-- de los pedidos viejos vive adentro de texto libre y no es parseable
-- (en la base hay «T», «transfirio», «a»).
-- ============================================================================

-- ── 1. La hora de cocina ──────────────────────────────────────────────────

alter table "public"."orders"
  add column if not exists "kitchen_at" timestamptz;

comment on column "public"."orders"."kitchen_at" is
  'Spec 127: para cuándo el plato tiene que estar LISTO. La escribe el encargado a mano al cargar el pedido; el sistema no la calcula. Es la hora que sale impresa arriba de la comanda («ENTREGAR 21:15») y la que manda la ventana de marcha (kitchen_at − businesses.scheduled_march_lead_kitchen_min). Null = el pedido es para ahora, o viene del checkout público (que expresa una sola hora, en scheduled_at).';

comment on column "public"."orders"."scheduled_at" is
  'Hora DEL PEDIDO: cuándo el cliente lo retira o lo recibe (spec 31 + 061 + 127). Null = para ahora. Si es futuro el pedido no entra al kanban hasta su marcha, que la dispara el cron `orders-march-scheduled`. La ventana se calcula contra `kitchen_at` cuando hay hora de cocina (staff, spec 127) y contra esta misma columna menos el lead por tipo de entrega cuando no la hay (checkout público, spec 061).';

-- ── 2. El lead, que vuelve a ser tiempo de cocina ─────────────────────────
-- Los dos leads de la 0027 (40 retiro / 60 delivery) se conservan y siguen
-- rigiendo el canal web. Éste es el que aplica cuando HAY hora de cocina: ahí
-- el viaje ya está dicho en la diferencia entre las dos horas que escribió el
-- encargado (listo 21:15 → entrega 21:30 = 15 min de viaje), así que el lead
-- vuelve a ser tiempo de preparación puro y deja de depender del canal.

alter table "public"."businesses"
  add column if not exists "scheduled_march_lead_kitchen_min" int not null default 40;

alter table "public"."businesses"
  drop constraint if exists "businesses_scheduled_march_lead_kitchen_check";
alter table "public"."businesses"
  add constraint "businesses_scheduled_march_lead_kitchen_check"
  check ("scheduled_march_lead_kitchen_min" between 0 and 240);

comment on column "public"."businesses"."scheduled_march_lead_kitchen_min" is
  'Spec 127: minutos antes de `orders.kitchen_at` en que el pedido se pone en marcha — pasa a `preparing` y, si todavía no salió, se imprime la comanda. Default 40. A diferencia de los leads de la 0027 no depende del tipo de entrega: el viaje ya está expresado en la diferencia entre la hora de cocina y la del pedido.';

-- ── 3. La red del automatismo ─────────────────────────────────────────────
-- Con la spec 127 el encargue telefónico pasa a depender del cron: si el cron
-- no corre, el pedido no avanza y hoy nadie se entera hasta que llama el
-- cliente. El aviso se emite una sola vez por pedido, y esta columna es la
-- idempotencia (el tick corre cada 5 minutos).

alter table "public"."orders"
  add column if not exists "march_alerted_at" timestamptz;

comment on column "public"."orders"."march_alerted_at" is
  'Spec 127: cuándo se avisó que el pedido pasó su hora de marcha sin ponerse en marcha (cron caído, sector sin resolver). Idempotencia del aviso: el cron corre cada 5 min y el timbre suena una vez. Null = nunca hizo falta avisar.';

-- ── 4. Índice de la ventana ───────────────────────────────────────────────
-- El filtro SQL del cron acota por `coalesce(kitchen_at, scheduled_at)`. El
-- índice parcial de `scheduled_at` ya existe (spec 31); éste es su par para la
-- hora de cocina, y es chico: sólo los pedidos que la tienen.

create index if not exists "orders_kitchen_at_idx"
  on "public"."orders" ("business_id", "kitchen_at")
  where "kitchen_at" is not null;
