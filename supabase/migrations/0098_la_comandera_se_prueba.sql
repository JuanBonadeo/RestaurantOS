-- ============================================================================
-- 0098 — La comandera se prueba (spec 176)
--
-- Hoy la única forma de saber si una IP de comandera está bien cargada es
-- marchar un pedido de verdad y esperar a que salga el papel. En la instalación
-- on-site (golf, KCC) eso es ir y venir del salón a la cocina por cada sector.
--
-- El papel de prueba se encola como un `print_jobs` más: el agente ya sabe
-- levantar cualquier fila del pull, imprimir `content_escpos_b64` y confirmar
-- con `POST /api/print-agent`. Cero cambios en el .exe del local.
--
-- La diferencia con los otros kinds es a QUÉ apunta: el control cuelga de una
-- orden, la factura de un comprobante, el cierre de un corte. La prueba no
-- cuelga de nada — su destino ES el dato, la IP que el encargado está probando,
-- que puede ni siquiera estar guardada todavía. Por eso viaja en la fila.
-- ============================================================================

alter table "public"."print_jobs"
  add column if not exists "test_printer_ip" text;
alter table "public"."print_jobs"
  add column if not exists "test_printer_port" int;
alter table "public"."print_jobs"
  add column if not exists "test_label" text;

comment on column "public"."print_jobs"."test_printer_ip" is
  'Spec 176: destino del papel de prueba (kind=prueba). Es la IP que el encargado tipeó en Ajustes, guardada o no. NULL en todos los demás kinds, que resuelven su impresora por configuracion.';
comment on column "public"."print_jobs"."test_label" is
  'Spec 176: como se llama la comandera que se esta probando ("Parrilla", "Cuentas · Terraza"). Sale impreso para que, con cuatro pruebas en la mano, se sepa cual es cual.';

alter table "public"."print_jobs"
  drop constraint if exists "print_jobs_kind_check";
alter table "public"."print_jobs"
  add constraint "print_jobs_kind_check"
  check ("kind" = any (array['control'::text, 'cuenta'::text, 'factura'::text, 'cierre'::text, 'prueba'::text]));

-- Cada kind sigue teniendo que apuntar a algo: la prueba, a su IP. Sin esta
-- rama el insert revienta con 23514 (es lo que le pasó al cierre en la 0064).
alter table "public"."print_jobs"
  drop constraint if exists "print_jobs_target_check";
alter table "public"."print_jobs"
  add constraint "print_jobs_target_check"
  check (
    ("kind" = any (array['control'::text, 'cuenta'::text]) and "order_id" is not null)
    or ("kind" = 'factura'::text and "invoice_id" is not null)
    or ("kind" = 'cierre'::text  and "corte_id"   is not null)
    or ("kind" = 'prueba'::text  and "test_printer_ip" is not null)
  );

comment on column "public"."print_jobs"."kind" is
  'control = uno por orden, lo emite la marcha a cocina. cuenta = las veces que la mesa la pida. factura = copia impresa de un comprobante autorizado. cierre = el papel del corte de caja. prueba = papel de prueba de una comandera (spec 176).';

-- El agente ya manda el motivo del fallo en el POST (`error`) y hasta ahora se
-- descartaba: sólo quedaba el timestamp de `print_failed_at`. Para la prueba, el
-- motivo ES el resultado — «connect ECONNREFUSED 192.168.10.51:9100» le dice al
-- encargado que erró la IP; un `print_failed_at` solo, no.
alter table "public"."print_jobs"
  add column if not exists "last_error" text;

comment on column "public"."print_jobs"."last_error" is
  'Ultimo motivo de fallo reportado por el print-agent. Se limpia al imprimir bien.';
