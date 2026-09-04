-- 0066 · Comprar y pagarle al proveedor (spec 158)
--
-- Hasta acá `supplier_invoices` guardaba número, fecha, total y foto: alcanza
-- para "cuánto le compré", no para "cuánto le debo" ni "en qué se fue la plata".
-- Esta migración agrega las tres piezas que MaxiRest usa todos los días y que el
-- Golf tiene con 20.767 comprobantes encima: el CONCEPTO DE GASTO, el
-- VENCIMIENTO y el PAGO.
--
-- El saldo se DERIVA, igual que el de clientes de la spec 141 (D3):
--   saldo = Σ supplier_invoices vivos − Σ supplier_payments vivos
-- No hay columna `saldo` ni libro de asientos: la única forma de que un saldo
-- mienta es que tenga dos fuentes.

-- ── 1 · conceptos de gasto ──────────────────────────────────────────────────
--
-- MaxiRest los parte en dos tablas: rubro (`mxrga`, 8 filas) y concepto
-- (`mxcga`, 67). Acá el rubro es una columna (D1): dos tablas para agrupar ocho
-- valores es sobre-modelar. Los 8 rubros son los del Golf, que cubren tanto la
-- mercadería como el gasto de estructura.
create table if not exists public.expense_concepts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  rubro text not null check (rubro in (
    'mercaderias', 'servicios', 'mantenimiento', 'personal',
    'impuestos', 'vajilla', 'societarios', 'otros'
  )),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create index if not exists expense_concepts_business_idx
  on public.expense_concepts (business_id, rubro, name);

alter table public.expense_concepts enable row level security;

drop policy if exists expense_concepts_select on public.expense_concepts;
create policy expense_concepts_select on public.expense_concepts
  for select to authenticated
  using (is_business_member(business_id) or is_platform_admin());

drop policy if exists expense_concepts_insert on public.expense_concepts;
create policy expense_concepts_insert on public.expense_concepts
  for insert to authenticated
  with check (is_business_member(business_id) or is_platform_admin());

drop policy if exists expense_concepts_update on public.expense_concepts;
create policy expense_concepts_update on public.expense_concepts
  for update to authenticated
  using (is_business_member(business_id) or is_platform_admin())
  with check (is_business_member(business_id) or is_platform_admin());

drop policy if exists expense_concepts_delete on public.expense_concepts;
create policy expense_concepts_delete on public.expense_concepts
  for delete to authenticated
  using (is_business_member(business_id) or is_platform_admin());

-- ── 2 · el proveedor precarga la compra ─────────────────────────────────────
--
-- `default_expense_concept_id` es el `cod_cga` de `mxpro` y `payment_terms_days`
-- es su `dias_venc`. Con los dos, cargar la compra de la verdulería no obliga a
-- elegir "Verdulería" ni a calcular el vencimiento a mano — que es la diferencia
-- entre 10 comprobantes por día y 10 comprobantes por día con fricción.
alter table public.suppliers
  add column if not exists default_expense_concept_id uuid
    references public.expense_concepts(id) on delete set null,
  add column if not exists payment_terms_days integer not null default 0
    check (payment_terms_days >= 0);

-- ── 3 · el comprobante crece ────────────────────────────────────────────────
alter table public.supplier_invoices
  add column if not exists expense_concept_id uuid
    references public.expense_concepts(id) on delete set null,
  -- 'interno' es el `Z` de MaxiRest: la compra diaria sin factura. Es el 36% de
  -- los comprobantes del Golf, así que es el DEFAULT — el caso frecuente no
  -- puede ser el que hay que elegir a mano.
  add column if not exists document_type text not null default 'interno',
  add column if not exists due_date date,
  -- Nunca se borra: se anula con motivo, como un movimiento de caja (spec 070).
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_reason text;

alter table public.supplier_invoices drop constraint if exists supplier_invoices_document_type_check;
alter table public.supplier_invoices add constraint supplier_invoices_document_type_check
  check (document_type in (
    'factura_a', 'factura_b', 'factura_c',
    'nota_credito', 'nota_debito', 'remito', 'ticket', 'interno'
  ));

-- La nota de crédito es un comprobante con total NEGATIVO (D4). Es lo que hace
-- MaxiRest (`+`/`N` con importe negativo) y es lo que permite que el saldo
-- derivado funcione sin un caso especial: una NC resta sola.
alter table public.supplier_invoices drop constraint if exists supplier_invoices_total_cents_check;
alter table public.supplier_invoices add constraint supplier_invoices_total_signo_coherente
  check (
    case when document_type in ('nota_credito') then total_cents <= 0
         else total_cents >= 0 end
  );

create index if not exists supplier_invoices_vencimiento_idx
  on public.supplier_invoices (business_id, due_date)
  where cancelled_at is null;

create index if not exists supplier_invoices_concepto_idx
  on public.supplier_invoices (business_id, expense_concept_id, invoice_date);

-- ── 4 · el pago ─────────────────────────────────────────────────────────────
--
-- Espejo exacto de `customer_credit_settlements` (spec 141), con el signo dado
-- vuelta: allá entra plata al cajón, acá sale. Y como allá, el movimiento de
-- caja se escribe SÓLO cuando el medio es efectivo (D6) — la transferencia baja
-- la deuda sin tocar el cajón.
--
-- El `kind` de ese movimiento es `'sangria'`, NO uno nuevo (D5): el arqueo
-- (`calculateExpectedCash`) resta filtrando `kind = 'sangria'` explícito, así
-- que un kind propio saldría de la caja sin bajar el efectivo esperado. La
-- trazabilidad la da `caja_movimiento_id`, no el kind.
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- RESTRICT y no CASCADE: borrar un proveedor con pagos registrados borraría el
  -- rastro de plata que salió del cajón. Que falle y se resuelva a mano.
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  paid_at date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'transfer', 'card_manual', 'other')),
  caja_id uuid references public.cajas(id),
  caja_movimiento_id uuid references public.caja_movimientos(id),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_reason text,
  -- Un pago en efectivo sin caja no se puede arquear, y uno que no es en
  -- efectivo no tiene por qué tenerla. Sin este check el egreso se pierde.
  constraint supplier_payments_caja_coherente
    check ((method = 'cash') = (caja_id is not null))
);

create index if not exists supplier_payments_business_supplier_idx
  on public.supplier_payments (business_id, supplier_id, paid_at desc);

alter table public.supplier_payments enable row level security;

drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated
  using (is_business_member(business_id) or is_platform_admin());

drop policy if exists supplier_payments_insert on public.supplier_payments;
create policy supplier_payments_insert on public.supplier_payments
  for insert to authenticated
  with check (is_business_member(business_id) or is_platform_admin());

drop policy if exists supplier_payments_update on public.supplier_payments;
create policy supplier_payments_update on public.supplier_payments
  for update to authenticated
  using (is_business_member(business_id) or is_platform_admin())
  with check (is_business_member(business_id) or is_platform_admin());

-- ── 5 · a qué comprobantes se imputa ────────────────────────────────────────
--
-- Sin filas = PAGO A CUENTA (el "pago a cuenta" de MaxiRest). Es un pago válido:
-- el proveedor cobra antes de facturar y el saldo queda a favor.
create table if not exists public.supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_id uuid not null references public.supplier_payments(id) on delete cascade,
  invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  -- Un pago no se imputa dos veces al mismo comprobante: si hay que corregir el
  -- monto, se corrige la fila, no se agrega otra.
  unique (payment_id, invoice_id)
);

create index if not exists spa_invoice_idx
  on public.supplier_payment_allocations (invoice_id);

alter table public.supplier_payment_allocations enable row level security;

drop policy if exists spa_select on public.supplier_payment_allocations;
create policy spa_select on public.supplier_payment_allocations
  for select to authenticated
  using (is_business_member(business_id) or is_platform_admin());

drop policy if exists spa_insert on public.supplier_payment_allocations;
create policy spa_insert on public.supplier_payment_allocations
  for insert to authenticated
  with check (is_business_member(business_id) or is_platform_admin());

drop policy if exists spa_delete on public.supplier_payment_allocations;
create policy spa_delete on public.supplier_payment_allocations
  for delete to authenticated
  using (is_business_member(business_id) or is_platform_admin());

-- ── 6 · conceptos base ──────────────────────────────────────────────────────
--
-- Los nombres salen de los 67 conceptos reales del Golf, podados a los que
-- aparecen en cualquier restaurante. El local agrega los suyos; lo que importa
-- es que la primera compra ya tenga dónde imputarse — un desplegable vacío es
-- la forma más rápida de que nadie use el campo.
--
-- Una sola función para las dos puertas (el trigger de alta y el backfill de
-- abajo), copiando el patrón de `ensure_default_super_categories` del baseline.
create or replace function public.seed_expense_concepts(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.expense_concepts (business_id, name, rubro)
  select p_business_id, c.name, c.rubro
  from (values
    ('Carnes', 'mercaderias'), ('Verdulería', 'mercaderias'),
    ('Panadería', 'mercaderias'), ('Pescados', 'mercaderias'),
    ('Pollo y huevos', 'mercaderias'), ('Lácteos', 'mercaderias'),
    ('Quesos y fiambres', 'mercaderias'), ('Almacén', 'mercaderias'),
    ('Bebidas sin alcohol', 'mercaderias'), ('Bebidas con alcohol', 'mercaderias'),
    ('Vinos', 'mercaderias'), ('Cafetería', 'mercaderias'),
    ('Energía eléctrica', 'servicios'), ('Gas', 'servicios'),
    ('Agua', 'servicios'), ('Internet', 'servicios'),
    ('Telefonía', 'servicios'),
    ('Elementos de limpieza', 'mantenimiento'), ('Ferretería', 'mantenimiento'),
    ('Mantenimiento de instalaciones', 'mantenimiento'),
    ('Reparación de maquinarias', 'mantenimiento'),
    ('Útiles de trabajo', 'mantenimiento'), ('Ropa de trabajo', 'mantenimiento'),
    ('Sueldos', 'personal'), ('Adelantos', 'personal'),
    ('Cargas sociales', 'impuestos'), ('Ingresos brutos', 'impuestos'),
    ('Cristalería', 'vajilla'), ('Mantelería', 'vajilla'),
    ('Descartables', 'otros'), ('Gastos varios', 'otros')
  ) as c(name, rubro)
  on conflict (business_id, name) do nothing;
end;
$$;

create or replace function public.ensure_default_expense_concepts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_expense_concepts(new.id);
  return new;
end;
$$;

drop trigger if exists expense_concepts_seed_on_business on public.businesses;
create trigger expense_concepts_seed_on_business
  after insert on public.businesses
  for each row execute function public.ensure_default_expense_concepts();

-- Backfill de los negocios que ya existen.
select public.seed_expense_concepts(id) from public.businesses;

comment on table public.expense_concepts is
  'Concepto de gasto de una compra (spec 158). Equivale a mxcga+mxrga de MaxiRest, con el rubro como columna.';
comment on table public.supplier_payments is
  'Orden de pago a proveedor (spec 158). Espejo de customer_credit_settlements: si method=cash escribe una sangría en caja_movimientos.';
comment on table public.supplier_payment_allocations is
  'Imputación de un pago a comprobantes. Sin filas = pago a cuenta.';
