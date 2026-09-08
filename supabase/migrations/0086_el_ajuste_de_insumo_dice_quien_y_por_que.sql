-- 0086 · El ajuste de un insumo dice quién, por qué, cuánto y para qué lado
--
-- Issues #268 (hallazgo 4) y #270 (hallazgos 2, 3, 4 y 5).
--
-- ── El motivo que la pantalla exige y nadie guarda ────────────────────────
--
-- `Catálogo → Stock → Cocina → Ajustar` pide «Motivo *» con asterisco rojo y el
-- botón deshabilitado sin él. `StockAjusteInput` lo valida con Zod. Y después el
-- insert a `ingredient_consumptions` no lo menciona — **porque la tabla no tiene
-- dónde ponerlo**: sus columnas son id, business_id, ingredient_id,
-- order_item_id, quantity, cost_cents_snapshot, kind, created_at. Ni `reason` ni
-- `created_by`.
--
-- El resultado es acuse de recibo falso: el encargado escribe «se cortó la
-- cadena de frío el sábado», la UI le dice que es obligatorio, y al mes
-- siguiente nadie puede decir quién bajó 5 kg de entraña ni por qué. El bar SÍ
-- lo hace bien (`stock_movimientos` guarda reason + created_by y el sheet los
-- muestra): es la misma regla escrita bien de un lado y mal del otro.
--
-- Se pierde también el SIGNO: el insert guardaba `abs(quantity)`, así que en el
-- log una baja de 5 kg y un alta de 5 kg quedaban idénticas.
--
-- ── El read-modify-write que se come las ventas ───────────────────────────
--
-- `ingresarStockCocina` y `ajustarStockCocina` leen `stock_quantity` y después
-- escriben el absoluto calculado en JS. Entre la lectura y la escritura hay dos
-- round-trips: lo que caiga ahí (una comanda descargando receta, otro ingreso,
-- la RPC de una compra) se pierde. El repo ya resolvió esto dos veces —
-- `adjust_stock_item` para el bar (spec 36 · R-C5) y
-- `registrar_items_comprobante_tx` para la compra por renglón (0073)— y la
-- cocina fue el único camino que quedó afuera.
--
-- ── El tile «Merma · 30 días» que dice $0,00 para siempre ─────────────────
--
-- `getProfitMetrics` suma `kind='merma'` y el dashboard lo muestra en pesos.
-- Pero NINGÚN camino de la app escribió nunca una fila 'merma': el único
-- productor es el script de seed. Medido en la nube: golf-jcr tiene 230 'venta'
-- y 19 'reversion' en toda su historia, cero 'merma' y cero 'ajuste'. El dueño
-- mira un número que dice «insumos perdidos: $0,00» y concluye que en la cocina
-- no se tira nada.
--
-- **Decisión de producto** (marcada para revisión humana): la baja manual de
-- stock de cocina ES merma. La pantalla ya lo dice —el placeholder del motivo es
-- «Ej: Merma por vencimiento»— y la ayuda la documenta como la forma de
-- registrar lo que se tira. Lo que sube sigue siendo 'ajuste': un conteo que
-- aparece de más no es una pérdida. Se pierde precisión en un caso: el conteo
-- físico que da menos («conté mal, había 8 y no 10») queda contado como merma.
-- Es el trade-off correcto porque en los dos casos la mercadería no está y el
-- costo se fue igual; y porque la alternativa —un selector de tipo de ajuste— es
-- fricción en una pantalla que hoy nadie usa. Si el negocio quiere separarlos,
-- el campo a agregar es un `motivo tipado`, no un cambio de esta regla.

-- ── 1 · quién y por qué ───────────────────────────────────────────────────

alter table public.ingredient_consumptions
  add column if not exists reason text,
  add column if not exists created_by uuid references public.users(id) on delete set null;

comment on column public.ingredient_consumptions.reason is
  'Issue #270 · el motivo que la pantalla de ajuste exige con asterisco rojo y que hasta ahora se tiraba a la basura. Null en los movimientos que dispara un trigger (venta, reversión).';
comment on column public.ingredient_consumptions.created_by is
  'Issue #270 · quién movió el inventario a mano. Null cuando el movimiento lo escribió un trigger.';

-- ── 2 · el movimiento de stock de cocina, atómico ─────────────────────────

create or replace function public.adjust_ingredient_stock(
  p_business_id   uuid,
  p_ingredient_id uuid,
  p_delta         numeric,   -- unidades base, CON signo
  p_kind          text,      -- 'compra' | 'ajuste' | 'merma'
  p_cost_cents    bigint,    -- null ⇒ se valoriza con el costo vivo del insumo
  p_reason        text,
  p_created_by    uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo numeric;
  v_costo bigint;
begin
  if p_delta = 0 then
    raise exception 'DELTA_CERO';
  end if;

  -- `where business_id` y no un select previo: el service client bypassa RLS y
  -- el tenant tiene que chequearse en la misma sentencia que escribe.
  update ingredients
     set stock_quantity = stock_quantity + p_delta,
         updated_at = now()
   where id = p_ingredient_id and business_id = p_business_id
  returning stock_quantity into v_nuevo;

  if not found then
    raise exception 'INSUMO_NO_ENCONTRADO';
  end if;

  -- La plata del movimiento entero (costo por unidad × cantidad), que es la
  -- convención de `fn_stock_reversion_item` y la que suma el CMV. El costo vivo
  -- del insumo sale de la presentación default, igual que el costeo del plato.
  v_costo := coalesce(
    p_cost_cents,
    round(fn_ingredient_cost_per_unit(p_ingredient_id) * abs(p_delta))
  );

  -- `quantity` va CON signo: sin él, en el log una baja de 5 kg y un alta de
  -- 5 kg son la misma fila.
  insert into ingredient_consumptions (
    business_id, ingredient_id, quantity, cost_cents_snapshot, kind, reason, created_by
  ) values (
    p_business_id, p_ingredient_id, p_delta, v_costo, p_kind, nullif(btrim(p_reason), ''),
    p_created_by
  );

  return v_nuevo;
end;
$$;

comment on function public.adjust_ingredient_stock is
  'Issue #268/#270 · mueve el stock de un insumo y deja el rastro completo (signo, costo, motivo, autor) en UNA sentencia. Reemplaza el read-modify-write en JS de ingresarStockCocina/ajustarStockCocina, que perdía toda venta que cayera en el medio.';

grant execute on function public.adjust_ingredient_stock(uuid, uuid, numeric, text, bigint, text, uuid)
  to authenticated, service_role;

-- ── 3 · el bar también rompe cosas ────────────────────────────────────────
--
-- Issue #270 · hallazgo 5. La botella que se rompe se carga desde
-- `Stock → Bar → Ajustar` —la pantalla dice literalmente «Cantidad (negativa =
-- merma)» y el placeholder es «Ej: Botella rota»— y se guardaba con
-- `kind='ajuste'`, el mismo tipo que un conteo físico. Ni el tipo distinguía una
-- rotura de una corrección: sólo el texto libre del motivo.
--
-- Se agrega 'merma' al CHECK para que la baja manual de bar tenga el mismo
-- vocabulario que la de cocina, y una columna de plata: `stock_movimientos` no
-- tenía NINGUNA, así que el costo de una botella de whisky rota no existía en
-- el sistema. `stock_history-sheet` cae en su fallback de etiqueta para un kind
-- que no conoce, así que el kind nuevo se ve sin romper nada.
alter table public.stock_movimientos
  drop constraint if exists stock_movimientos_kind_check;
alter table public.stock_movimientos
  add constraint stock_movimientos_kind_check
  check (kind = any (array['ingreso', 'venta', 'ajuste', 'reversion', 'merma']));

alter table public.stock_movimientos
  add column if not exists cost_cents_snapshot bigint;

comment on column public.stock_movimientos.cost_cents_snapshot is
  'Issue #270 · la plata del movimiento. La tabla no tenía ninguna columna de costo: la rotura de una botella de $40.000 no existía en ningún número que alguien mirara. Se llena en las bajas manuales; los movimientos de venta los valoriza el pedido.';

-- De dónde sale esa plata. El bar no tiene recetas ni presentaciones: un
-- producto trackeado sólo tiene `price_cents`, que es lo que se COBRA, no lo que
-- cuesta. Valorizar la rotura al precio de venta contaría como pérdida el margen
-- que nunca se ganó, así que hace falta el costo de reposición del envase.
--
-- Arranca en 0 y lo carga el ingreso de mercadería (`ingresarStock` con costo),
-- que es la misma regla que la 0073 aplicó a los insumos: la compra reescribe el
-- precio. Mientras nadie lo cargue, la merma de bar queda registrada y en $0 —
-- que es honesto, y distinto de hoy, donde ni siquiera se distingue una rotura
-- de un conteo.
alter table public.stock_items
  add column if not exists unit_cost_cents bigint not null default 0;

comment on column public.stock_items.unit_cost_cents is
  'Issue #270 · lo que le cuesta al local UNA unidad de este producto trackeado (no lo que se cobra). Lo escribe el ingreso de mercadería; valoriza la merma de bar.';
