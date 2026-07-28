-- 0023_reservations_realtime.sql — Spec 059
-- Reservas en vivo en el salón: sumar `reservations` a la publicación de realtime
-- (como hizo 0040 con `tables`). Sin esto, el encargado no ve las reservas nuevas
-- hasta recargar. Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end $$;
