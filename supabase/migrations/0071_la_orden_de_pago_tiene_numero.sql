-- 0071 · La orden de pago tiene número (issue #246, spec 163)
--
-- Guardamos un UUID y `armarLibroProveedor` renderiza «Efectivo + fecha +
-- monto»: **dos pagos en efectivo del mismo monto el mismo día son
-- indistinguibles** en la ficha, en el libro y por teléfono.
--
-- MaxiRest numera: 14.539 órdenes correlativas, 1.864 en los últimos 12 meses
-- = 8,9 por día. El precedente exacto es `caja_cortes.numero` (0063, spec 139 ·
-- D14): *«correlativo por negocio, para poder nombrar el cierre por teléfono»*.
-- El mismo argumento vale para una orden de pago, que es el papel que el
-- proveedor se lleva.
--
-- Lo que NO se porta es la pantalla del módulo 38 de MaxiRest: consultar ya lo
-- hace la ficha de la 159 y anular ya está. Y el argumento de que «el número es
-- la única forma de agrupar el acto de pago» es falso — agrupando bien, las
-- 1.864 órdenes del último año agrupan **exactamente un comprobante cada una**,
-- y nosotros ya agrupamos con `supplier_payment_allocations`.
--
-- Backfill: cero. `supplier_payments` tiene 4 filas en `demo` y ninguna en los
-- negocios reales.

alter table public.supplier_payments
  add column if not exists numero integer;

comment on column public.supplier_payments.numero is
  'Spec 163 · correlativo por negocio de la orden de pago. Para poder nombrarla por teléfono: un UUID no se canta.';

-- Correlativo por negocio. Parcial, como el de `caja_cortes`: si alguna fila
-- quedara en NULL, no choca.
create unique index if not exists supplier_payments_numero_uniq
  on public.supplier_payments (business_id, numero)
  where numero is not null;

-- El mismo patrón a prueba de carreras que `set_order_number` (0001:601): el
-- advisory lock por negocio serializa dos pagos simultáneos, y se libera solo al
-- terminar la transacción. Sin él, dos encargados pagando a la vez sacan el
-- mismo número y uno de los dos INSERT falla contra el índice único.
create or replace function public.set_supplier_payment_numero()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  lock_key bigint;
begin
  if new.numero is null then
    -- Distinto de la clave de `orders` para no serializar cobros contra pagos a
    -- proveedor, que no tienen nada que ver entre sí.
    lock_key := hashtextextended('supplier_payments:' || new.business_id::text, 0);
    perform pg_advisory_xact_lock(lock_key);

    select coalesce(max(numero), 0) + 1
      into new.numero
      from public.supplier_payments
     where business_id = new.business_id;
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_payments_set_numero on public.supplier_payments;
create trigger supplier_payments_set_numero
  before insert on public.supplier_payments
  for each row execute function public.set_supplier_payment_numero();
