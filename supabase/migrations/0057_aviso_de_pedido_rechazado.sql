-- 0057_aviso_de_pedido_rechazado.sql
-- Spec 139 · el rechazo tiene su propio aviso (#212).
--
-- Para el cliente no es lo mismo «no pudimos tomar tu pedido» que «tu pedido
-- fue cancelado»: lo primero pasa antes de que nadie cocine y suele tener un
-- motivo que le sirve (estamos cerrando, no llegamos con la zona). El pedido
-- por dentro queda `cancelled` —los estados de `orders` están cableados al
-- kanban, la caja y los reportes—, pero el AVISO es propio y editable.

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
      'cancelled'::text,
      'rejected'::text
    ])
  );
