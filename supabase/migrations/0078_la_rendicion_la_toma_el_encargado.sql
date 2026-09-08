-- ────────────────────────────────────────────────────────────────────────
-- 0078 — la rendición la toma el encargado, no el que la debe
--
-- `registrarRendicionMozo` chequea `canRendirMozo` (admin | encargado) en la
-- server action, pero la policy de la base decía
-- `WITH CHECK (is_platform_admin() OR is_business_member(business_id))`:
-- **cualquier miembro del negocio**, incluido el mozo, podía insertar su propia
-- rendición.
--
-- Y eso no requiere hackear nada: con su propio JWT —el que el navegador ya
-- tiene— más la anon key, que es pública, un mozo insertaba en
-- `mozo_rendiciones` la entrega de los $50.000 que tenía encima y desaparecía
-- de «deben rendir». La fila quedaba con `registered_by` apuntándolo a él
-- mismo, pero una rendición más no llama la atención de nadie, y el faltante
-- recién aparece en el arqueo — donde se lo come el que contó el cajón.
--
-- El chequeo en TS no alcanzaba porque PostgREST expone la tabla directo: la
-- server action es un camino, no una puerta.
--
-- `is_business_manager(bid)` es exactamente `canRendirMozo`: `role in
-- ('admin','encargado')` con `disabled_at is null`, más platform admin. Se usa
-- ésa y no una condición nueva para que la regla tenga un solo dueño.
--
-- SELECT se deja como está a propósito: que el mozo VEA sus rendiciones está
-- bien —es su plata— y la pantalla del mozo lo necesita. Lo que no puede es
-- escribirlas.
--
-- Hallazgo: issue #264 · caso de uso: wiki/qa/procesos/P11-rendir-el-turno.md
-- Reproducción: src/lib/caja/rendicion-rls.integration.test.ts (con JWT real)
-- ────────────────────────────────────────────────────────────────────────

drop policy if exists mozo_rendiciones_insert on public.mozo_rendiciones;
create policy mozo_rendiciones_insert on public.mozo_rendiciones
  for insert to authenticated
  with check (public.is_business_manager(business_id));

-- Misma razón: corregir una rendición ya tomada es la misma decisión que
-- tomarla. Si el insert lo gatea el rol, el update también.
drop policy if exists mozo_rendiciones_update on public.mozo_rendiciones;
create policy mozo_rendiciones_update on public.mozo_rendiciones
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

comment on table public.mozo_rendiciones is
  'Entregas de efectivo de cada mozo al cierre. Las escribe SOLO admin/encargado (0078): el que rinde no firma su propia rendición. El mozo sí las lee.';
