-- La observación de la tanda (spec 128 · #199).
--
-- El mozo tenía una sola forma de hablarle a cocina: la nota del ítem
-- (`order_items.notes`, sale como «obs: …» pegada al plato). Lo que vale para
-- el ENVÍO entero —«va todo junto», «la mesa tiene apuro», «hay un celíaco»—
-- no tenía dónde escribirse, y repetirlo por ítem no alcanza: la parrilla lee
-- su ticket y la fritera el suyo, así que una indicación de coordinación tiene
-- que salir igual en los dos papeles.
--
-- Va en la COMANDA y no en la orden, a propósito:
--   · la reimpresión (spec 035) vuelve a sacar el ticket tal cual salió, así
--     que la observación tiene que viajar con la comanda;
--   · una tanda no puede arrastrar la observación de otra —el «apuro» de las
--     20:10 no es el de las 21:40—;
--   · `orders.kitchen_notes` es del pedido, la escribe el encargado y define el
--     CUÁNDO (banner «ENTREGAR x»). La gobierna la spec 127; meter acá la nota
--     de una tanda repondría el enredo que esa spec está desarmando.
--
-- La misma copia en cada comanda del envío: es lo que la hace legible en el
-- papel de cada sector sin un join más en el endpoint del print-agent.
alter table "public"."comandas"
  add column if not exists "notes" text;

comment on column "public"."comandas"."notes" is
  'Spec 128: observación del ENVÍO que escribe el mozo al enviar. Misma copia en todas las comandas de la tanda; sale como «OBS: …» entre el encabezado y los ítems. Distinta de orders.kitchen_notes (del pedido, banner ENTREGAR) y de order_items.notes (de un plato).';
