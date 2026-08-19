-- 0048_print_agents_cierre_del_modelo.sql
-- Spec 124 — FASE 2 (contract). Va DESPUÉS del deploy de la 0046 + 0047.
--
-- La 0046 puso las columnas y la 0047 los índices que sostienen la ventana entre
-- migración y deploy. Esta cierra el modelo: recién acá un negocio puede tener
-- de verdad dos agentes.
--
-- ⚠️ ORDEN: aplicar SÓLO con el código de la spec 124 ya deployado. Mientras el
-- código viejo esté vivo, el `.maybeSingle()` de `getPrintAgentKey` y los upserts
-- por `business_id` necesitan que siga habiendo una sola credencial por negocio
-- — que es exactamente lo que el único de la 0047 garantiza y esta migración
-- levanta. Aplicar esto antes del deploy deja al local sin poder autenticar en
-- cuanto se cree la segunda key.

-- ── 1. Credenciales: se libera el negocio para tener N agentes ─────────────

drop index if exists "public"."print_agent_credentials_business_id_key";

create index if not exists "print_agent_credentials_business_id_idx"
  on "public"."print_agent_credentials" ("business_id");

-- El label pasa a obligatorio. Re-backfill primero: entre la 0046 y el deploy el
-- código viejo pudo haber insertado una credencial sin label.
update "public"."print_agent_credentials"
   set "label" = 'Agente principal'
 where "label" is null;

alter table "public"."print_agent_credentials"
  alter column "label" set not null;

-- Dos agentes del mismo negocio no pueden llamarse igual: el label es cómo los
-- distingue el que configura («Caja principal» / «Caja bar»).
alter table "public"."print_agent_credentials"
  drop constraint if exists "print_agent_credentials_business_label_key";
alter table "public"."print_agent_credentials"
  add constraint "print_agent_credentials_business_label_key"
  unique ("business_id", "label");

-- ── 2. Heartbeat: una fila por agente ──────────────────────────────────────

update "public"."print_agent_status" s
   set "agent_id" = c."id"
  from "public"."print_agent_credentials" c
 where c."business_id" = s."business_id"
   and s."agent_id" is null;

-- Un latido sin credencial es de un agente que ya no existe (key borrada). No se
-- puede atribuir a nadie, y mostrarlo sería mentir sobre qué está vivo.
delete from "public"."print_agent_status" where "agent_id" is null;

alter table "public"."print_agent_status"
  alter column "agent_id" set not null;

alter table "public"."print_agent_status"
  drop constraint if exists "print_agent_status_pkey";

alter table "public"."print_agent_status"
  add constraint "print_agent_status_pkey" primary key ("business_id", "agent_id");

-- La PK ya cubre el par, así que el índice puente de la 0047 sobra.
drop index if exists "public"."print_agent_status_business_agent_key";

-- Borrar la credencial se lleva su latido: si la PC dejó de existir, su estado
-- de salud no tiene por qué sobrevivirla.
alter table "public"."print_agent_status"
  drop constraint if exists "print_agent_status_agent_id_fkey";
alter table "public"."print_agent_status"
  add constraint "print_agent_status_agent_id_fkey"
  foreign key ("agent_id") references "public"."print_agent_credentials"("id") on delete cascade;

comment on table "public"."print_agent_status" is
  'Spec 35 + 124: heartbeat del print agent on-site. Una fila POR AGENTE; cada uno upsertea `last_seen_at` en cada poll. Operación deriva conectado (now - last_seen < 60s) vs caído. Escritura por service; lectura por members del negocio.';
