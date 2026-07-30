-- Spec 074 · Opciones que habilitan (o no) otros grupos del menú del día.
--
-- El modelo asumía que TODOS los grupos de opciones de un menú aplican
-- siempre. En la práctica no: los ravioles o el risotto vienen con lo suyo y
-- no llevan guarnición, pero el asistente (spec 072) plantaba el paso igual y
-- el mozo terminaba cargando una guarnición fantasma — que iba a la comanda,
-- salía impresa en cocina y quedaba en el `daily_menu_snapshot`.
--
-- La regla NO es "guarnición sí/no" sino «esta opción no habilita este otro
-- grupo»: el rótulo del check sale del `choice_group_label` que cargó el
-- encargado, así que no hay nombres de dominio en el código y sirve para
-- cualquier negocio.
--
-- Vive en la OPCIÓN y no en el grupo porque el encargado piensa por plato
-- («los ravioles no llevan guarnición») y edita el plato. Se podría modelar al
-- revés («Guarnición aplica sólo a estas opciones») con menos filas, pero la
-- forma del dato sigue a la forma de la decisión.
--
-- `uuid[]` y no tabla puente: los componentes de un menú SIEMPRE se leen
-- enteros en una sola query, en cuatro caminos distintos (`menu.ts`,
-- `daily-menus-query`, `comandas/actions`, `persist-order`); una tabla puente
-- les agrega un join a todos. Y no se pierde integridad referencial que hoy
-- exista: `choice_group_id` YA es un uuid pelado sin FK — los grupos de
-- opciones no son una tabla, son filas que comparten ese uuid.
--
-- Aditiva: default '{}' = ninguna opción bloquea nada, así que todos los menús
-- existentes se comportan exactamente igual que antes.

alter table public.daily_menu_components
  add column if not exists blocks_choice_group_ids uuid[] not null default '{}';

comment on column public.daily_menu_components.blocks_choice_group_ids is
  'Spec 074. `choice_group_id`s que NO aplican cuando se elige esta opción. Sólo tiene sentido en kind=''choice''. Vacío = todos los grupos del menú aplican. La regla de que sólo se puede bloquear un grupo POSTERIOR (sort_order mayor) se valida en la action, no acá: es una regla entre filas.';
