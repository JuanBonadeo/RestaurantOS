-- Rollback de la migración `0038_drop_columnas_del_modelo_viejo.sql` (spec 087).
--
-- No es un volcado de datos: es el **inverso exacto del backfill** de la 0036,
-- así que no se pone rancio. Reconstruye las dos columnas viejas leyendo
-- `daily_menu_choice_groups`, que es donde vive la verdad desde la 0036.
--
--   choice_group_label      = el `name` del grupo, repetido en cada opción
--   blocks_choice_group_ids = el complemento de `applies_when_product_ids`
--                             («los que NO habilitan» = todos menos los que sí)
--
-- Correr entero, en orden. Después: `notify pgrst, 'reload schema'`.

alter table public.daily_menu_components
  add column if not exists choice_group_label text;

alter table public.daily_menu_components
  add column if not exists blocks_choice_group_ids uuid[] not null default '{}'::uuid[];

-- 1 · El nombre del grupo vuelve a cada una de sus opciones.
update public.daily_menu_components c
   set choice_group_label = g.name
  from public.daily_menu_choice_groups g
 where c.choice_group_id = g.id;

-- 2 · La condición vuelve a la opción y en negativo. Una opción bloquea a todo
--     grupo que dependa de SU grupo y que no la tenga entre las habilitantes.
update public.daily_menu_components c
   set blocks_choice_group_ids = coalesce(b.ids, '{}'::uuid[])
  from (
    select o.id,
           array_agg(distinct dep.id) as ids
      from public.daily_menu_components o
      join public.daily_menu_choice_groups dep
        on dep.applies_when_group_id = o.choice_group_id
       and not (o.product_id = any (dep.applies_when_product_ids))
     where o.kind = 'choice'
       and o.product_id is not null
     group by o.id
  ) b
 where c.id = b.id;
