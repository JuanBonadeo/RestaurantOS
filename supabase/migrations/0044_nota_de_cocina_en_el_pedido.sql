-- Nota de cocina del pedido (#173).
--
-- `orders.delivery_notes` es la nota del CLIENTE sobre la entrega ("tocar
-- timbre", "depto 3B") y sale en el ticket de control. Cocina necesita otra
-- cosa: una indicación de cuándo/cómo sacar el plato, que escribe el encargado
-- al marchar y que sale arriba de todo en la comanda como «ENTREGAR x».
--
-- Son dos notas distintas a propósito: mezclarlas mandaba la dirección del
-- cliente a la parrilla y la hora de entrega al repartidor.
alter table "public"."orders"
  add column if not exists "kitchen_notes" text;

comment on column "public"."orders"."kitchen_notes" is
  'Indicación del encargado para cocina, sale como «ENTREGAR x» arriba de la comanda. Distinta de delivery_notes (nota del cliente sobre la entrega, va al ticket de control).';
