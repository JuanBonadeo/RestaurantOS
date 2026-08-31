-- 0053_reservas_pendientes.sql
-- Spec 131 · La reserva la confirma el local (#203).
--
-- Las reservas de cliente (web/chatbot) pasan a nacer `pending` y las confirma
-- el encargado. Esta migración abre el modelo de datos para eso:
--
--   1. tres estados nuevos: pending / rejected / expired
--   2. la pendiente TOMA EL LUGAR → entra al GIST anti-overlap (D2)
--   3. rastro de la decisión: motivo, cuándo y quién
--   4. `approval_expiry_min` por negocio: a cuánto del turno vence sin respuesta

-- ── 1. Estados ────────────────────────────────────────────────────────────
alter table "public"."reservations"
  drop constraint if exists "reservations_status_check";

alter table "public"."reservations"
  add constraint "reservations_status_check" check (
    "status" = any (array[
      'pending'::text,
      'confirmed'::text,
      'seated'::text,
      'completed'::text,
      'no_show'::text,
      'rejected'::text,
      'expired'::text,
      'cancelled'::text
    ])
  );

-- ── 2. La pendiente bloquea la mesa ───────────────────────────────────────
-- Mientras espera respuesta nadie más puede quedarse con ese lugar. Si se
-- rechaza o vence, sale del predicado y la mesa queda libre sola.
alter table "public"."reservations"
  drop constraint if exists "reservations_no_overlap";

alter table "public"."reservations"
  add constraint "reservations_no_overlap" exclude using "gist" (
    "table_id" with =,
    "tstzrange"("starts_at", "ends_at") with &&
  ) where (
    "status" = any (array['pending'::text, 'confirmed'::text, 'seated'::text])
    and "table_id" is not null
  );

-- ── 3. La decisión del encargado ──────────────────────────────────────────
alter table "public"."reservations"
  add column if not exists "rejection_reason" text,
  add column if not exists "decided_at" timestamptz,
  add column if not exists "decided_by" uuid references "auth"."users"("id") on delete set null;

comment on column "public"."reservations"."rejection_reason" is
  'Spec 131 — motivo opcional del rechazo; se le muestra al cliente.';
comment on column "public"."reservations"."decided_at" is
  'Spec 131 — cuándo se resolvió la pendiente (confirmada o rechazada).';
comment on column "public"."reservations"."decided_by" is
  'Spec 131 — quién la resolvió. NULL con decided_at seteado = venció sola.';

-- Bandeja del encargado: las pendientes del negocio, por hora.
create index if not exists "reservations_pending_idx"
  on "public"."reservations" using "btree" ("business_id", "starts_at")
  where ("status" = 'pending'::text);

-- ── 4. Vencimiento sin respuesta ──────────────────────────────────────────
-- Default 120 min ANTES del turno. El piso de 15 min desde que se creó vive en
-- TS (`pendingExpiresAt`), que es donde corre el barrido.
alter table "public"."reservation_settings"
  add column if not exists "approval_expiry_min" integer not null default 120;

alter table "public"."reservation_settings"
  drop constraint if exists "reservation_settings_approval_expiry_min_check";

alter table "public"."reservation_settings"
  add constraint "reservation_settings_approval_expiry_min_check"
  check ("approval_expiry_min" > 0);

comment on column "public"."reservation_settings"."approval_expiry_min" is
  'Spec 131 — minutos antes del turno en que una reserva pendiente vence sin respuesta del local.';
