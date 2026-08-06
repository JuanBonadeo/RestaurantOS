-- Spec 099 · El inventario puede ir en negativo; cero deja de apagar el producto.
--
-- ## El problema
--
-- Al vender la última unidad de un producto `track_stock`, el trigger de
-- descuento hacía `update products set is_available = false`. El producto
-- **desaparece de la carta y del catálogo del mozo** (los dos filtran
-- `is_available = true`), así que el mozo no puede cargar la cerveza que tiene
-- en la mano.
--
-- En un restaurante el conteo nunca está al día: el ingreso que no se cargó, la
-- botella que volvió, el conteo de hace dos semanas. Contra eso, apagar el
-- producto convierte un dato impreciso en un bloqueo operativo, y encima
-- **pierde la información**: si el stock no puede bajar de cero, el faltante no
-- queda registrado en ningún lado. Con negativo permitido, `-3` dice "se
-- vendieron 3 más de las que el sistema creía" y el próximo ingreso cierra solo:
-- `-3 + 24 = 21`.
--
-- La regla además nunca fue pareja: un producto **con receta** jamás se apagó
-- por quedarse sin insumo. Sólo se apagaban bebidas y kiosko.
--
-- ## Qué cambia
--
-- `products.is_available` pasa a ser **una decisión manual del negocio y nada
-- más**. Ni los triggers ni las server actions la escriben.
--
--   1. `fn_stock_descuento_on_order_item` (0001) — deja de apagar al llegar a 0.
--   2. `fn_stock_delta_on_item_edit` (0042) — ídem, en la corrección de línea.
--   3. `fn_stock_reversion_item` (0089/0039) — deja de **prender** al devolver
--      stock. Es el mismo error espejado: pisaba un apagado manual del
--      encargado. Si nadie apaga solo, nadie tiene que prender solo.
--
-- `stock_items.current_qty` es `integer` sin CHECK, así que el negativo ya era
-- representable: no hace falta tocar el esquema. Lo que faltaba era permitirlo.
--
-- La visibilidad del faltante ya está cubierta: `getLowStockCount` cuenta
-- `current_qty <= min_qty` (un negativo siempre entra) y la grilla pinta en rojo
-- todo lo que esté en cero o menos.

-- ── 1) Venta: descontar y listo ─────────────────────────────────────────────

create or replace function public.fn_stock_descuento_on_order_item()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
as $$
declare
  v_stock_item_id uuid;
  v_business_id uuid;
begin
  if not exists (select 1 from products where id = new.product_id and track_stock = true) then
    return new;
  end if;

  select si.id, si.business_id into v_stock_item_id, v_business_id
    from stock_items si where si.product_id = new.product_id;

  if v_stock_item_id is null then
    return new;
  end if;

  update stock_items
    set current_qty = current_qty - new.quantity,
        updated_at = now()
    where id = v_stock_item_id;

  insert into stock_movimientos (stock_item_id, business_id, kind, qty, order_item_id)
    values (v_stock_item_id, v_business_id, 'venta', -new.quantity, new.id);

  -- Spec 099: el stock puede quedar en negativo. `is_available` es del negocio.
  return new;
end;
$$;

comment on function public.fn_stock_descuento_on_order_item() is
  'Descuenta stock al insertar una línea. Spec 099: puede dejar current_qty en negativo y NO toca products.is_available.';

-- ── 2) Edición de línea: mismo criterio ─────────────────────────────────────

create or replace function public.fn_stock_delta_on_item_edit()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
as $$
declare
  v_business_id uuid;
  r record;
  leaf record;
  v_stock_item_id uuid;
  v_stock_business_id uuid;
begin
  -- Una línea muerta no mueve inventario en ninguna dirección.
  if new.cancelled_at is not null or old.cancelled_at is not null then
    return new;
  end if;

  select o.business_id into v_business_id
    from orders o where o.id = new.order_id;
  if not found then
    return new;
  end if;

  -- ── 1) Devolver lo que consumía la línea vieja ────────────────────────────
  if old.product_id is not null then
    if exists (
      select 1 from products where id = old.product_id and track_stock = true
    ) then
      select si.id, si.business_id into v_stock_item_id, v_stock_business_id
        from stock_items si where si.product_id = old.product_id;
      if v_stock_item_id is not null then
        update stock_items
           set current_qty = current_qty + old.quantity,
               updated_at = now()
         where id = v_stock_item_id;
        insert into stock_movimientos
          (stock_item_id, business_id, kind, qty, order_item_id, reason)
        values
          (v_stock_item_id, v_stock_business_id, 'ajuste', old.quantity,
           old.id, 'Edición de línea: devuelve lo anterior');
      end if;
    else
      for r in
        select rec.ingredient_id, rec.quantity
          from recipes rec where rec.product_id = old.product_id
      loop
        for leaf in
          select * from fn_explode_ingredient(r.ingredient_id, r.quantity * old.quantity)
        loop
          update ingredients
             set stock_quantity = stock_quantity + leaf.leaf_quantity,
                 updated_at = now()
           where id = leaf.leaf_ingredient_id;
          insert into ingredient_consumptions
            (business_id, ingredient_id, order_item_id, quantity, cost_cents_snapshot, kind)
          values (
            v_business_id, leaf.leaf_ingredient_id, old.id, leaf.leaf_quantity,
            round(leaf.leaf_cost_per_unit * leaf.leaf_quantity)::integer, 'ajuste'
          );
        end loop;
      end loop;
    end if;
  end if;

  -- ── 2) Descontar lo que consume la línea nueva ────────────────────────────
  if new.product_id is not null then
    if exists (
      select 1 from products where id = new.product_id and track_stock = true
    ) then
      select si.id, si.business_id into v_stock_item_id, v_stock_business_id
        from stock_items si where si.product_id = new.product_id;
      if v_stock_item_id is not null then
        update stock_items
           set current_qty = current_qty - new.quantity,
               updated_at = now()
         where id = v_stock_item_id;
        insert into stock_movimientos
          (stock_item_id, business_id, kind, qty, order_item_id, reason)
        values
          (v_stock_item_id, v_stock_business_id, 'ajuste', -new.quantity,
           new.id, 'Edición de línea: descuenta lo nuevo');
        -- Spec 099: sin corte a `is_available`, igual que el descuento normal.
      end if;
    else
      for r in
        select rec.ingredient_id, rec.quantity
          from recipes rec where rec.product_id = new.product_id
      loop
        for leaf in
          select * from fn_explode_ingredient(r.ingredient_id, r.quantity * new.quantity)
        loop
          update ingredients
             set stock_quantity = stock_quantity - leaf.leaf_quantity,
                 updated_at = now()
           where id = leaf.leaf_ingredient_id;
          insert into ingredient_consumptions
            (business_id, ingredient_id, order_item_id, quantity, cost_cents_snapshot, kind)
          values (
            v_business_id, leaf.leaf_ingredient_id, new.id, leaf.leaf_quantity,
            round(leaf.leaf_cost_per_unit * leaf.leaf_quantity)::integer, 'venta'
          );
        end loop;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.fn_stock_delta_on_item_edit() is
  'Spec 098 · H-16: al corregir cantidad o producto de una línea, devuelve el consumo viejo (kind=ajuste) y descuenta el nuevo. Spec 099: no toca products.is_available.';

-- ── 3) Reversión: devolver stock ya no reenciende el producto ───────────────

create or replace function public.fn_stock_reversion_item(p_order_item_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
as $$
declare
  v_item record;
  v_stock_item_id uuid;
  v_stock_business_id uuid;
  r record;
  leaf record;
begin
  select oi.id,
         oi.product_id,
         oi.quantity,
         oi.kitchen_status,
         o.business_id
    into v_item
    from order_items oi
    join orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;

  -- `found` y no `v_item is null`: sobre un record, `is null` sólo da true si
  -- **todos** los campos son null, que no es la pregunta que queremos hacer.
  if not found or v_item.product_id is null then
    return;
  end if;

  -- La comida que ya salió no vuelve al inventario (ver 0039).
  if v_item.kitchen_status = 'delivered' then
    return;
  end if;

  -- Idempotencia: la fila de reversión es la prueba de que esta línea ya se
  -- devolvió. Cubre el doble disparo (ítem + orden en la misma transacción, en
  -- cualquier orden) y el reintento manual.
  if exists (
    select 1 from ingredient_consumptions
     where order_item_id = p_order_item_id and kind = 'reversion'
  ) or exists (
    select 1 from stock_movimientos
     where order_item_id = p_order_item_id and kind = 'reversion'
  ) then
    return;
  end if;

  -- ── Productos con stock propio (bebidas y demás `track_stock`) ──
  if exists (
    select 1 from products where id = v_item.product_id and track_stock = true
  ) then
    select si.id, si.business_id
      into v_stock_item_id, v_stock_business_id
      from stock_items si
     where si.product_id = v_item.product_id;

    if v_stock_item_id is null then
      return;
    end if;

    update stock_items
       set current_qty = current_qty + v_item.quantity,
           updated_at = now()
     where id = v_stock_item_id;

    insert into stock_movimientos
      (stock_item_id, business_id, kind, qty, order_item_id, reason)
    values
      (v_stock_item_id, v_stock_business_id, 'reversion', v_item.quantity,
       p_order_item_id, 'Línea cancelada');

    -- Spec 099: el reencendido automático se fue con el apagado automático.
    -- Nadie apaga por stock ⇒ nadie prende por stock, y el "no disponible" que
    -- puso el encargado sobrevive a un ingreso de mercadería.
    return;
  end if;

  -- ── Productos con receta ──
  for r in
    select rec.ingredient_id, rec.quantity
      from recipes rec
     where rec.product_id = v_item.product_id
  loop
    for leaf in
      select * from fn_explode_ingredient(r.ingredient_id, r.quantity * v_item.quantity)
    loop
      update ingredients
         set stock_quantity = stock_quantity + leaf.leaf_quantity,
             updated_at = now()
       where id = leaf.leaf_ingredient_id;

      -- `cost_cents_snapshot` con el costo REAL, no el 0 literal de antes. Se
      -- guarda en positivo (magnitud del movimiento, igual que 'venta'); quien
      -- lee decide el signo — `getProfitMetrics` resta las reversiones.
      insert into ingredient_consumptions
        (business_id, ingredient_id, order_item_id, quantity, cost_cents_snapshot, kind)
      values (
        v_item.business_id,
        leaf.leaf_ingredient_id,
        p_order_item_id,
        leaf.leaf_quantity,
        round(leaf.leaf_cost_per_unit * leaf.leaf_quantity)::integer,
        'reversion'
      );
    end loop;
  end loop;
end;
$$;

comment on function public.fn_stock_reversion_item(uuid) is
  'Spec 089: devuelve al inventario lo que consumió UNA línea de pedido. Idempotente y saltea lo ya entregado. Spec 099: no reenciende products.is_available.';

-- ── 4) Backfill: devolver a la carta lo que apagó el trigger ────────────────
--
-- Sólo lo **atribuible**: producto trackeado, apagado, en cero o menos y con al
-- menos una venta en su historial de movimientos — o sea, la marca que deja
-- este trigger y nadie más. Un producto que el negocio apagó a mano y nunca
-- vendió no tiene movimientos de venta y no se toca.
--
-- En el cloud, al escribir esta migración, el conjunto es de 0 filas (los dos
-- productos apagados de golf-jcr tienen cero movimientos: vienen apagados del
-- import). Va igual porque el corte sí ocurrió en otros entornos y puede ocurrir
-- entre esta migración y el deploy.

update public.products p
   set is_available = true
  from public.stock_items si
 where si.product_id = p.id
   and p.track_stock = true
   and p.is_available = false
   and si.current_qty <= 0
   and exists (
     select 1 from public.stock_movimientos m
      where m.stock_item_id = si.id and m.kind = 'venta'
   );
