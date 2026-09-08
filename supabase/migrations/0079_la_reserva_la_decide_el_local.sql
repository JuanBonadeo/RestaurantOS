-- ────────────────────────────────────────────────────────────────────────
-- 0079 — la reserva la decide el local, no el que la pidió
--
-- `reservations_update` era
--   USING/WITH CHECK (is_business_staff(business_id) OR user_id = auth.uid())
-- o sea que el dueño de la reserva podía escribir **cualquier columna** de su
-- propia fila. Y eso no pide hackear nada: el navegador del cliente ya tiene su
-- access token (la página monta un cliente de Supabase para el realtime) y la
-- anon key es pública. Con un PATCH a PostgREST el cliente se confirmaba la
-- reserva solo, se la marcaba `seated`, se ponía 40 comensales y se corría el
-- horario.
--
-- Confirmada quedaba con `decided_at` y `decided_by` en NULL —nadie decidió
-- nada— y el encargado la veía en verde asumiendo que la confirmó un compañero.
-- `seated` le come la mesa en el plano y en el GIST del servicio sin que haya
-- nadie sentado.
--
-- El cliente no necesita este UPDATE: cancelar la suya va por
-- `cancelOwnReservation`, que es una server action y escribe con el service
-- client (y de paso valida la ventana de cancelación y el estado). Ningún
-- componente del cliente escribe `reservations` directo — sólo lee.
--
-- SELECT se deja como está: que el cliente VEA su reserva y su estado es el
-- punto de la pantalla de seguimiento.
--
-- Hallazgo: issue #261 · caso de uso: wiki/qa/procesos/P08-entra-una-reserva-de-la-web.md
-- ────────────────────────────────────────────────────────────────────────

drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations
  for update to authenticated
  using (public.is_business_staff(business_id))
  with check (public.is_business_staff(business_id));

comment on table public.reservations is
  'Reservas. Las decide el LOCAL: desde la 0079 sólo el staff puede hacer UPDATE. El cliente lee la suya y la cancela por `cancelOwnReservation` (server action, service client).';
