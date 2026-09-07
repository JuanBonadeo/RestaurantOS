-- 0068 · Proveedores es plata: sólo admin y encargado (issue #247)
--
-- Las seis tablas del módulo de proveedores tienen sus policies en
-- `is_business_member(business_id)`, que incluye mozo, terminal y personal. La
-- issue lo reportó como un problema de LECTURA a futuro ("el día que carguen
-- sueldos por el proveedor virtual, los lee todo el personal"). Medido contra
-- este mismo cloud con el JWT real de un mozo de `demo`, el agujero es de
-- ESCRITURA y es de hoy:
--
--     SELECT supplier_invoices          PASA
--     SELECT supplier_payments          PASA
--     INSERT suppliers                  PASA  ← creó el proveedor
--     UPDATE supplier_invoices          PASA  ← 2 comprobantes
--     UPDATE supplier_payments          PASA  ← 4 pagos
--     DELETE supplier_invoices          PASA  (sin imputaciones)
--     DELETE expense_concepts           PASA  ← los 31 del seed, de una
--
-- Un mozo borra el catálogo de conceptos de gasto del negocio entero con una
-- llamada a PostgREST y su propio token, y con él se lleva puesto el informe de
-- la spec 158 y la precarga de la #243. No hace falta ningún privilegio: el
-- `DELETE` de comprobantes que falló, falló por un FK, no por la RLS.
--
-- Usuarios activos que hoy tienen esa llave: golf-jcr 35 de 42 (18 mozos + 16
-- personal + 1 terminal), kcc 49 de 50, demo 6 de 9.
--
-- POR QUÉ ES DE RIESGO CERO PARA EL CAMINO FELIZ: las seis tablas se tocan
-- únicamente desde `src/lib/proveedores/`, y los cuatro archivos resuelven su
-- cliente con `createSupabaseServiceClient()` (`db()`), que bypassea RLS. El
-- único consumidor fuera del módulo es `admin/(authed)/proveedores/page.tsx`.
-- Ninguna superficie de mozo, cocina o terminal lee estas tablas. La RLS acá no
-- gobierna ningún camino de la app: es exclusivamente la puerta del POST
-- directo, que es justo la que hay que cerrar.
--
-- `is_business_manager` (0019) = admin + encargado + platform admin, que es
-- exactamente `canManageProveedores` de `can.ts`. No hace falta helper nuevo.

-- ── 1 · las seis tablas, las cuatro operaciones ─────────────────────────────
--
-- Se reescriben con drop+create y no con `alter policy` (0019) para que la
-- migración sea idempotente y no dependa de que cada policy exista con el
-- nombre esperado: `supplier_payments` no tiene DELETE y
-- `supplier_payment_allocations` no tiene UPDATE — esos dos huecos quedan como
-- están, denegados por ausencia de policy, que es más restrictivo que
-- cualquier cosa que pudiéramos escribir acá.

-- suppliers ────────────────────────────────────────────────────────────────
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (public.is_business_manager(business_id));

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (public.is_business_manager(business_id));

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (public.is_business_manager(business_id));

-- supplier_invoices ────────────────────────────────────────────────────────
drop policy if exists supplier_invoices_select on public.supplier_invoices;
create policy supplier_invoices_select on public.supplier_invoices
  for select to authenticated
  using (public.is_business_manager(business_id));

drop policy if exists supplier_invoices_insert on public.supplier_invoices;
create policy supplier_invoices_insert on public.supplier_invoices
  for insert to authenticated
  with check (public.is_business_manager(business_id));

drop policy if exists supplier_invoices_update on public.supplier_invoices;
create policy supplier_invoices_update on public.supplier_invoices
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

drop policy if exists supplier_invoices_delete on public.supplier_invoices;
create policy supplier_invoices_delete on public.supplier_invoices
  for delete to authenticated
  using (public.is_business_manager(business_id));

-- supplier_payments ────────────────────────────────────────────────────────
-- Sin policy DELETE, a propósito: los pagos no se borran, se anulan
-- (`anularPagoProveedor` marca `cancelled_at`). Ausencia de policy = denegado.
drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated
  using (public.is_business_manager(business_id));

drop policy if exists supplier_payments_insert on public.supplier_payments;
create policy supplier_payments_insert on public.supplier_payments
  for insert to authenticated
  with check (public.is_business_manager(business_id));

drop policy if exists supplier_payments_update on public.supplier_payments;
create policy supplier_payments_update on public.supplier_payments
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

-- supplier_payment_allocations ─────────────────────────────────────────────
-- Sin policy UPDATE, a propósito: una imputación no se edita, se borra y se
-- rehace (`repartirPago`). Ausencia de policy = denegado.
drop policy if exists spa_select on public.supplier_payment_allocations;
create policy spa_select on public.supplier_payment_allocations
  for select to authenticated
  using (public.is_business_manager(business_id));

drop policy if exists spa_insert on public.supplier_payment_allocations;
create policy spa_insert on public.supplier_payment_allocations
  for insert to authenticated
  with check (public.is_business_manager(business_id));

drop policy if exists spa_delete on public.supplier_payment_allocations;
create policy spa_delete on public.supplier_payment_allocations
  for delete to authenticated
  using (public.is_business_manager(business_id));

-- expense_concepts ─────────────────────────────────────────────────────────
-- El catálogo que un mozo podía vaciar entero. Es la tabla que sostiene el
-- informe por concepto de la 158 y la precarga por proveedor de la #243.
drop policy if exists expense_concepts_select on public.expense_concepts;
create policy expense_concepts_select on public.expense_concepts
  for select to authenticated
  using (public.is_business_manager(business_id));

drop policy if exists expense_concepts_insert on public.expense_concepts;
create policy expense_concepts_insert on public.expense_concepts
  for insert to authenticated
  with check (public.is_business_manager(business_id));

drop policy if exists expense_concepts_update on public.expense_concepts;
create policy expense_concepts_update on public.expense_concepts
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

drop policy if exists expense_concepts_delete on public.expense_concepts;
create policy expense_concepts_delete on public.expense_concepts
  for delete to authenticated
  using (public.is_business_manager(business_id));

-- supplier_ingredients ─────────────────────────────────────────────────────
-- El vínculo insumo↔proveedor: expone qué le compra el negocio a quién y a qué
-- precio de referencia. SELECT/INSERT/DELETE estaban en member.
--
-- `supplier_ingredients_update` NO se toca: hoy está en `is_platform_admin()`,
-- que es MÁS restrictivo que manager. Una migración de seguridad no afloja una
-- policy de paso. Queda la asimetría (el manager inserta y borra pero no
-- actualiza) que hoy es inocua porque el módulo escribe con service role.
drop policy if exists supplier_ingredients_select on public.supplier_ingredients;
create policy supplier_ingredients_select on public.supplier_ingredients
  for select to authenticated
  using (public.is_business_manager(business_id));

drop policy if exists supplier_ingredients_insert on public.supplier_ingredients;
create policy supplier_ingredients_insert on public.supplier_ingredients
  for insert to authenticated
  with check (public.is_business_manager(business_id));

drop policy if exists supplier_ingredients_delete on public.supplier_ingredients;
create policy supplier_ingredients_delete on public.supplier_ingredients
  for delete to authenticated
  using (public.is_business_manager(business_id));

-- ── 2 · la migración se verifica a sí misma ────────────────────────────────
--
-- Que la 0067 abortara sola cuando retipeé mal una firma es la razón de que
-- este bloque exista. Si alguna policy del módulo quedó en `is_business_member`
-- —porque se agregó una tabla nueva, porque alguien la recreó después, o porque
-- me olvidé una acá arriba— la migración falla entera en vez de mentir que
-- cerró la puerta.
do $$
declare
  v_flojas text;
begin
  select string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', ' order by tablename, policyname)
    into v_flojas
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'suppliers', 'supplier_invoices', 'supplier_payments',
      'supplier_payment_allocations', 'expense_concepts', 'supplier_ingredients'
    )
    and (
      coalesce(qual::text, '') like '%is_business_member%'
      or coalesce(with_check::text, '') like '%is_business_member%'
    );

  if v_flojas is not null then
    raise exception 'PROVEEDORES: quedaron policies con is_business_member → %', v_flojas;
  end if;
end $$;
