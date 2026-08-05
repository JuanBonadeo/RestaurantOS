-- Spec 087 · Se van las dos columnas que el grupo-como-entidad reemplazó.
--
-- `choice_group_label`: el nombre del grupo repetido en cada una de sus
-- opciones. Dos filas del mismo grupo podían tener nombres distintos y todos
-- los lectores tomaban, arbitrariamente, el de la primera que encontraban.
-- Ahora vive una sola vez, en `daily_menu_choice_groups.name`.
--
-- `blocks_choice_group_ids`: la condición escrita en la opción y en negativo
-- («qué grupos NO habilita esta opción»). Ahora es una condición por grupo, en
-- positivo (`applies_when_group_id` + `applies_when_product_ids`), que es como
-- la piensa y la edita el encargado.
--
-- Se dropea recién ahora porque la resolución de qué grupos aplican pasó por
-- tres etapas: primero la tabla se pobló (0036), después la escribieron todos
-- los caminos de guardado, y por último `validateComboChoices` —el validador
-- del server, el que toca plata— dejó de leer la columna. Hasta ese punto
-- borrarla habría roto la persistencia de pedidos.
--
-- Rollback: `specs/087-grupos-del-menu-como-entidad/rollback-0038.sql`. No es un
-- volcado de datos sino el inverso exacto del backfill de la 0036, así que no se
-- pone rancio. Verificado contra las 53 filas reales antes de dropear: reconstruye
-- ambas columnas con cero diferencias.

alter table public.daily_menu_components
  drop column if exists blocks_choice_group_ids;

alter table public.daily_menu_components
  drop column if exists choice_group_label;
