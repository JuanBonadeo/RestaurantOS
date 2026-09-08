-- ────────────────────────────────────────────────────────────────────────
-- 0081 — siempre hay una caja principal
--
-- De la caja principal cuelgan las dos guardas del cierre: no cerrar con
-- cuentas abiertas y no cerrar con mozos sin rendir. `cerrarCaja` las gatea con
-- `caja.is_default` y se lo pasa a la RPC como `p_barrer_salon`.
--
-- El problema: **nada garantizaba que existiera una**. `cajas_one_default_per_business`
-- es un índice único PARCIAL — asegura como mucho una, nunca al menos una. Y
-- ningún camino la crea: `crearCaja` inserta sin `is_default`, el trigger de
-- alta de negocio sólo siembra la Caja Mayor (administrativa, que no cobra ni
-- se arquea), y `setCajaDefault` es una acción manual que alguien tiene que
-- acordarse de hacer.
--
-- O sea que un negocio recién dado de alta —un cliente nuevo entrando— opera
-- con las guardas apagadas hasta que a alguien se le ocurre marcar la caja. El
-- cierre no chequea mesas abiertas, no exige rendiciones y no barre el salón, y
-- reporta éxito. Es el mismo agujero de la issue #254 pero llegando por el otro
-- lado: aquélla era «te la desactivan», ésta es «nunca la hubo».
--
-- Se descubrió porque el demo local recién sembrado tenía las tres cajas en
-- `is_default = false`, y un E2E de P03 que esperaba el bloqueo se puso en rojo.
-- En la nube los tres negocios (demo, golf-jcr, kcc) ya tienen la suya, así que
-- el backfill de abajo es no-op allá: esto protege al que viene.
--
-- La garantía va en la base y no en la app a propósito: la crean el panel, el
-- seed y cualquier script, y todos tienen que quedar consistentes.
--
-- Hallazgo: issue #266 · relacionado: #254
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.caja_default_si_no_hay()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- La administrativa nunca es la principal: no cobra ni se arquea (spec 160),
  -- y el CHECK de la 0067 lo prohíbe explícitamente.
  if new.is_administrative or new.is_default or not new.is_active then
    return new;
  end if;

  if not exists (
    select 1 from public.cajas
     where business_id = new.business_id
       and is_default
       and id <> new.id
  ) then
    update public.cajas set is_default = true where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists caja_default_si_no_hay on public.cajas;
create trigger caja_default_si_no_hay
  after insert on public.cajas
  for each row
  execute function public.caja_default_si_no_hay();

-- Backfill: los negocios que hoy no tienen ninguna marcada se quedan con la
-- primera caja de turno activa, por `sort_order` — que es el orden en que la
-- pantalla las muestra, así que es la que el encargado llama «la principal».
with candidata as (
  select distinct on (c.business_id) c.id
    from public.cajas c
   where c.is_active
     and not c.is_administrative
     and not exists (
       select 1 from public.cajas d
        where d.business_id = c.business_id and d.is_default
     )
   order by c.business_id, c.sort_order, c.created_at
)
update public.cajas set is_default = true
 where id in (select id from candidata);

comment on function public.caja_default_si_no_hay() is
  'La primera caja de turno de un negocio queda como principal (0081). De esa marca cuelgan las guardas del cierre; sin ninguna, el día se cierra sin controlar mesas abiertas ni rendiciones.';
