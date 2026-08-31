-- 0054_plantillas_de_reserva.sql
-- Spec 132 · la decisión sale por WhatsApp (#204).
--
-- Los cuatro avisos de la spec 131 (solicitud recibida / confirmada /
-- rechazada / vencida) salían sólo por email: un negocio con
-- `customer_channel = 'whatsapp'` no le avisaba NADA al cliente. Para mandar un
-- aviso proactivo por WhatsApp hace falta un template aprobado por Meta (fuera
-- de la ventana de 24 h el texto libre se rechaza), y eso se configura por
-- negocio — igual que en delivery.
--
-- Esta tabla es el espejo de `delivery_message_templates` para reservas.

create table if not exists "public"."reservation_message_templates" (
  "id" uuid default gen_random_uuid() not null primary key,
  "business_id" uuid not null references "public"."businesses"("id") on delete cascade,
  "event" text not null,
  "body" text not null,
  "enabled" boolean default true not null,
  -- Nombre del template aprobado en Meta. NULL = este evento no sale por
  -- WhatsApp (se omite el envío en vez de dejar una fila `failed`).
  "template_name" text,
  "template_lang" text default 'es_AR'::text not null,
  "created_at" timestamptz default now() not null,
  "updated_at" timestamptz default now() not null,
  constraint "reservation_message_templates_event_check" check (
    "event" = any (array['requested'::text, 'confirmed'::text, 'rejected'::text, 'expired'::text])
  ),
  constraint "reservation_message_templates_business_event_key" unique ("business_id", "event")
);

comment on table "public"."reservation_message_templates" is
  'Spec 132 — cuerpo editable + template de Meta por evento de reserva, por negocio.';

create trigger "reservation_message_templates_set_updated_at"
  before update on "public"."reservation_message_templates"
  for each row execute function "public"."set_updated_at"();

alter table "public"."reservation_message_templates" enable row level security;

-- Lectura: cualquier miembro del negocio. Escritura: sólo staff
-- (admin/encargado/mozo activo), como el resto de la config desde la 0019.
create policy "reservation_message_templates_select"
  on "public"."reservation_message_templates" for select to "authenticated"
  using ("public"."is_business_member"("business_id") or "public"."is_platform_admin"());

create policy "reservation_message_templates_insert"
  on "public"."reservation_message_templates" for insert to "authenticated"
  with check ("public"."is_business_staff"("business_id") or "public"."is_platform_admin"());

create policy "reservation_message_templates_update"
  on "public"."reservation_message_templates" for update to "authenticated"
  using ("public"."is_business_staff"("business_id") or "public"."is_platform_admin"())
  with check ("public"."is_business_staff"("business_id") or "public"."is_platform_admin"());

create policy "reservation_message_templates_delete"
  on "public"."reservation_message_templates" for delete to "authenticated"
  using ("public"."is_business_staff"("business_id") or "public"."is_platform_admin"());
