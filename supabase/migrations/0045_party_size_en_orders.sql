-- Cuántas personas se sentaron en la mesa (spec 111).
--
-- El formulario de walk-in venía pidiendo «Personas» desde siempre —seis
-- botones, stepper y atajos 1-9— y el dato **se tiraba**: `sentarWalkIn` lo
-- validaba con Zod, no se lo pasaba a `openTable` y no había dónde guardarlo
-- (`party_size` sólo existía en `reservations`). El control más prominente de
-- la pantalla de sentar escribía en el vacío.
--
-- Va en `orders` y no en `tables` porque es de la visita, no del mueble: la
-- mesa se libera y se vuelve a ocupar varias veces por turno, y lo que hay que
-- poder mirar después —cubiertos, ticket por persona, ocupación real— es por
-- visita.
--
-- Nullable a propósito: lo cargado antes de esta migración no se puede
-- inventar, y sigue sin ser obligatorio para abrir una mesa (FR-013: es un tap,
-- no un paso).
alter table "public"."orders"
  add column if not exists "party_size" integer;

alter table "public"."orders"
  drop constraint if exists "orders_party_size_check";

alter table "public"."orders"
  add constraint "orders_party_size_check"
  check ("party_size" is null or "party_size" > 0);

comment on column "public"."orders"."party_size" is
  'Cuántas personas se sentaron (mesa) o para cuántas es el pedido. Null = no se cargó. Distinto de reservations.party_size, que es lo reservado y no lo que finalmente vino.';
