-- 0021 — Separar "visible en la carta online" de "disponible para vender"
--
-- Hasta ahora la carta pública (src/lib/menu.ts) y la app del mozo
-- (src/lib/mozo/catalog-query.ts) filtraban con los MISMOS dos flags:
-- `is_active` + `is_available`. No había forma de sacar un producto de la web
-- sin sacárselo también al mozo, que lo necesita para cargar la mesa.
--
-- Caso real (golf-jcr): el catálogo tiene ~400 productos heredados del POS
-- (kiosko, alfajores, latas, sugerencias del día) que NO van en la carta que
-- ve el socio, pero SÍ tienen que seguir disponibles en el salón.
--
-- `show_online` default true → nada cambia hasta que se marque explícitamente.

alter table public.products
  add column if not exists show_online boolean not null default true;

comment on column public.products.show_online is
  'Visible en la carta pública/online. El mozo y el admin ven el producto igual. Default true.';

-- El filtro de la carta pública siempre viene acompañado de business_id + is_active.
create index if not exists products_show_online_idx
  on public.products (business_id, show_online)
  where show_online;
