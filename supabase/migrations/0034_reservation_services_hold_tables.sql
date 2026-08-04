-- Spec 081 — cupo de reservas contado en MESAS, con colchón para walk-ins.
--
-- El cupo del modo flexible se configuraba sólo en cubiertos (`soft_capacity`),
-- y las reservas genéricas (las que crea la web) no ocupan mesa: un salón de 10
-- mesas podía comprometer 30 reservas sin que nada avisara. Ahora el motor
-- cuenta cuántas mesas consumen las reservas vivas del servicio y las compara
-- contra `mesas activas de la zona - hold_tables`.
--
-- `hold_tables` = mesas que el local quiere dejar SIEMPRE libres para los que
-- caen sin reservar. Default 0: ningún negocio cambia de comportamiento por
-- esta migración (el tope por cantidad de mesas sí empieza a valer, que es el
-- punto de la spec).

alter table public.reservation_services
  add column if not exists hold_tables int not null default 0
    check (hold_tables >= 0);

comment on column public.reservation_services.hold_tables is
  'Spec 081: mesas de la zona que quedan reservadas para walk-ins (no se ofrecen al cliente). El tope de reservas del servicio es (mesas activas de la zona - hold_tables). 0 = sin colchón.';
