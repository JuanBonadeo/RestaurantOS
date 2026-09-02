-- ============================================================================
-- 0058 — El rol `terminal` (spec 140)
--
-- La terminal es el puesto compartido del salón: una PC que usan todos los
-- mozos cuando no tienen móvil propio (Etapa 1 de golf-house). No es una
-- persona, es un puesto — y eso es justamente por qué es un rol y no un mozo
-- más.
--
-- Toda la app enumera "los mozos" por rol:
--
--   getMozosByBusiness                  → .in("role", ['admin','encargado','mozo'])
--   getRendicionesPendientesTodosLosMozos → .in("role", ['mozo','encargado'])
--
-- La primera alimenta la paleta de «Distribuir mozos» del plano; la segunda, el
-- panel de rendiciones pendientes del encargado. Si la cuenta compartida fuera
-- rol `mozo`, aparecería en las dos como una persona más: para asignarle mesas
-- —que es mandarle la plata a su rendición— y para pedirle que rinda. Un rol
-- propio la deja afuera de esas listas sin tocar una sola query.
--
-- Aditiva y reversible: sólo amplía un CHECK y una función. Ninguna fila
-- existente cambia, y mientras nadie cree un miembro con este rol el
-- comportamiento del sistema es idéntico al de antes.
-- ============================================================================

-- 1. El CHECK de la membresía.
alter table public.business_users
  drop constraint if exists business_users_role_check;

alter table public.business_users
  add constraint business_users_role_check
  check (role = any (array['admin'::text, 'encargado'::text, 'mozo'::text,
                           'terminal'::text, 'personal'::text]));

-- 2. El backstop de RLS. `is_business_staff` es lo que usan las policies de
--    `reservations` (y las que vengan) para decir "esto lo toca gente del
--    local". La terminal gestiona la agenda del salón igual que el mozo, así
--    que entra. `personal` sigue afuera, como estaba.
create or replace function public.is_business_staff("bid" uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1 from public.business_users
    where business_id = bid
      and user_id = auth.uid()
      and role in ('admin', 'encargado', 'mozo', 'terminal')
      and disabled_at is null
  );
$$;

comment on constraint business_users_role_check on public.business_users is
  'Spec 140: `terminal` es el puesto compartido del salón, no una persona — por eso queda afuera de las listas de mozos (asignación de mesas, rendiciones).';
