-- ============================================================================
-- 0028 — Comanda de control para delivery y retiro (spec 063)
--
-- La comanda de cocina no le sirve al que reparte: va sin precios, partida por
-- sector y sin cliente ni dirección. El "control de pedido" es el otro papel —
-- el pedido entero, con plata, destino y horario.
--
-- Tabla propia y NO una fila en `comandas` (D1 del spec): un control no tiene
-- sector, ni tanda, ni estado de cocina. Meterlo ahí obligaría a filtrarlo en
-- los ~8 lugares que leen `comandas` (KDS, kanban, reportes, notificaciones,
-- demora de mesa), y cada uno que se olvide es un control apareciendo en la
-- pantalla de la cocina.
-- ============================================================================

-- ── 1) Comandera de control por negocio ─────────────────────────────────────
-- Destino único del local, no un sector más. Se configura en Ajustes →
-- Operación del local, al lado de las comanderas por sector (spec 28).

alter table "public"."businesses"
  add column if not exists "control_printer_ip" text;

alter table "public"."businesses"
  add column if not exists "control_printer_port" int not null default 9100;

alter table "public"."businesses"
  add column if not exists "control_printer_enabled" boolean not null default true;

comment on column "public"."businesses"."control_printer_ip" is
  'Spec 063: IP en la LAN del local de la comandera donde se imprime el "control de pedido" de delivery/retiro. NULL o vacía = el negocio no imprime controles.';

comment on column "public"."businesses"."control_printer_enabled" is
  'Spec 063: apaga la impresión de controles sin perder la IP configurada.';

-- ── 2) Tickets de control ───────────────────────────────────────────────────

create table if not exists "public"."control_tickets" (
  "id"                   uuid primary key default gen_random_uuid(),
  "order_id"             uuid not null references "public"."orders"(id) on delete cascade,
  "business_id"          uuid not null references "public"."businesses"(id) on delete cascade,
  "status"               text not null default 'pendiente',
  "emitted_at"           timestamptz not null default now(),
  "printed_at"           timestamptz,
  "print_failed_at"      timestamptz,
  "reprint_requested_at" timestamptz,
  constraint "control_tickets_status_check" check ("status" in ('pendiente', 'impreso'))
);

comment on table "public"."control_tickets" is
  'Spec 063: "control de pedido" — el ticket que se lleva el repartidor (pedido completo, precios, cliente, dirección, horario, cuánto cobrar). Uno por orden.';

-- Único por orden = idempotencia gratis. `routeOrderToCocina` puede correr dos
-- veces (reintento del cron, ticks solapados, "marchar ahora" sobre algo ya
-- tomado) y el `on conflict do nothing` del insert no duplica el papel.
create unique index if not exists "control_tickets_order_uniq"
  on "public"."control_tickets" ("order_id");

-- Sirve el pull del print-agent: los pendientes de un negocio, en orden.
create index if not exists "control_tickets_business_pendientes_idx"
  on "public"."control_tickets" ("business_id", "emitted_at")
  where "status" = 'pendiente';

comment on column "public"."control_tickets"."print_failed_at" is
  'Spec 063 (espeja comandas.print_failed_at, spec 33): el agente no pudo imprimir. Se limpia al confirmar la impresión.';

comment on column "public"."control_tickets"."reprint_requested_at" is
  'Spec 063: reimpresión pedida a mano. La columna queda lista; el botón es fuera de alcance del spec.';

-- ── 3) RLS ──────────────────────────────────────────────────────────────────
-- Lectura scopeada por membresía (para poder mostrar el estado del control en
-- el board más adelante). Escritura: nadie por API — el ciclo entero lo maneja
-- el service client (emisión desde `routeOrderToCocina`, confirmación desde el
-- endpoint del print-agent, que ya se autentica con su propia key).

alter table "public"."control_tickets" enable row level security;

drop policy if exists "control_tickets_select" on "public"."control_tickets";
create policy "control_tickets_select" on "public"."control_tickets"
  for select to authenticated
  using (
    exists (
      select 1 from "public"."business_users" bu
      where bu."business_id" = "control_tickets"."business_id"
        and bu."user_id" = auth.uid()
    )
  );
