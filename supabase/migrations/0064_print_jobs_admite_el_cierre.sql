-- Spec 139 · Parte B — `print_jobs` admite el papel del cierre.
--
-- La 0063 agregó `corte_id` y puso a `cerrar_caja_tx` a encolar un job con
-- `kind='cierre'`, pero la tabla tiene dos CHECK que no lo conocían:
--
--   print_jobs_kind_check    → kind in ('control','cuenta','factura')
--   print_jobs_target_check  → cada kind tiene que traer SU foreign key
--
-- Sin esto el insert revienta con 23514 y, como vive adentro de
-- `cerrar_caja_tx`, **se lleva puesta la transacción entera**: el cierre de caja
-- falla. No es que salga sin papel — no cierra. Apareció en un ensayo en seco
-- (`do $$ … raise $$`, que revierte) antes de tocar ningún negocio real.
--
-- `print_jobs_target_check` no es burocracia: es lo que impide que exista un
-- papel huérfano, sin nada que imprimir. Se extiende con la rama del cierre en
-- vez de aflojarla.

alter table public.print_jobs
  drop constraint if exists print_jobs_kind_check;
alter table public.print_jobs
  add constraint print_jobs_kind_check
  check (kind = any (array['control'::text, 'cuenta'::text, 'factura'::text, 'cierre'::text]));

alter table public.print_jobs
  drop constraint if exists print_jobs_target_check;
alter table public.print_jobs
  add constraint print_jobs_target_check
  check (
    (kind = any (array['control'::text, 'cuenta'::text]) and order_id is not null)
    or (kind = 'factura'::text and invoice_id is not null)
    or (kind = 'cierre'::text and corte_id is not null)
  );
