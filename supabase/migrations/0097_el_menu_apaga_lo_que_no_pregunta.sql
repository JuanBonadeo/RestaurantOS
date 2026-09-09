-- El menú apaga los modificadores que no quiere preguntar (spec 175, issue #282).
--
-- Cuando el plato elegido dentro de un menú trae su propio `modifier_group`
-- —la «Guarnición» de la Milanesa—, ése gana y el `choice_group` del menú nunca
-- aparece. Y son distintos: las opciones del grupo del menú son PRODUCTOS, así
-- que el `Puré` puede preguntar su «Variante»; las del grupo del producto son
-- filas de `modifiers`, que son hojas. Por eso en golf-jcr no se podía elegir el
-- tipo de puré si el puré era la guarnición de la Milanesa (#280).
--
-- Va en el componente y no en el producto porque lo que se apaga es «esta
-- opción, en ESTE menú»: la Milanesa suelta tiene que seguir preguntando su
-- guarnición en la carta.
--
-- Sin backfill: el array vacío es exactamente la conducta de hoy. Y sin FK a
-- `modifier_groups` —es un uuid[], igual que `applies_when_product_ids` al
-- lado—: si el grupo se borra del producto, el id queda muerto en el array y el
-- filtro simplemente no matchea, que es la degradación correcta.
alter table public.daily_menu_components
  add column if not exists ignored_modifier_group_ids uuid[] not null default '{}';

comment on column public.daily_menu_components.ignored_modifier_group_ids is
  'Grupos de modificadores del producto de esta opción que el menú NO pregunta (spec 175). Vacío = se preguntan todos, la conducta previa. El server filtra con el mismo dato: un grupo apagado tampoco se exige.';
