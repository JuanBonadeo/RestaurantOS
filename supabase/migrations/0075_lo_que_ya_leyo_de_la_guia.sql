-- 0075 · Lo que ya leyó de la guía (spec 169, issue #255)
--
-- La spec 142 (D4) manda a la guía al que termina la bienvenida, pero nadie se
-- entera de si la leyó: cae en un índice de veinte tarjetas y ahí termina la
-- historia. Esta tabla es lo único que hace falta para que el sistema sepa por
-- dónde va — el recorrido, el «3 de 9» y el pendiente del sidebar salen de acá.
--
-- POR QUÉ UNA TABLA Y NO `user_metadata` (D6): el JSON del usuario de Auth es
-- global y no está scopeado por negocio. La misma persona puede ser encargada
-- en House y mozo en Golf: son dos recorridos distintos, con temas distintos, y
-- terminar uno no puede apagar el otro. Multi-tenant estricto, como todo el
-- resto — la PK arranca por `business_id`.
--
-- POR QUÉ `tema` ES TEXT Y NO UN ENUM NI UN FK: los slugs viven en
-- `src/lib/ayuda/contenido.ts`, que es un dato tipado en el repo (spec 134 D8).
-- No hay tabla de temas contra la cual apuntar, y un enum obligaría a una
-- migración cada vez que se escribe un tema nuevo. La contracara es que quedan
-- lecturas huérfanas cuando un tema se borra o se renombra: `progresoDelRecorrido`
-- cuenta contra el recorrido de hoy y no contra las filas, justamente por esto.

create table if not exists public.ayuda_lecturas (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tema        text not null,
  leido_at    timestamptz not null default now(),
  primary key (business_id, user_id, tema)
);

comment on table public.ayuda_lecturas is
  'Temas de la guía que cada persona ya leyó, por negocio (spec 169). Una fila = llegó al pie del tema y apretó el botón.';
comment on column public.ayuda_lecturas.tema is
  'Slug del tema en src/lib/ayuda/contenido.ts. Sin FK: los temas son código, no filas.';

alter table public.ayuda_lecturas enable row level security;

-- Cada uno ve y marca LO SUYO, y sólo en negocios donde es miembro.
--
-- `user_id = auth.uid()` no es redundante con `is_business_member`: sin él, un
-- encargado podría leer —y escribirle— el progreso de sus compañeros. No es
-- plata, pero tampoco es asunto suyo, y una tabla nueva se abre lo mínimo.
drop policy if exists ayuda_lecturas_select on public.ayuda_lecturas;
create policy ayuda_lecturas_select on public.ayuda_lecturas
  for select to authenticated
  using (user_id = (select auth.uid()) and public.is_business_member(business_id));

drop policy if exists ayuda_lecturas_insert on public.ayuda_lecturas;
create policy ayuda_lecturas_insert on public.ayuda_lecturas
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_business_member(business_id));

-- Sin UPDATE y sin DELETE a propósito: marcar un tema leído es un
-- `on conflict do nothing`, así que `leido_at` guarda la PRIMERA vez que lo
-- leyó y no la última que volvió a pasar por ahí. Nada de la app necesita
-- borrar; lo que quede denegado por ausencia de policy es más restrictivo que
-- cualquier cosa que pudiéramos escribir hoy "por las dudas".
