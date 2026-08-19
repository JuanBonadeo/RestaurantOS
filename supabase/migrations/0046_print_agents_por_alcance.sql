-- 0046_print_agents_por_alcance.sql
-- Spec 124 — varios print-agents por negocio, cada uno con su alcance. FASE 1 (expand).
--
-- Golf necesita una segunda PC con print-agent para la segunda caja, y está en
-- otra LAN: ninguna de las dos máquinas llega a las impresoras de la otra.
--
-- Hoy hay UNA key por negocio (`business_id` es la PK, migración 0014) y el GET
-- del agente sirve todo lo pendiente del negocio. Con dos agentes el papel no se
-- duplicaría —cada uno sólo puede abrir socket contra IPs de su red— pero el
-- estado sí se rompe: el que no llega reporta `failed` tras 5 intentos, y eso
-- setea `print_failed_at` y dispara `notifyPrintFailed` por cada ticket del otro
-- local; encima el `failed` puede llegar DESPUÉS del `ok` del que sí imprimió y
-- marcar como fallida una comanda que salió bien.
--
-- Dos cambios de fondo:
--   1. `print_agent_credentials` pasa a N filas por negocio → **la key
--      identifica al agente**. Es lo que evita tocar la PC ya instalada: sigue
--      mandando su mismo Bearer y el server ya sabe quién es.
--   2. `print_agent_status` pasa a una fila por agente → un agente caído se ve,
--      aunque el otro esté latiendo.
--
-- ⚠️ POR QUÉ ESTÁ PARTIDA EN TRES (0046 expand / 0047 índices / 0048 contract)
-- Golf está imprimiendo en vivo. Si el cambio de PK de `print_agent_status`
-- entrara ANTES del deploy, el heartbeat del código viejo —que upsertea con
-- `onConflict: business_id`— fallaría contra una PK que ya no existe y el local
-- se vería "sin conexión" hasta que Vercel termine de deployar. Esta fase es
-- **aditiva y compatible con el código viejo**: se aplica cuando quieras. La
-- 0047 agrega los dos índices que sostienen esa compatibilidad y se aplica
-- pegada a ésta; la 0048 cierra el modelo y va DESPUÉS del deploy.
--
-- El alcance (`printer_scope`) es la lista de IPs/CIDR que ese agente puede
-- tocar; el GET filtra por el `printer_ip` que cada trabajo ya trae resuelto, así
-- que la misma regla cubre comanda, control, cuenta y factura. **NULL = sin
-- restricción**, que es exactamente el comportamiento de hoy: un negocio con un
-- solo agente no configura nada y no se entera de esta migración.

-- ── 1. Credenciales: de una fila por negocio a una por agente ──────────────

alter table "public"."print_agent_credentials"
  add column if not exists "id" "uuid" not null default "gen_random_uuid"(),
  add column if not exists "label" "text",
  add column if not exists "printer_scope" "text"[];

-- La fila que ya existe (golf) se queda con su key y estrena id. `label` queda
-- NULLABLE en esta fase: el código viejo todavía puede insertar una credencial
-- sin label y no queremos que le explote en la cara. La 0048 lo cierra.
update "public"."print_agent_credentials"
   set "label" = 'Agente principal'
 where "label" is null;

-- La PK pasa a `id`; `business_id` queda como FK común (ya lo era) y se indexa,
-- porque toda lectura del contrato entra por negocio. Seguro para el código
-- viejo: nadie depende de que la PK sea `business_id`, sólo de que haya una sola
-- fila por negocio — y eso lo seguimos garantizando hasta que se cree la segunda
-- key, que recién pasa después del deploy.
alter table "public"."print_agent_credentials"
  drop constraint if exists "print_agent_credentials_pkey";

alter table "public"."print_agent_credentials"
  add constraint "print_agent_credentials_pkey" primary key ("id");

-- Índice común acá; la 0047 lo reemplaza por uno ÚNICO mientras dure la ventana
-- (el `upsert onConflict: "business_id"` del código viejo lo necesita), y la
-- 0048 vuelve a éste cuando el negocio ya puede tener varios agentes.
create index if not exists "print_agent_credentials_business_id_idx"
  on "public"."print_agent_credentials" ("business_id");

-- La key tiene que resolver a UN agente. Sin esto, dos filas con la misma key
-- harían ambiguo el `verifyAgentKey` y el alcance dejaría de significar nada.
alter table "public"."print_agent_credentials"
  drop constraint if exists "print_agent_credentials_api_key_key";
alter table "public"."print_agent_credentials"
  add constraint "print_agent_credentials_api_key_key" unique ("api_key");

comment on column "public"."print_agent_credentials"."id" is
  'Spec 124: identidad del agente. La key resuelve a esta fila, así que el agente ya instalado no cambia nada de su lado.';

comment on column "public"."print_agent_credentials"."label" is
  'Spec 124: cómo se llama esta PC en el panel («Caja principal», «Caja bar»). Único por negocio desde la 0048.';

comment on column "public"."print_agent_credentials"."printer_scope" is
  'Spec 124: IPs/CIDR que este agente alcanza (ej: {192.168.100.0/24}). El GET filtra los trabajos por printer_ip contra esta lista. NULL = sin restricción (negocio de un solo agente, comportamiento previo a la 124). Se valida en la app (normalizarScope); el matcher degrada sin romper ante una entrada inválida.';

comment on table "public"."print_agent_credentials" is
  'Keys del print-agent — SERVER-ONLY. Una fila POR AGENTE (spec 124; antes una por negocio, spec 046). Nunca exponer al cliente salvo al crear/rotar. Mismo patrón que afip_gateway_credentials / whatsapp_credentials.';

-- ── 2. Heartbeat: la columna, todavía sin cerrar el modelo ─────────────────
-- `agent_id` entra NULLABLE y la PK sigue siendo `business_id`, así que el
-- upsert del código viejo (`onConflict: business_id`) sigue funcionando igual.

alter table "public"."print_agent_status"
  add column if not exists "agent_id" "uuid";

update "public"."print_agent_status" s
   set "agent_id" = c."id"
  from "public"."print_agent_credentials" c
 where c."business_id" = s."business_id"
   and s."agent_id" is null;

comment on column "public"."print_agent_status"."agent_id" is
  'Spec 124: qué agente latió. Antes la PK era sólo business_id, así que dos PCs se pisaban la fila y un agente caído se veía conectado porque el otro seguía latiendo. Se vuelve NOT NULL y parte de la PK en la 0048.';
