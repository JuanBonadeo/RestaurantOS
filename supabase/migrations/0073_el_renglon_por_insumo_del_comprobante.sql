-- 0073 · El renglón por insumo del comprobante (issue #245, spec 165)
--
-- Es la pieza raíz que la 158 dejó afuera: **sin ella el stock sólo baja y el
-- costo nunca se actualiza**. Medido en la nube antes de esta migración:
--
--     ingredient_price_log      0 filas en los tres negocios
--     consumptions kind='compra' 0 filas — ni el ingreso manual se usó nunca
--     ingresarStockCocina        escribe cost_cents_snapshot: 0
--     golf-jcr                   230 consumos 'venta', 19 'reversion',
--                                y 7 insumos YA EN NEGATIVO (mínimo −13)
--
-- MaxiRest hace exactamente esto, y está probado con aritmética sobre el backup:
-- `mxstk.compras` matchea la línea de compra de `mxitc` por insumo+fecha en
-- **1.481 de 1.481 filas**, con la cantidad idéntica al tercer decimal — o sea
-- **el comprobante ES el movimiento de stock**. Y `mxinspre` (histórico de
-- precio) coincide con una línea de compra del mismo insumo, misma fecha y mismo
-- precio en **811 de 999 filas**: la compra reescribe el costo. Su ayuda
-- (módulos 45, 65 y 135) lo dice: procesar el comprobante dispara «Alta de
-- stock», y «con el procesamiento de las compras de insumos, el sistema
-- actualiza el campo Precio y Precio Promedio en cada insumo procesado».
--
-- ── Dos decisiones que salen de los datos ─────────────────────────────────
--
-- **Las líneas son OPT-IN.** Con detalle por insumo real (`cod_ins > 0`) son
-- 366 comprobantes: 242/3.677 en 2025 (6,6%) y 124/1.502 en 2026 (8,3%). El 92%
-- se sigue cargando como concepto de gasto, y la ayuda de MaxiRest bendice ese
-- camino («si no desea ingresar el detalle… puede ingresar facturas a través del
-- botón Agregar Concepto»). Pero no es un resto: hay **cero líneas con insumo
-- antes del 2025-09-10** y desde ahí 25-45 comprobantes por mes sin parar, sobre
-- 247 insumos en 2025 y 156 en 2026. El Golf empezó a itemizar hace un año.
--
-- **NO se enforcea Σ renglones = total.** En 2026 sólo 585 de 1.502 comprobantes
-- cuadran exacto. Un CHECK que lo exigiera haría imposible cargar la mayoría de
-- los comprobantes reales.

-- ── 1 · la tabla ──────────────────────────────────────────────────────────
create table if not exists public.supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- CASCADE y no RESTRICT: la línea no tiene vida propia. Un comprobante no se
  -- borra (se anula), así que esto sólo corre si alguien limpia el negocio.
  invoice_id uuid not null references public.supplier_invoices(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  -- La presentación dice cuántas unidades base trae un envase. Se guarda cuál
  -- era: si mañana le cambian el `net_quantity`, la línea vieja no se reescribe.
  presentation_id uuid references public.ingredient_presentations(id) on delete set null,
  units numeric(14,3) not null check (units > 0),
  /** Unidades base que entraron = units × net_quantity al momento de la compra. */
  quantity_base numeric(14,3) not null check (quantity_base > 0),
  /** Lo que costó UN envase en esta compra. Es el precio que se propaga al insumo. */
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists supplier_invoice_items_invoice_idx
  on public.supplier_invoice_items (invoice_id);
create index if not exists supplier_invoice_items_ingredient_idx
  on public.supplier_invoice_items (business_id, ingredient_id);

comment on table public.supplier_invoice_items is
  'Spec 165 · el detalle por insumo de un comprobante de compra. Opt-in: el 92% de los comprobantes del Golf se cargan sólo con concepto de gasto.';

alter table public.supplier_invoice_items enable row level security;

-- Manager, igual que el resto del módulo desde la 0068 (issue #247).
drop policy if exists supplier_invoice_items_select on public.supplier_invoice_items;
create policy supplier_invoice_items_select on public.supplier_invoice_items
  for select to authenticated using (public.is_business_manager(business_id));

drop policy if exists supplier_invoice_items_insert on public.supplier_invoice_items;
create policy supplier_invoice_items_insert on public.supplier_invoice_items
  for insert to authenticated with check (public.is_business_manager(business_id));

drop policy if exists supplier_invoice_items_delete on public.supplier_invoice_items;
create policy supplier_invoice_items_delete on public.supplier_invoice_items
  for delete to authenticated using (public.is_business_manager(business_id));

-- ── 2 · cargar los renglones ──────────────────────────────────────────────
--
-- Una RPC y no cuatro escrituras sueltas, por la misma razón que la spec 161·D4:
-- cada renglón toca la línea, el stock del insumo, su consumo y su precio. Un
-- fallo a mitad deja stock sumado sin rastro, o precio nuevo sin mercadería.
create or replace function public.registrar_items_comprobante_tx(
  p_business_id uuid,
  p_invoice_id  uuid,
  p_created_by  uuid,
  p_items       jsonb   -- [{ingredient_id, presentation_id, units, unit_cost_cents}]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it        jsonb;
  v_ing       uuid;
  v_pres      uuid;
  v_units     numeric;
  v_costo     bigint;
  v_neto      numeric;
  v_base      numeric;
  v_n         integer := 0;
begin
  -- El comprobante tiene que ser de este negocio y estar vivo.
  perform 1 from supplier_invoices
   where id = p_invoice_id and business_id = p_business_id and cancelled_at is null;
  if not found then
    raise exception 'COMPROBANTE_NO_DISPONIBLE';
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_ing   := (v_it ->> 'ingredient_id')::uuid;
    v_pres  := nullif(v_it ->> 'presentation_id', '')::uuid;
    v_units := (v_it ->> 'units')::numeric;
    v_costo := (v_it ->> 'unit_cost_cents')::bigint;

    -- Tenant del insumo: el service client bypassa RLS y el FK sólo chequea
    -- existencia, no negocio.
    perform 1 from ingredients
     where id = v_ing and business_id = p_business_id for update;
    if not found then
      raise exception 'INSUMO_DE_OTRO_NEGOCIO' using detail = v_ing::text;
    end if;

    -- Cuántas unidades base entran. Sin presentación, `units` ya viene en base.
    v_neto := 1;
    if v_pres is not null then
      select net_quantity into v_neto
        from ingredient_presentations
       where id = v_pres and ingredient_id = v_ing;
      if v_neto is null then
        raise exception 'PRESENTACION_INVALIDA' using detail = v_pres::text;
      end if;
    end if;
    v_base := v_units * v_neto;

    insert into supplier_invoice_items (
      business_id, invoice_id, ingredient_id, presentation_id,
      units, quantity_base, unit_cost_cents, created_by
    ) values (
      p_business_id, p_invoice_id, v_ing, v_pres,
      v_units, v_base, v_costo, p_created_by
    );

    -- Alta de stock.
    update ingredients
       set stock_quantity = stock_quantity + v_base,
           updated_at = now()
     where id = v_ing;

    -- El consumo, con el costo REAL — `ingresarStockCocina` escribe 0 acá.
    insert into ingredient_consumptions (
      business_id, ingredient_id, quantity, cost_cents_snapshot, kind
    ) values (
      p_business_id, v_ing, v_base,
      case when v_base > 0 then round(v_costo / v_neto) else 0 end,
      'compra'
    );

    -- La compra reescribe el costo del envase. El trigger
    -- `trg_ingredient_price_change` llena el histórico solo.
    if v_pres is not null and v_costo > 0 then
      update ingredient_presentations
         set cost_cents = v_costo
       where id = v_pres and cost_cents <> v_costo;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.registrar_items_comprobante_tx is
  'Spec 165 · carga los renglones de un comprobante: línea + alta de stock + consumo con costo real + precio del insumo, en UNA transacción.';

-- ── 3 · revertir al anular ────────────────────────────────────────────────
--
-- Anular el comprobante devuelve la mercadería que nunca entró. **El precio NO
-- se revierte**: es un hecho histórico —el proveedor cobró eso— y el
-- `ingredient_price_log` ya lo registró. Deshacerlo reescribiría el histórico
-- para que diga que un precio que existió no existió.
create or replace function public.revertir_items_comprobante_tx(
  p_business_id uuid,
  p_invoice_id  uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it record;
  v_n  integer := 0;
begin
  for v_it in
    select ingredient_id, quantity_base
      from supplier_invoice_items
     where invoice_id = p_invoice_id and business_id = p_business_id
     for update
  loop
    update ingredients
       set stock_quantity = stock_quantity - v_it.quantity_base,
           updated_at = now()
     where id = v_it.ingredient_id;

    -- La reversión se registra, no se borra el consumo: un movimiento que
    -- desaparece es un movimiento que nadie audita (misma regla que la 070).
    insert into ingredient_consumptions (
      business_id, ingredient_id, quantity, cost_cents_snapshot, kind
    ) values (
      p_business_id, v_it.ingredient_id, -v_it.quantity_base, 0, 'reversion'
    );

    v_n := v_n + 1;
  end loop;

  delete from supplier_invoice_items
   where invoice_id = p_invoice_id and business_id = p_business_id;

  return v_n;
end;
$$;

comment on function public.revertir_items_comprobante_tx is
  'Spec 165 · al anular un comprobante, devuelve el stock que sus renglones habían dado de alta. El precio NO se revierte: es histórico.';

grant execute on function public.registrar_items_comprobante_tx(uuid, uuid, uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.revertir_items_comprobante_tx(uuid, uuid)
  to authenticated, service_role;
