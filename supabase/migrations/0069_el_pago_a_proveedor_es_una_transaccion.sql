-- 0069 · El pago a proveedor es UNA transacción (spec 161 · D4)
--
-- `registrarPagoProveedor` hace tres escrituras de plata en secuencia —sangría,
-- pago, imputaciones— y sólo la segunda revierte algo. Si falla la tercera:
--
--     console.error(...)  →  return actionOk(...)
--
-- o sea **devuelve OK**. La caja quedó con la plata de menos, el saldo del
-- proveedor bajó, el comprobante sigue impago en las tres pantallas de la 159, y
-- el usuario leyó «Pago registrado.». Nadie se entera hasta el arqueo.
--
-- El repo ya resolvió esto para el cobro: `registrar_pago_tx` (0007, issue #58).
-- Acá es peor, porque la primera escritura mueve efectivo de una caja.
--
-- Idempotencia NO entra (D4): la 0007 la necesitaba porque el cobro se dispara
-- desde un botón en hora pico y el doble-submit estaba medido. El pago a
-- proveedor se carga desde el panel, de a uno, y no hay ningún caso reportado.

create or replace function public.registrar_pago_proveedor_tx(
  p_business_id   uuid,
  p_supplier_id   uuid,
  p_amount_cents  bigint,
  p_method        text,
  p_paid_at       date,
  p_notes         text,
  p_created_by    uuid,
  p_caja_id       uuid,                    -- null si no es efectivo
  p_caja_reason   text,                    -- "Pago a proveedor · <nombre>"
  p_imputaciones  jsonb default '[]'::jsonb -- [{invoice_id, amount_cents}]
)
returns table (
  payment_id          uuid,
  caja_movimiento_id  uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov_id     uuid;
  v_payment_id uuid;
  v_imp        jsonb;
  v_invoice_id uuid;
  v_monto      bigint;
  v_total      bigint;
  v_ya         bigint;
begin
  -- ── el egreso de caja, si sale efectivo ──
  --
  -- spec 160 · va SIEMPRE a la caja administrativa, y la resuelve el server. El
  -- kind sigue siendo `sangria` y no uno propio: el arqueo resta filtrando ese
  -- valor literal (158 · D5). Lo que la 160 cambió es la caja, no el kind.
  if p_caja_id is not null then
    insert into caja_movimientos (caja_id, business_id, kind, amount_cents, reason, created_by)
    values (p_caja_id, p_business_id, 'sangria', p_amount_cents, p_caja_reason, p_created_by)
    returning id into v_mov_id;
  end if;

  -- ── el pago ──
  insert into supplier_payments (
    business_id, supplier_id, amount_cents, method,
    caja_id, caja_movimiento_id, paid_at, notes, created_by
  )
  values (
    p_business_id, p_supplier_id, p_amount_cents, p_method,
    p_caja_id, v_mov_id, coalesce(p_paid_at, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    p_notes, p_created_by
  )
  returning id into v_payment_id;

  -- ── las imputaciones ──
  --
  -- El reparto lo calcula `repartirPago` en TS, que es una función pura con
  -- tests: no se duplica acá. Lo que SÍ se valida es lo que sólo la base puede
  -- garantizar dentro de la transacción — que entre el cálculo y esta escritura
  -- no haya entrado otro pago que deje al comprobante sobre-imputado. Es la
  -- carrera que el camino de tres escrituras no podía ver.
  for v_imp in select * from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb))
  loop
    v_invoice_id := (v_imp ->> 'invoice_id')::uuid;
    v_monto      := (v_imp ->> 'amount_cents')::bigint;

    -- FOR UPDATE: serializa contra otro pago al mismo comprobante.
    select total_cents into v_total
      from supplier_invoices
     where id = v_invoice_id and business_id = p_business_id
       and cancelled_at is null
     for update;

    if v_total is null then
      raise exception 'COMPROBANTE_NO_DISPONIBLE'
        using detail = 'El comprobante no existe, es de otro negocio o está anulado: ' || v_invoice_id;
    end if;

    select coalesce(sum(a.amount_cents), 0) into v_ya
      from supplier_payment_allocations a
      join supplier_payments p on p.id = a.payment_id
     where a.invoice_id = v_invoice_id
       and p.cancelled_at is null
       and p.id <> v_payment_id;

    if v_ya + v_monto > v_total then
      raise exception 'COMPROBANTE_SOBRE_IMPUTADO'
        using detail = 'Otro pago se imputó a este comprobante mientras se cargaba éste: ' || v_invoice_id;
    end if;

    insert into supplier_payment_allocations (business_id, payment_id, invoice_id, amount_cents)
    values (p_business_id, v_payment_id, v_invoice_id, v_monto);
  end loop;

  return query select v_payment_id, v_mov_id;
end;
$$;

comment on function public.registrar_pago_proveedor_tx is
  'Spec 161 · D4 — sangría + pago + imputaciones en UNA transacción. Antes eran tres escrituras sueltas y un fallo en la tercera devolvía OK con la caja descuadrada.';

-- `authenticated` no la necesita: la action corre con service role, igual que
-- todo el módulo. Se concede igual por simetría con `registrar_pago_tx` (0007) —
-- y la RLS de la 0068 ya limita quién puede tocar estas tablas.
grant execute on function public.registrar_pago_proveedor_tx(
  uuid, uuid, bigint, text, date, text, uuid, uuid, text, jsonb
) to authenticated, service_role;
