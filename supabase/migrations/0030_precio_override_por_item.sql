-- Spec 069 · Precio por ítem editable con motivo (override de mostrador).
--
-- El encargado puede cobrar una línea a un precio distinto al de catálogo SOLO
-- para ese pedido (plato fuera de carta, cortesía a $0, media porción, error de
-- la carta impresa, precio pactado). Requiere motivo, igual que anular mesa o
-- cancelar un ítem.
--
-- ⚠️ CAMBIO DE SIGNIFICADO de `order_items.unit_price_cents`: pasa de "precio de
-- catálogo snapshoteado" a "precio EFECTIVAMENTE COBRADO". Cuando hay override,
-- el precio de lista queda en `price_original_cents`. Cualquier lectura que
-- asuma `unit_price_cents == products.price_cents` está mal a partir de acá.
--
-- Por qué en la línea y no como descuento de la orden (que ya existe): el
-- descuento cuelga de `orders`, así que la ingeniería de menú sigue viendo el
-- plato a precio de lista (margen inflado), ARCA factura un ítem a un precio que
-- no se cobró, y dos cortesías distintas en la misma mesa se funden en un solo
-- número + un solo motivo.
--
-- Aditiva: todo el histórico queda con price_override_at IS NULL (= nunca se
-- tocó el precio), así que ningún reporte viejo cambia.
--
-- Sin cambios de RLS: las policies de `order_items` ya scopean por
-- orders.business_id y cubren estas columnas.

-- `price_original_cents` es bigint, igual que `unit_price_cents`: son el mismo
-- tipo de dato (precio en centavos) y no pueden tener techos distintos.
alter table public.order_items
  add column if not exists price_original_cents bigint,
  add column if not exists price_override_at timestamptz,
  add column if not exists price_override_by uuid references public.users(id) on delete set null,
  add column if not exists price_override_reason text;

-- El reporte de «Precios modificados» busca las pocas líneas tocadas dentro de
-- un rango de fechas. Parcial para no pesar sobre la tabla más grande del
-- sistema: en la práctica indexa decenas de filas, no millones.
create index if not exists idx_order_items_price_override
  on public.order_items (order_id)
  where price_override_at is not null;

comment on column public.order_items.unit_price_cents is
  'Spec 069: precio EFECTIVAMENTE COBRADO por unidad, en centavos. Normalmente es el precio de catálogo snapshoteado al cargar, pero si price_override_at no es null el encargado lo cambió a mano para este pedido y el de lista quedó en price_original_cents. No asumir que coincide con products.price_cents.';
comment on column public.order_items.price_original_cents is
  'Spec 069: precio de CATÁLOGO al momento del primer override, en centavos. Null = nunca se tocó el precio de esta línea. No se pisa en overrides sucesivos: el delta del reporte se mide siempre contra la lista, no contra el ajuste anterior.';
comment on column public.order_items.price_override_at is
  'Spec 069: discriminador canónico de "esta línea tiene precio modificado". Se limpia al volver al precio de lista o al cambiar el producto de la línea.';
comment on column public.order_items.price_override_by is
  'Spec 069: usuario (encargado/admin) que cambió el precio. Puede no ser el mismo que loaded_by — el mozo carga, el encargado ajusta.';
comment on column public.order_items.price_override_reason is
  'Spec 069: motivo del cambio de precio, texto libre obligatorio (misma regla que cancelled_reason). Se muestra en el reporte de precios modificados.';
