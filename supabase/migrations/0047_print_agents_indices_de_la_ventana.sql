-- 0047_print_agents_indices_de_la_ventana.sql
-- Spec 124 — los dos índices que sostienen la ventana entre migración y deploy.
--
-- La 0046 sacó la PK de `business_id` en `print_agent_credentials` y con eso se
-- llevó puesto el único índice ÚNICO sobre esa columna. Los upserts del código
-- viejo (`credentials-actions.ts`, `onConflict: "business_id"`) se quedan sin
-- árbitro y fallan con 42P10 — o sea que **rotar la key y bajar el instalador se
-- rompen apenas se aplica la 0046, antes del deploy**, que es justo lo que esa
-- migración prometía no hacer.
--
-- Y del otro lado pasa lo simétrico: el heartbeat NUEVO upsertea por
-- `(business_id, agent_id)`, que tampoco tiene índice único hasta la 0048. Entre
-- el deploy y esa migración, cada latido sería un 500 — y el agente latea a cada
-- poll, o sea una vez por segundo.
--
-- Los dos índices existen para que ninguna de las dos ventanas exista. Se aplica
-- pegada a la 0046.

-- ── 1. Credenciales: el único de business_id vuelve, por ahora ─────────────
-- Mantiene andando al código viejo y, de yapa, impide crear la segunda
-- credencial antes de tiempo (que rompería el `.maybeSingle()` que todavía está
-- deployado). La 0048 lo afloja, y recién ahí golf puede tener dos agentes.

drop index if exists "public"."print_agent_credentials_business_id_idx";

create unique index if not exists "print_agent_credentials_business_id_key"
  on "public"."print_agent_credentials" ("business_id");

-- ── 2. Heartbeat: el árbitro del upsert nuevo ──────────────────────────────
-- Convive con la PK vieja (`business_id`) mientras haya un solo agente por
-- negocio. Las filas con `agent_id` null no chocan entre sí: NULLS DISTINCT es
-- el default de Postgres.

create unique index if not exists "print_agent_status_business_agent_key"
  on "public"."print_agent_status" ("business_id", "agent_id");
