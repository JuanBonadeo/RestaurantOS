-- 0089 · Por qué se bloqueó ese intento de fichaje
--
-- `clock_blocked_attempts` sólo se escribía desde el enforcement de origen
-- (spec 11), así que la fila no necesitaba decir por qué se bloqueó: siempre
-- era lo mismo. Ahora también escribe el techo de intentos por IP de
-- `clockPunch`, y las dos cosas se investigan distinto: un bloqueo de origen es
-- «alguien quiso fichar desde afuera del local», y uno de rate limit es
-- «alguien está probando PINs a lo bruto».
--
-- Default 'origin' para que las filas viejas —todas de la allowlist— queden
-- correctamente etiquetadas sin backfill.

alter table public.clock_blocked_attempts
  add column if not exists reason text not null default 'origin';

alter table public.clock_blocked_attempts
  drop constraint if exists clock_blocked_attempts_reason_check;

alter table public.clock_blocked_attempts
  add constraint clock_blocked_attempts_reason_check
  check (reason in ('origin', 'rate_limit'));

comment on column public.clock_blocked_attempts.reason is
  'origin = fuera de la allowlist de la LAN; rate_limit = techo de intentos por IP.';
