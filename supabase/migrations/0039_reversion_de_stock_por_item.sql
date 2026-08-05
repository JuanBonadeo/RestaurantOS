-- Spec 089 · La reversión de inventario pasa a colgar del ítem, no del pedido.
--
-- ## El problema
--
-- La única reversión que existía, `fn_recipe_stock_reversion`, cuelga de
-- `AFTER UPDATE ON orders WHEN new.status = 'cancelled'`. Ese es el eje que el
-- **salón nunca escribe**: `anularMesa` marca `lifecycle_status` y no toca
-- `orders.status`. Consecuencia medida en el cloud: 23 órdenes anuladas con
-- `status='pending'`, o sea **23 anulaciones que no devolvieron un solo insumo
-- al inventario**. Al cierre el conteo físico da de más y el reporte de merma se
-- lo muestra al encargado como robo.
--
-- Y aun cuando el trigger sí corría (un delivery cancelado desde el board),
-- estaba incompleto en cuatro frentes:
--
--   1. Hacía `continue` **explícito** sobre los productos con `track_stock`
--      (0001:270-272) → las bebidas no volvían nunca, por ningún camino. Para
--      `stock_items` no existía reversión de ninguna clase, y el CHECK de
--      `stock_movimientos` ni siquiera admitía `kind='reversion'`.
--   2. Recorría **todos** los `order_items` sin mirar si la comida ya había
--      salido → devolvía al inventario platos cocinados y servidos.
--   3. Escribía `cost_cents_snapshot = 0` literal, así que el CMV de una orden
--      cancelada no se revertía nunca: `getProfitMetrics` sumaba el costo y
--      excluía la venta. El food cost salía 4-5 puntos arriba del real.
--   4. Nadie reactivaba `products.is_available` cuando el stock volvía a subir:
--      la última botella se cancelaba y el vino quedaba apagado en la carta con
--      la botella física en la heladera.
--
-- Además **no existía ningún trigger `AFTER UPDATE ON order_items`**, así que
-- `cancelarItem`, `cancelarComanda` y `cancelarItemEnCuenta` tampoco movían
-- inventario: anular una línea por rotura no devolvía nada.
--
-- ## La forma de la solución
--
-- Una función núcleo, `fn_stock_reversion_item(order_item_id)`, que sabe
-- devolver **una línea** al inventario y es **idempotente**. Dos disparadores la
-- usan:
--
--   * el nuevo `trg_stock_reversion_por_item`, cuando la línea se cancela;
--   * el viejo `fn_recipe_stock_reversion` sobre `orders`, reescrito para
--     delegar en el núcleo línea por línea.
--
-- La idempotencia **no es decorativa**: los dos disparadores pueden verse en la
-- misma transacción (la spec 090 cancela los ítems *y* pone la orden en
-- `cancelled`) y el orden entre ellos no está garantizado. En vez de razonar
-- sobre ese orden, se sostiene el invariante directo: **el stock de una línea se
-- devuelve como mucho una vez**, y la prueba es la propia fila de reversión.
--
-- Se conservan los dos disparadores a propósito. Mientras la spec 090 no esté,
-- `updateOrderStatus(cancelled)` sigue siendo un camino que sólo escribe
-- `orders.status`: si se dropeara el trigger de `orders` ahora, el canal online
-- se quedaría sin reversión entre una spec y la otra.
--
-- ## La regla de negocio que se agrega
--
-- **La comida entregada no vuelve.** Una línea con `kitchen_status='delivered'`
-- se saltea: el plato se cocinó y salió, el insumo se consumió de verdad y
-- devolverlo al inventario sería inventar stock que no está en la heladera. Es
-- el mismo criterio que `anularMesa` ya aplica con las comandas entregadas
-- ("la comida ya salió; la orden cancelada ya garantiza que no se cobra").

-- ── 1) `stock_movimientos` aprende a hablar de reversiones ──────────────────

alter table public.stock_movimientos
  drop constraint if exists stock_movimientos_kind_check;

alter table public.stock_movimientos
  add constraint stock_movimientos_kind_check
  check (kind in ('ingreso', 'venta', 'ajuste', 'reversion'));

comment on column public.stock_movimientos.kind is
  'ingreso = compra/carga. venta = descuento por pedido (qty negativa). ajuste = corrección manual. reversion = la línea se canceló y el stock vuelve (qty positiva, spec 089).';

-- Sirve el chequeo de idempotencia del núcleo ("¿esta línea ya se revirtió?").
create index if not exists stock_movimientos_reversion_idx
  on public.stock_movimientos (order_item_id)
  where kind = 'reversion';

create index if not exists ingredient_consumptions_reversion_idx
  on public.ingredient_consumptions (order_item_id)
  where kind = 'reversion';

-- ── 2) El núcleo: devolver UNA línea al inventario, una sola vez ────────────

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
  v_current_qty integer;
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

  -- La comida que ya salió no vuelve al inventario (ver cabecera).
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
     where id = v_stock_item_id
    returning current_qty into v_current_qty;

    insert into stock_movimientos
      (stock_item_id, business_id, kind, qty, order_item_id, reason)
    values
      (v_stock_item_id, v_stock_business_id, 'reversion', v_item.quantity,
       p_order_item_id, 'Línea cancelada');

    -- El producto se apagó solo cuando el stock tocó cero (0001:317-353) y nada
    -- lo volvía a prender. Si volvió a haber unidades, vuelve a la carta.
    if v_current_qty > 0 then
      update products
         set is_available = true
       where id = v_item.product_id and is_available = false;
    end if;

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
  'Spec 089: devuelve al inventario lo que consumió UNA línea de pedido. Idempotente (la fila de reversión es la prueba) y saltea lo ya entregado. Cubre receta y stock propio.';

-- ── 3) El disparador nuevo: la línea se cancela ─────────────────────────────

create or replace function public.fn_stock_reversion_on_item_cancel()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
as $$
begin
  perform fn_stock_reversion_item(new.id);
  return new;
end;
$$;

drop trigger if exists trg_stock_reversion_por_item on public.order_items;

create trigger trg_stock_reversion_por_item
  after update on public.order_items
  for each row
  when (old.cancelled_at is null and new.cancelled_at is not null)
  execute function public.fn_stock_reversion_on_item_cancel();

-- ── 4) El disparador viejo delega en el núcleo ──────────────────────────────

create or replace function public.fn_recipe_stock_reversion()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
as $$
declare
  item record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    for item in
      select oi.id from order_items oi where oi.order_id = new.id
    loop
      -- El núcleo se encarga de todo lo que esta función hacía mal: saltea lo
      -- entregado, cubre `track_stock`, escribe el costo real y no repite si la
      -- línea ya se revirtió por su propio trigger.
      perform fn_stock_reversion_item(item.id);
    end loop;
  end if;

  return new;
end;
$$;

comment on function public.fn_recipe_stock_reversion() is
  'Spec 089: quedó como red de seguridad del canal online (updateOrderStatus escribe orders.status y nada más). Delega en fn_stock_reversion_item, que es idempotente.';
