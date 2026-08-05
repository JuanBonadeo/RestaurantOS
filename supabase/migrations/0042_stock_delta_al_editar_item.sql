-- Spec 098 · H-16 — corregir una línea también corrige el inventario.
--
-- ## El problema
--
-- `editarItemComanda` deja al encargado arreglar una línea ya cargada: cambiar
-- la cantidad, o cambiar el producto. Escribe `quantity` / `product_id` /
-- `unit_price_cents` / `subtotal_cents` en `order_items`… y el stock **no se
-- mueve**, porque los dos triggers de descuento son `AFTER INSERT` y sólo
-- corren cuando la línea nace. No existía ningún `AFTER UPDATE` que reaccionara
-- a un cambio de cantidad o de producto (la spec 089 agregó uno, pero mira
-- `cancelled_at`, que es otro hecho).
--
-- Lo que pasa en el local:
--
--   * El mozo cargó **1 bife** en vez de 4. El encargado lo corrige a 4. Se
--     **cobran 4** y se descontaron los insumos de **1**.
--   * El mozo cargó **Milanesa**, era **Bife**. Al corregirlo se descontó
--     milanesa y **nunca** bife: dos productos con el stock mal.
--
-- Es el peor de los tres de inventario porque **hace ver el margen mejor de lo
-- real**: se cobra 4 y se costea 1, así que en Rentabilidad no se lee como un
-- error sino como una buena noticia.
--
-- ## Por qué no lo cubre la 089
--
-- Son dos invariantes distintos. El de la 089 es *"esta línea no se consume →
-- devolvé todo"*, y se dispara con `cancelled_at`. Éste es *"esta línea ahora
-- consume otra cosa → ajustá la diferencia"*: otro disparador y otra cuenta
-- (revertir lo viejo **y** descontar lo nuevo). Mezclarlos en un solo trigger
-- ataba dos cosas que se rompen distinto.
--
-- ## Cómo se implementa
--
-- Reusando las tres funciones que ya existen y están probadas, en vez de
-- reescribir la explosión de recetas por tercera vez:
--
--   1. `fn_stock_reversion_item(old.id)` — devuelve lo que consumía la línea.
--   2. los descuentos de `fn_recipe_stock_descuento` /
--      `fn_stock_descuento_on_order_item`, replicados sobre los valores NUEVOS.
--
-- El paso 1 no puede usar el núcleo de la 089 tal cual: ése es **idempotente
-- por la fila de reversión**, y acá una línea se puede editar varias veces
-- seguidas (el mozo corrige 1 → 4 → 3). Por eso la reversión de la edición
-- escribe `kind='ajuste'`, que no participa del chequeo de idempotencia y
-- además es lo que operativamente es: un ajuste, no una anulación.
--
-- Una línea **cancelada** no se toca: si ya se devolvió su stock, editarla no
-- puede volver a descontar.

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
  v_current_qty integer;
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
         where id = v_stock_item_id
        returning current_qty into v_current_qty;
        insert into stock_movimientos
          (stock_item_id, business_id, kind, qty, order_item_id, reason)
        values
          (v_stock_item_id, v_stock_business_id, 'ajuste', -new.quantity,
           new.id, 'Edición de línea: descuenta lo nuevo');
        -- Mismo criterio que el descuento original: sin stock, fuera de la carta.
        if v_current_qty <= 0 then
          update products set is_available = false where id = new.product_id;
        end if;
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
  'Spec 098 · H-16: al corregir cantidad o producto de una línea, devuelve el consumo viejo (kind=ajuste) y descuenta el nuevo. Sin esto se cobraban 4 y se costeaba 1.';

drop trigger if exists trg_stock_delta_on_item_edit on public.order_items;

create trigger trg_stock_delta_on_item_edit
  after update on public.order_items
  for each row
  when (
    old.cancelled_at is null and new.cancelled_at is null
    and (old.quantity is distinct from new.quantity
         or old.product_id is distinct from new.product_id)
  )
  execute function public.fn_stock_delta_on_item_edit();
