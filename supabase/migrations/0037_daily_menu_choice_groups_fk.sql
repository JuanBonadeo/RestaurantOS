-- Spec 087 · El FK que cierra el modelo de grupos.
--
-- Va en una migración aparte de la `0036` a propósito: hasta que el editor
-- escribiera los grupos, un componente podía referenciar un `choice_group_id`
-- sin fila, y el FK habría dejado al encargado sin poder guardar. Ahora la
-- action los sincroniza siempre, así que se puede exigir.
--
-- El FK es COMPUESTO por `(menu_id, choice_group_id)`: no alcanza con que el
-- grupo exista, tiene que ser del mismo menú. Con un FK simple sobre
-- `choice_group_id` una opción podría apuntar al grupo de otro menú y el
-- asistente resolvería cualquier cosa.
--
-- `not valid` + `validate` en dos pasos: el primero toma un lock corto y sólo
-- aplica a lo que entre de ahora en más; el segundo escanea la tabla sin
-- bloquear escrituras. Con 54 filas da igual, pero es la forma correcta y es lo
-- que va a importar cuando haya varios negocios.

alter table public.daily_menu_components
  add constraint daily_menu_components_choice_group_fkey
  foreign key (menu_id, choice_group_id)
  references public.daily_menu_choice_groups (menu_id, id)
  on delete cascade
  not valid;

alter table public.daily_menu_components
  validate constraint daily_menu_components_choice_group_fkey;

-- La identidad de una opción en todo el sistema es `(choice_group_id,
-- product_id)`: es la clave con la que `validateComboChoices` matchea lo que
-- eligió el cliente, y la que usa la condición del grupo para saber qué
-- habilita. Repetida, el server no puede distinguir cuál se pidió.
--
-- Había exactamente un caso cargado —«Agua Mineral» dos veces en el grupo
-- Bebida del Menu Ejecutivo de golf-jcr, que el mozo veía repetida— y se borró
-- antes de aplicar esto.
create unique index if not exists daily_menu_components_group_product_key
  on public.daily_menu_components (choice_group_id, product_id)
  where kind = 'choice';
