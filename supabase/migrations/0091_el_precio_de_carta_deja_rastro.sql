-- 0091 · El precio de carta deja rastro, y el adicional no cruza de negocio
--        (P14 · issue #269, hallazgos 2 y 5)
--
-- ── 1 · El acto más caro del catálogo era el único sin auditoría ──────────
--
-- Pisar el precio de UNA línea exige motivo (`price-override.ts`) y sale con
-- nombre y apellido en el reporte «Precios modificados». Cambiar el costo de un
-- INSUMO se historiza solo en `ingredient_price_log` (old, new, recorded_by).
-- Cambiar el precio de VENTA —que afecta todas las ventas futuras del plato—
-- era un UPDATE pelado sobre `products`: sin trigger, sin tabla de historial,
-- sin `updated_at` siquiera. Si alguien bajaba el asado un 20%, por error o a
-- propósito, no había forma de saber quién ni cuándo.
--
-- Lo que sí se podía reconstruir era el precio VIEJO: `order_items` snapshotea
-- `unit_price_cents`, así que la última venta previa al cambio lo delata. Lo
-- que no se reconstruía nunca es el QUIÉN — y es justo lo que hace falta para
-- preguntar.
--
-- Va como TRIGGER y no en la server action, igual que el log de insumos: así lo
-- registra cualquier camino que toque el precio (la action de hoy, un import de
-- mañana, un UPDATE a mano en el SQL editor), no sólo el que nos acordamos de
-- instrumentar. `recorded_by` sale de `auth.uid()`: queda en NULL cuando el
-- cambio viene con service_role (seed, script de plataforma), y ese NULL es
-- información, no un agujero.
--
-- NO se exige motivo, a diferencia del override por línea: actualizar precios
-- es rutina mensual acá y un campo obligatorio en cada plato se llena con
-- basura en dos meses. Lo que faltaba era el rastro, no la fricción.

create table if not exists public.product_price_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  -- Denormalizado a propósito: el producto se puede borrar y el negocio es lo
  -- que hace falta para la RLS y para leer el historial de un local.
  business_id uuid not null references public.businesses(id) on delete cascade,
  old_price_cents bigint not null,
  new_price_cents bigint not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null
);

create index if not exists product_price_log_product_idx
  on public.product_price_log (product_id, recorded_at desc);
create index if not exists product_price_log_business_idx
  on public.product_price_log (business_id, recorded_at desc);

comment on table public.product_price_log is
  'issue #269 · quién cambió el precio de venta de un plato, cuándo y desde cuánto. Lo escribe el trigger fn_product_price_change_log, no la app.';

alter table public.product_price_log enable row level security;

-- Leerlo es parte de la gestión del negocio: el mismo techo que el catálogo
-- (admin | encargado), no cualquier miembro.
drop policy if exists product_price_log_select on public.product_price_log;
create policy product_price_log_select on public.product_price_log
  for select to authenticated
  using (public.is_business_manager(business_id) or public.is_platform_admin());

-- Nadie escribe a mano. El trigger es SECURITY DEFINER y pasa por encima de la
-- RLS; dejar el INSERT abierto permitiría fabricar un historial falso, que es
-- peor que no tenerlo.
drop policy if exists product_price_log_insert on public.product_price_log;
create policy product_price_log_insert on public.product_price_log
  for insert to authenticated
  with check (public.is_platform_admin());

drop policy if exists product_price_log_update on public.product_price_log;
create policy product_price_log_update on public.product_price_log
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists product_price_log_delete on public.product_price_log;
create policy product_price_log_delete on public.product_price_log
  for delete to authenticated
  using (public.is_platform_admin());

create or replace function public.fn_product_price_change_log()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  -- Sólo cuando el precio se mueve: guardar el producto para cambiar el nombre
  -- o la foto no tiene que ensuciar el historial de precios.
  if old.price_cents is distinct from new.price_cents then
    insert into product_price_log (
      product_id, business_id, old_price_cents, new_price_cents, recorded_by
    )
    values (
      new.id, new.business_id, old.price_cents, new.price_cents, auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_price_change_log on public.products;
create trigger products_price_change_log
  after update on public.products
  for each row
  execute function public.fn_product_price_change_log();

-- ── 2 · El adicional pertenece al negocio del producto ───────────────────
--
-- `updateProduct` corría con el id de producto que manda el browser. Con un id
-- ajeno el UPDATE tocaba 0 filas (RLS + el `.eq(business_id)` lo protegen) pero
-- devolvía `error = null`, así que la action seguía y sincronizaba los grupos de
-- adicionales. El INSERT pasaba el WITH CHECK porque la policy mira
-- `modifier_groups.business_id` —el MÍO— y no el del producto, y no había
-- ninguna constraint que los atara. Quedaba un grupo de mi negocio colgado de
-- un producto ajeno: sale en la carta pública y en la app del mozo de la
-- víctima (las dos leen con service client, sin RLS), y la víctima no lo ve ni
-- lo puede borrar desde su admin.
--
-- El chequeo de filas afectadas ya se agregó en la action, pero la garantía
-- tiene que estar en la base: es la única capa por la que pasan todos los
-- caminos.

do $$
declare
  v_cruzados int;
begin
  select count(*)
    into v_cruzados
  from public.modifier_groups g
  join public.products p on p.id = g.product_id
  where p.business_id is distinct from g.business_id;

  if v_cruzados > 0 then
    raise exception
      'Hay % grupos de adicionales colgados de productos de otro negocio. Revisalos antes de aplicar: select g.id, g.name, g.business_id, p.business_id from modifier_groups g join products p on p.id = g.product_id where p.business_id <> g.business_id;',
      v_cruzados;
  end if;
end;
$$;

alter table public.products
  drop constraint if exists products_id_business_id_key;
alter table public.products
  add constraint products_id_business_id_key unique (id, business_id);

-- La FK compuesta reemplaza a la simple: el par (producto, negocio) tiene que
-- existir, no sólo el producto. Se mantiene el CASCADE de antes.
alter table public.modifier_groups
  drop constraint if exists modifier_groups_product_id_fkey;
alter table public.modifier_groups
  drop constraint if exists modifier_groups_product_business_fkey;
alter table public.modifier_groups
  add constraint modifier_groups_product_business_fkey
  foreign key (product_id, business_id)
  references public.products (id, business_id)
  on delete cascade;

comment on constraint modifier_groups_product_business_fkey on public.modifier_groups is
  'issue #269 · el grupo de adicionales vive en el mismo negocio que su producto. Sin esto se podían inyectar adicionales en la carta de otro local.';
