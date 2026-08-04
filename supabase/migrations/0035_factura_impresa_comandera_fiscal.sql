-- ============================================================================
-- 0035 — Factura impresa en la comandera fiscal (spec 084)
--
-- Tercera de la familia de `print_jobs`: control de pedido (063) → cuenta
-- (080) → factura. Dos cosas:
--   1) `print_jobs` admite `kind = 'factura'`, colgada de la FACTURA y no de la
--      orden.
--   2) Comandera fiscal por caja.
-- ============================================================================

-- ── 1) print_jobs: un tercer kind, con su propio objetivo ───────────────────
--
-- `order_id` deja de ser obligatorio: una factura puede no tener orden (una
-- nota de crédito, un comprobante suelto), así que colgarla de `order_id`
-- sería mentira. El check garantiza que cada kind apunte a lo suyo y que
-- ninguno quede huérfano.

alter table "public"."print_jobs"
  alter column "order_id" drop not null;

alter table "public"."print_jobs"
  add column if not exists "invoice_id" uuid
  references "public"."invoices"(id) on delete cascade;

alter table "public"."print_jobs"
  drop constraint if exists "print_jobs_kind_check";
alter table "public"."print_jobs"
  add constraint "print_jobs_kind_check"
  check ("kind" in ('control', 'cuenta', 'factura'));

alter table "public"."print_jobs"
  drop constraint if exists "print_jobs_target_check";
alter table "public"."print_jobs"
  add constraint "print_jobs_target_check"
  check (
    ("kind" in ('control', 'cuenta') and "order_id"   is not null)
    or
    ("kind" = 'factura'              and "invoice_id" is not null)
  );

comment on column "public"."print_jobs"."invoice_id" is
  'Spec 084: la factura que imprime un job kind=factura. NULL en control y cuenta, que cuelgan de order_id.';

comment on column "public"."print_jobs"."kind" is
  'control = uno por orden, lo emite la marcha a cocina. cuenta = las veces que la mesa la pida. factura = copia impresa de un comprobante ya autorizado por ARCA.';

-- Sirve el chequeo de "¿ya se imprimió antes esta factura?" (marca REIMPRESION).
create index if not exists "print_jobs_invoice_idx"
  on "public"."print_jobs" ("invoice_id")
  where "invoice_id" is not null;

-- ── 2) Comandera fiscal por caja ────────────────────────────────────────────
--
-- Por caja y no por negocio (decisión de Juan): el papel fiscal tiene que salir
-- donde está parado el que cobra. La caja de una factura sale de su pago
-- (`invoices.payment_id` -> `payments.caja_id`); si la factura no tiene pago,
-- cae a la caja por defecto del negocio (`cajas.is_default`, migración 0025).

alter table "public"."cajas"
  add column if not exists "fiscal_printer_ip" text;
alter table "public"."cajas"
  add column if not exists "fiscal_printer_port" int not null default 9100;
alter table "public"."cajas"
  add column if not exists "fiscal_printer_enabled" boolean not null default true;

comment on column "public"."cajas"."fiscal_printer_ip" is
  'Spec 084: comandera donde sale la factura impresa (con el QR de ARCA) de los cobros de ESTA caja. NULL o vacia = la caja no imprime facturas.';

comment on column "public"."cajas"."fiscal_printer_enabled" is
  'Spec 084: apaga la impresion de facturas de esta caja sin perder la IP configurada.';
