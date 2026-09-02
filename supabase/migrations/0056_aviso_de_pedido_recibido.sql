-- 0056_aviso_de_pedido_recibido.sql
-- Spec 139 · el pedido lo confirma el local, y el cliente se entera (#212).
--
-- Entre que el cliente hace el pedido y que el local lo marcha no le llegaba
-- nada: el primer aviso era `preparing`. Justo en el tramo donde el pedido está
-- esperando una decisión, silencio.
--
-- El acuse es un estado notificable más, con su plantilla editable como los
-- otros cinco. Lo único que hace falta es que el check lo acepte.

alter table "public"."delivery_message_templates"
  drop constraint if exists "delivery_message_templates_status_check";

alter table "public"."delivery_message_templates"
  add constraint "delivery_message_templates_status_check" check (
    "status" = any (array[
      'pending'::text,
      'preparing'::text,
      'ready'::text,
      'on_the_way'::text,
      'delivered'::text,
      'cancelled'::text
    ])
  );

comment on column "public"."delivery_message_templates"."status" is
  'Estado del pedido que dispara el aviso. `pending` (spec 139) es el acuse: se manda al crear el pedido online, antes de que el local lo confirme.';
