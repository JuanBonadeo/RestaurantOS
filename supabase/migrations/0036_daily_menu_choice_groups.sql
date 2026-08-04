-- Spec 085 · El grupo de opciones del menú del día pasa a ser una entidad.
--
-- Hasta acá el "grupo" no existía: era un uuid pelado (`choice_group_id`, sin
-- tabla ni FK) repetido en N filas, con el nombre denormalizado en cada una
-- (`choice_group_label`). Todo lo feo del editor sale de ahí:
--
--   * el ORDEN de un grupo era la posición de su primera opción en un array
--     plano global, así que hubo que inventar `component-order.ts` para
--     normalizar contigüidad y mover tarjetas;
--   * la CONDICIÓN vivía en la opción y en negativo (`blocks_choice_group_ids`
--     = «qué grupos NO habilita esta opción»), y sólo podía mirar hacia
--     adelante *porque el orden era implícito*. En pantalla eran N×M casillas
--     «Lleva X» tildadas por default: 15 casillas para decir «los ravioles no
--     llevan guarnición»;
--   * renombrar un grupo escribía en las N filas.
--
-- La 0033 evaluó modelar la condición al revés y la descartó con «la forma del
-- dato sigue a la forma de la decisión». Con el editor en la mano se ve que no:
-- el encargado no toca plato por plato, toca el grupo («¿cuándo aparece este
-- paso?»). Esta migración invierte esa decisión con evidencia de uso.
--
-- La condición pasa a ser POSITIVA y por grupo: «Guarnición aplica sólo si en
-- Plato Principal eligieron Milanesa, Suprema o Merluza». Una regla, en un solo
-- lugar, editada donde se lee.
--
-- Dos columnas en el grupo y no tabla puente: la condición es 1-a-1 con el
-- grupo, y los cinco caminos de lectura traen el menú entero en un select
-- anidado — pasar a entidad ya les agrega un nivel; una puente les agregaría
-- dos, sin ganar normalización.
--
-- Sin `min_selection` / `max_selection` / `is_required`: sigue valiendo
-- «exactamente 1» (D-MDR-4 / D-MDR-6). Columnas que el runtime no honra son
-- dato adelantándose al código; el día que haga falta es un `add column`.
--
-- Aditiva y sin FK todavía: el editor actual genera `choice_group_id` con
-- `crypto.randomUUID()` sin crear grupo, así que un FK acá dejaría al encargado
-- sin poder guardar. El FK entra cuando el editor escriba los grupos.

create table if not exists public.daily_menu_choice_groups (
  -- Sin default a propósito: se REUSAN los `choice_group_id` que ya circulan.
  -- Eso deja intactos el payload de red (`selected_choices[].choice_group_id`),
  -- los carritos en localStorage y los `daily_menu_snapshot` ya escritos.
  id uuid primary key,
  menu_id uuid not null references public.daily_menus(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  -- NULL = el grupo aplica siempre. Si no, el grupo del que depende.
  applies_when_group_id uuid null references public.daily_menu_choice_groups(id) on delete set null,
  -- Las opciones (por `product_id`) de ese grupo que lo habilitan.
  applies_when_product_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Para el FK compuesto que viene después: el grupo tiene que ser del MISMO
  -- menú que el componente que lo referencia.
  constraint daily_menu_choice_groups_menu_id_id_key unique (menu_id, id),
  constraint daily_menu_choice_groups_not_self
    check (applies_when_group_id is null or applies_when_group_id <> id)
);

comment on table public.daily_menu_choice_groups is
  'Spec 085. Grupo de opciones de un menú del día. Antes era un uuid repetido en las filas de `daily_menu_components`; ahora es una fila con nombre, orden y condición.';
comment on column public.daily_menu_choice_groups.applies_when_group_id is
  'Spec 085. NULL = el grupo aplica siempre. Si no, el grupo del que depende: aplica sólo si ESE grupo está activo y lo elegido en él está en `applies_when_product_ids`. Reemplaza a `daily_menu_components.blocks_choice_group_ids` (que era por opción y en negativo).';
comment on column public.daily_menu_choice_groups.sort_order is
  'Orden del grupo. Se backfillea con el `min(sort_order)` de sus opciones para conservar el mismo espacio numérico que los componentes sueltos y no tener que renumerar `daily_menu_components`.';

create index if not exists daily_menu_choice_groups_menu_id_idx
  on public.daily_menu_choice_groups (menu_id);

create trigger daily_menu_choice_groups_set_updated_at
  before update on public.daily_menu_choice_groups
  for each row execute function public.set_updated_at();

-- ── RLS: mismas políticas que `daily_menu_components` ──────────────────────
alter table public.daily_menu_choice_groups enable row level security;

create policy "admin_select_daily_menu_choice_groups" on public.daily_menu_choice_groups
  for select to authenticated using (
    (exists (select 1 from public.daily_menus m
              where m.id = daily_menu_choice_groups.menu_id
                and public.is_business_member(m.business_id)))
    or public.is_platform_admin()
  );

create policy "admin_insert_daily_menu_choice_groups" on public.daily_menu_choice_groups
  for insert to authenticated with check (
    (exists (select 1 from public.daily_menus m
              where m.id = daily_menu_choice_groups.menu_id
                and public.is_business_member(m.business_id)))
    or public.is_platform_admin()
  );

create policy "admin_update_daily_menu_choice_groups" on public.daily_menu_choice_groups
  for update to authenticated using (
    (exists (select 1 from public.daily_menus m
              where m.id = daily_menu_choice_groups.menu_id
                and public.is_business_member(m.business_id)))
    or public.is_platform_admin()
  ) with check (
    (exists (select 1 from public.daily_menus m
              where m.id = daily_menu_choice_groups.menu_id
                and public.is_business_member(m.business_id)))
    or public.is_platform_admin()
  );

create policy "admin_delete_daily_menu_choice_groups" on public.daily_menu_choice_groups
  for delete to authenticated using (
    (exists (select 1 from public.daily_menus m
              where m.id = daily_menu_choice_groups.menu_id
                and public.is_business_member(m.business_id)))
    or public.is_platform_admin()
  );

grant all on table public.daily_menu_choice_groups to anon, authenticated, service_role;

-- ── Backfill A · los grupos implícitos pasan a ser filas ───────────────────
insert into public.daily_menu_choice_groups (id, menu_id, name, sort_order)
select c.choice_group_id,
       c.menu_id,
       coalesce(nullif(min(c.choice_group_label), ''), 'Elegí una opción'),
       min(c.sort_order)
from public.daily_menu_components c
where c.kind = 'choice' and c.choice_group_id is not null
group by c.choice_group_id, c.menu_id
on conflict (id) do nothing;

-- ── Backfill B · la condición negativa por opción se traduce a positiva ────
--
-- Para cada grupo G bloqueado por opciones de un grupo P: G aplica cuando en P
-- se eligió alguna de las opciones que NO lo bloquean (el complemento). Es una
-- equivalencia exacta mientras P sea uno solo.
with bloqueos as (
  select src.menu_id,
         blocked_id as grupo_bloqueado,
         src.choice_group_id as fuente
  from public.daily_menu_components src
  cross join lateral unnest(src.blocks_choice_group_ids) as blocked_id
  where src.kind = 'choice' and src.choice_group_id is not null
  group by src.menu_id, blocked_id, src.choice_group_id
),
-- Sólo se traduce cuando hay UNA fuente: con dos o más haría falta un AND de
-- condiciones, que este modelo no expresa. La auditoría previa a esta
-- migración verificó que no existen (y el `raise notice` de abajo avisa si
-- aparecieran en otra base).
unica_fuente as (
  -- `(array_agg(...))[1]` y no `min()`: Postgres no define min() sobre uuid, y
  -- con `count(distinct) = 1` cualquiera de los valores es EL valor.
  select grupo_bloqueado, (array_agg(distinct fuente))[1] as fuente
  from bloqueos
  group by grupo_bloqueado
  having count(distinct fuente) = 1
)
update public.daily_menu_choice_groups g
set applies_when_group_id = u.fuente,
    applies_when_product_ids = coalesce((
      select array_agg(distinct opt.product_id)
      from public.daily_menu_components opt
      where opt.kind = 'choice'
        and opt.choice_group_id = u.fuente
        and opt.product_id is not null
        and not (g.id = any(opt.blocks_choice_group_ids))
    ), '{}')
from unica_fuente u
where g.id = u.grupo_bloqueado
  -- Sólo hacia adelante: un bloqueo invertido ya era inaplicable en runtime.
  and exists (
    select 1 from public.daily_menu_choice_groups f
    where f.id = u.fuente and f.sort_order < g.sort_order
  );

-- Los grupos condicionados desde MÁS DE UN grupo no se traducen (haría falta un
-- AND de condiciones, que este modelo no expresa) y quedan sin condición. La
-- auditoría previa verificó que no existen en ninguna base: al aplicarla, la
-- única regla condicional de todo el sistema era «Guarnición» del Menu
-- Ejecutivo de golf-jcr, bloqueada por 4 de los 9 platos principales, que se
-- tradujo a los 5 restantes.
