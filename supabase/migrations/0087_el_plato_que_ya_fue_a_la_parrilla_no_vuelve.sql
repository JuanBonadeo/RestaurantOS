-- 0087 · El plato que ya fue a la parrilla no vuelve a la heladera
--
-- Issue #270 · hallazgo 1.
--
-- ## Lo que pasaba
--
-- El mozo carga una entraña, la manda a la parrilla, la levanta y se le cae al
-- piso. El encargado la anula con motivo «se cayó al piso». `fn_stock_reversion_item`
-- devuelve 0,400 kg de entraña al inventario y escribe una fila `reversion` con
-- el costo real (280.000 centavos), que `getProfitMetrics` **resta** del food
-- cost. Doble daño, en las dos puntas:
--
--   · stock fantasma — 0,4 kg de carne que no existe;
--   · CMV subvaluado — $2.800 menos de costo ⇒ margen mejor que el real.
--
-- En una parrilla con dos o tres platos caídos por semana son ~$30.000/mes de
-- margen inventado, más el conteo físico que nunca cierra. Y aparece meses
-- después como faltante de inventario, que es la forma en que este sistema
-- convierte un accidente en una sospecha de robo sobre el personal — exactamente
-- lo que la cabecera de la 0039 dice querer evitar.
--
-- La guarda de la spec 089 excluía solamente `kitchen_status='delivered'`.
--
-- ## La decisión (DE PRODUCTO — pide revisión humana)
--
-- El argumento en contra de tocar esto está escrito en la 089 y es real: la
-- cocina no usa el sistema, así que `preparing` no prueba que el plato se haya
-- cocinado — sólo que **el ticket se imprimió**. Con esa lectura, `delivered` es
-- la única señal dura y todo lo demás debería volver al inventario.
--
-- Se elige la otra: **una vez que la comanda salió a la cocina, el insumo no
-- vuelve solo.** Las dos razones:
--
--   1. Los errores no son simétricos. Si el ticket se imprimió y el cocinero no
--      había empezado, contamos como perdido algo que se podía salvar: el
--      número queda conservador y VISIBLE (una fila de merma con el motivo que
--      el encargado tipeó). Al revés, inventamos mercadería que no existe y el
--      error es INVISIBLE hasta el inventario físico. Entre un número
--      pesimista que se puede corregir y uno optimista que nadie ve, gana el
--      primero.
--   2. En la práctica el ticket impreso ES el comienzo de la preparación. La
--      parrilla no espera.
--
-- Y no se pierde el costo: en vez de devolver el stock y restar del CMV, la
-- línea de consumo que ya existe se **reclasifica** de `venta` a `merma`. El
-- inventario no se mueve (la carne se usó), el CMV no cambia (`getProfitMetrics`
-- suma venta y merma por igual), el reporte de merma sigue cuadrando («Salió» =
-- venta + merma, o sea la misma cantidad de antes) y la pérdida aparece por
-- primera vez en el tile «Merma · 30 días», que hasta el issue #270 decía $0,00.
--
-- `delivered` NO cambia de comportamiento: sigue con su return temprano y su
-- fila `venta` intacta. Un plato entregado que se anula (una cortesía, un
-- reclamo) es otra conversación y otro issue; acá no se toca para no mover el
-- significado de las filas que ya existen.

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
         oi.cancelled_reason,
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

  -- La comida que ya salió no vuelve al inventario (ver 0039). Se deja tal cual
  -- estaba: la fila sigue siendo una `venta`.
  if v_item.kitchen_status = 'delivered' then
    return;
  end if;

  -- Lo que ya se mandó a la cocina tampoco vuelve — pero acá sí se marca por
  -- qué se fue. La fila de consumo que el descuento ya escribió cambia de
  -- `venta` a `merma`: misma cantidad, mismo costo, mismo lugar en el CMV, y
  -- ahora visible como pérdida en vez de como plato vendido.
  --
  -- Esto es también la idempotencia de este camino: después del update no queda
  -- ninguna fila `venta` con este `order_item_id`, así que un segundo disparo
  -- (ítem + orden en la misma transacción, o un reintento) no hace nada.
  if v_item.kitchen_status <> 'pending' then
    update ingredient_consumptions
       set kind = 'merma',
           reason = coalesce(nullif(btrim(v_item.cancelled_reason), ''), 'Línea cancelada')
     where order_item_id = p_order_item_id
       and kind = 'venta';

    update stock_movimientos
       set kind = 'merma',
           reason = coalesce(nullif(btrim(v_item.cancelled_reason), ''), 'Línea cancelada')
     where order_item_id = p_order_item_id
       and kind = 'venta';

    return;
  end if;

  -- Idempotencia del camino que SÍ devuelve: la fila de reversión es la prueba
  -- de que esta línea ya se devolvió. Cubre el doble disparo (ítem + orden en la
  -- misma transacción, en cualquier orden) y el reintento manual.
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
  'Spec 089: devuelve al inventario lo que consumió UNA línea de pedido. Sólo si la comanda todavía no salió a la cocina: lo que ya se mandó se reclasifica de venta a merma (issue #270) y lo entregado no se toca. Idempotente. Spec 099: no reenciende products.is_available.';
