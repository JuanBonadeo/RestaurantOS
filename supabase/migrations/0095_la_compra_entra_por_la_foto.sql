-- ────────────────────────────────────────────────────────────────────────
-- 0095 · La compra entra por la foto
--
-- «Cargar compra» deja de ser un diálogo de 384 px y pasa a ser una página: la
-- foto grande a la izquierda, el formulario y los renglones leídos a la derecha.
-- Esta migración pone abajo las cuatro piezas de datos que esa pantalla necesita
-- y que hoy no existen:
--
--   1 · `supplier_invoices.photo_urls` — un comprobante tiene N fotos, no una.
--       «a veces los tickets son muy largos» (dueño del producto, textual).
--   2 · `normalizar_nombre_proveedor()` — la misma idea que la 0092 hizo para
--       insumos, ahora para el nombre del proveedor.
--   3 · el índice único que impide dos proveedores activos con el mismo nombre.
--   4 · `proponer_proveedor_para_cabecera()` — la cabecera leída del papel trae
--       nombre y CUIT; esto los convierte en un proveedor del catálogo.
--
-- El contexto: hoy hay que ENTRAR a la ficha del proveedor para recién ahí poder
-- cargarle una compra. El pedido es que sea al revés — sacás la foto y el
-- sistema te dice de quién es. Eso es lo que hace la RPC de la pieza 4.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 · un comprobante, N fotos ───────────────────────────────────────────
--
-- `photo_url` (singular) venía del baseline y quedó chica: un remito de verdulería
-- son tres hojas y un ticket de mayorista es una tira de 80 cm que no entra en una
-- foto legible. El lector ya lee por página y une los renglones en el código; lo
-- que faltaba era dónde guardarlas.
--
-- `photo_url` NO se dropea acá, a propósito. Entre que esta migración se aplica y
-- que el deploy nuevo está arriba hay una ventana —minutos, pero real— en la que
-- el código VIEJO sigue insertando en `photo_url`. Si la columna ya no está, cada
-- alta de compra en esa ventana revienta con «column photo_url does not exist»,
-- que es un error de producción por un problema de orden. El drop va en un tramo
-- posterior, cuando el deploy esté arriba y no quede nadie escribiéndola. Mientras
-- tanto el alta escribe LAS DOS: `photo_urls` completo y `photo_url` con la primera.
alter table public.supplier_invoices
  add column if not exists photo_urls text[] not null default '{}';

-- El backfill es literalmente una fila: en la nube hay UN solo comprobante con
-- foto en los tres negocios (medido). Igual va con la guarda de idempotencia
-- por si la migración se corre dos veces sobre la misma base.
update public.supplier_invoices
   set photo_urls = array[photo_url]
 where photo_url is not null
   and btrim(photo_url) <> ''
   and coalesce(array_length(photo_urls, 1), 0) = 0;

-- El tope de 5 es el mismo que valida el endpoint, y tiene que estar acá también:
-- el endpoint lo chequea para no reventar el techo de 45 s del lector, pero nada
-- impide que otro camino (un import, un fix a mano) meta 40 paths y deje una fila
-- que la pantalla no puede dibujar.
--
-- El `array_position(..., null)` es el que importa de verdad: un null adentro del
-- array se cuela sin ruido —`array_append(x, null)` no falla— y recién aparece
-- cuando `createSignedUrls` recibe un path nulo y devuelve una foto rota, con la
-- compra ya guardada. El '' es el mismo caso con otra cara.
alter table public.supplier_invoices
  drop constraint if exists supplier_invoices_photo_urls_check;
alter table public.supplier_invoices
  add constraint supplier_invoices_photo_urls_check
  check (
    coalesce(array_length(photo_urls, 1), 0) <= 5
    and array_position(photo_urls, null::text) is null
    and array_position(photo_urls, '') is null
  );

comment on column public.supplier_invoices.photo_urls is
  'Spec 173 · los paths de las fotos del comprobante, en orden de página (máx. 5). Reemplaza a photo_url, que se mantiene escrita por compatibilidad hasta que el deploy esté arriba.';

-- ── 2 · el normalizador de nombres de proveedor ───────────────────────────
--
-- Se apoya en `normalizar_texto_insumo` (0092) en vez de repetir el translate de
-- acentos: es la misma deuda 164·D3 —«hacerla dos veces es hacerla mal una»—, sólo
-- que un nivel más arriba. Si mañana se agrega un carácter al translate, se agrega
-- en un solo lugar.
--
-- Lo que suma es sacar las formas societarias, que son ruido puro para comparar:
-- el mismo proveedor entra al catálogo como «Frigorífico del Sur», el remito dice
-- «FRIGORIFICO DEL SUR S.A.» y la factura «Frigorifico del Sur SA». Son tres
-- claves distintas para el mismo señor.
--
-- Ojo con los falsos positivos, que es el motivo del `\m…\M`: sin los límites de
-- palabra, «casa» se convierte en «ca» y «Sasa» en «a». MEDIDO en esta misma base:
-- con los límites, 'casa blanca sasa' queda intacto y 'coca cola s a' queda
-- 'coca cola', que es lo que se busca.
--
-- Las formas con puntos llegan acá ya partidas en letras sueltas, porque el paso
-- de abajo convierte todo lo que no es alfanumérico en espacio: «S.R.L.» es
-- «s r l» cuando esta regex lo mira. Por eso la alternancia lista las dos caras de
-- cada forma, y las multi-palabra van primero (POSIX prefiere el match más largo,
-- verificado: 's a s' se come entera y no deja una 's' colgada).
--
-- El `case` final es la red: un proveedor que se llame literalmente «SA» quedaría
-- con clave vacía y colisionaría en el índice único con cualquier otro igual de
-- desafortunado. Si sacar las formas deja la nada, vale el nombre sin tocar.
create or replace function public.normalizar_nombre_proveedor(p text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select case when v.limpio = '' then v.base else v.limpio end
    from (
      select b.base,
             btrim(regexp_replace(
               regexp_replace(
                 b.base,
                 '\m(s r l|s a s|s a|s c|srl|sas|sa|sc|ltda|cia|hnos)\M',
                 ' ', 'g'),
               ' +', ' ', 'g')) as limpio
        from (select public.normalizar_texto_insumo(p) as base) b
    ) v;
$$;

comment on function public.normalizar_nombre_proveedor is
  'Spec 173 · la clave normalizada de un nombre de proveedor: lo mismo que normalizar_texto_insumo más las formas societarias (S.A., S.R.L., SAS, Ltda, Cía, Hnos), que son ruido para comparar. Una sola definición para el índice único y para el matcher de cabecera.';

grant execute on function public.normalizar_nombre_proveedor(text) to authenticated, service_role;

-- ── 3 · el índice que impide los proveedores gemelos ──────────────────────
--
-- Mismo razonamiento que el `ingredients_business_name_norm_uidx` de la 0092: el
-- problema no es limpiar los duplicados que hay, es impedir los que la pantalla
-- nueva va a crear. «Crear proveedor» va a estar a un botón de distancia adentro
-- del flujo de carga, apurado, en el medio de revisar 14 renglones — es la receta
-- exacta para terminar con «La Serenisima», «LA SERENISIMA SA» y «La Serenísima
-- S.A.» como tres proveedores con tres cuentas corrientes distintas.
--
-- MEDIDO contra el cloud antes de escribirlo: CERO colisiones en los tres
-- negocios, así que entra limpio. El bloque de abajo igual cuenta y aborta con el
-- select para revisarlas, como hace la 0091 con los adicionales cruzados: si
-- alguien aplica esto sobre una base con datos que no medimos, tiene que enterarse
-- acá y no con un `duplicate key` sin contexto.
--
-- Sólo sobre los activos, igual que en insumos: un proveedor dado de baja puede
-- compartir nombre con el que lo reemplazó, y forzar la unicidad ahí rompería
-- bajas ya hechas.
do $colisiones$
declare
  v_dup int;
begin
  select count(*) into v_dup
    from (
      select business_id, public.normalizar_nombre_proveedor(name)
        from public.suppliers
       where is_active
       group by 1, 2
      having count(*) > 1
    ) x;

  if v_dup > 0 then
    raise exception
      'Hay % nombres de proveedor activos que colapsan al normalizar. Revisalos antes de aplicar: select business_id, public.normalizar_nombre_proveedor(name) as clave, array_agg(name), array_agg(id) from public.suppliers where is_active group by 1, 2 having count(*) > 1;',
      v_dup;
  end if;
end
$colisiones$;

create unique index if not exists suppliers_business_name_norm_uidx
  on public.suppliers (business_id, public.normalizar_nombre_proveedor(name))
  where is_active;

-- ── 4 · de la cabecera leída al proveedor del catálogo ────────────────────
--
-- Lo que hoy hace la persona a mano: mira el papel, reconoce el nombre, entra a la
-- ficha de ESE proveedor y recién ahí carga la compra. Dado vuelta: la foto trae
-- nombre y CUIT, y esto responde de quién es.
--
-- Corre en la base y no en TypeScript por lo mismo que `proponer_insumos_para_lineas`
-- (0092): los umbrales se midieron con `pg_trgm` y reimplementar trigramas en TS
-- haría que esos números dejaran de aplicar. Se usan los MISMOS —0,62 de piso y
-- 0,15 de margen contra el segundo— a propósito: son dos matchers hermanos, y dos
-- juegos de umbrales serían dos cosas que ajustar cada vez.
--
-- `search_path` incluye `extensions`: pg_trgm vive ahí y no en `public`, así que
-- el `set search_path = public` del resto del módulo haría fallar
-- `word_similarity` en runtime.
--
-- ── Por qué el CUIT no resuelve solo ──────────────────────────────────────
--
-- Parecería que un CUIT igual es identidad y listo. NO: medido en el cloud,
-- golf-jcr tiene 71 CUIT bien formados y sólo 69 distintos, kcc 73 y 71. O sea que
-- el CUIT YA está repetido entre proveedores distintos —el mismo grupo facturando
-- con dos razones sociales cargadas por separado, o un CUIT tipeado mal que
-- coincidió con otro—. Con dos candidatos, «resuelto» elegiría uno de los dos al
-- azar y le escribiría la compra a la cuenta corriente equivocada. Por eso 2+ es
-- SIEMPRE «propuesto»: que elija la persona, que tiene el papel en la mano.
--
-- El estado nunca es una orden: «resuelto» es una precarga que la pantalla muestra
-- y se puede cambiar. Lo único que esta función no puede hacer es escribir sola.
create or replace function public.proponer_proveedor_para_cabecera(
  p_business_id uuid,
  p_nombre      text,
  p_cuit        text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cuit      text;
  v_norm      text;
  v_cands     jsonb;
  v_n         int;
  v_id        uuid;
  v_name      text;
  v_cand_cuit text;
  v_score     numeric;
  v_top2      numeric;
begin
  -- Los 11 dígitos, sin guiones ni puntos ni espacios: el papel escribe
  -- «30-71234567-8», el catálogo guarda «30712345678», y son el mismo CUIT.
  -- Si no son exactamente 11 dígitos no es un CUIT, es un OCR fallado — y
  -- comparar por un prefijo sería peor que no comparar.
  v_cuit := nullif(regexp_replace(coalesce(p_cuit, ''), '[^0-9]', '', 'g'), '');
  if v_cuit is not null and length(v_cuit) <> 11 then
    v_cuit := null;
  end if;

  v_norm := nullif(normalizar_nombre_proveedor(coalesce(p_nombre, '')), '');

  -- L1 · el CUIT. Es el identificador fiscal: cuando hay uno solo, es él.
  if v_cuit is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'cuit', s.cuit, 'score', 1, 'via', 'cuit'
           ) order by s.name), '[]'::jsonb), count(*)
      into v_cands, v_n
      from suppliers s
     where s.business_id = p_business_id
       and s.is_active
       and regexp_replace(coalesce(s.cuit, ''), '[^0-9]', '', 'g') = v_cuit;

    if v_n = 1 then
      return jsonb_build_object('estado', 'resuelto', 'candidatos', v_cands);
    elsif v_n > 1 then
      return jsonb_build_object('estado', 'propuesto', 'candidatos', v_cands);
    end if;
  end if;

  -- L2 · el nombre normalizado. No es una adivinanza: la cadena, sin mayúsculas,
  -- sin acentos y sin el «S.A.», ES el nombre del proveedor. El índice de arriba
  -- garantiza que entre los activos haya como mucho uno; el `> 1` queda igual por
  -- si esto corre contra una base donde el índice todavía no entró.
  if v_norm is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'cuit', s.cuit, 'score', 1, 'via', 'nombre'
           ) order by s.name), '[]'::jsonb), count(*)
      into v_cands, v_n
      from suppliers s
     where s.business_id = p_business_id
       and s.is_active
       and normalizar_nombre_proveedor(s.name) = v_norm;

    if v_n = 1 then
      return jsonb_build_object('estado', 'resuelto', 'candidatos', v_cands);
    elsif v_n > 1 then
      return jsonb_build_object('estado', 'propuesto', 'candidatos', v_cands);
    end if;
  end if;

  -- L3 · el fuzzy. Misma fórmula que la 0092 y por la misma razón:
  -- `word_similarity` sola encuentra el nombre del catálogo adentro del texto
  -- impreso («Frigorífico del Sur» dentro de «FRIGORIFICO DEL SUR - SUCURSAL 2»)
  -- pero prefiere sistemáticamente al más corto y genérico; el término
  -- `similarity` lo penaliza y desarma la trampa.
  --
  -- Nunca «resuelto», por más alto que dé: acá el que decide es el que tiene el
  -- remito en la mano. Un fuzzy que auto-resuelve escribe una compra en la cuenta
  -- corriente de otro proveedor, y eso se descubre en la conciliación de fin de mes.
  if v_norm is not null and length(v_norm) >= 3 then
    with puntajes as (
      select s.id, s.name, s.cuit,
             0.6 * word_similarity(normalizar_nombre_proveedor(s.name), v_norm)
           + 0.4 * similarity(normalizar_nombre_proveedor(s.name), v_norm) as score
        from suppliers s
       where s.business_id = p_business_id
         and s.is_active
       order by score desc
       limit 2
    )
    select (select id    from puntajes limit 1),
           (select name  from puntajes limit 1),
           (select cuit  from puntajes limit 1),
           (select score from puntajes limit 1),
           coalesce((select score from puntajes offset 1 limit 1), 0)
      into v_id, v_name, v_cand_cuit, v_score, v_top2;

    -- El margen no es redundante con el piso: mata los empates entre sucursales
    -- del mismo proveedor («Distribuidora Norte 1» y «Distribuidora Norte 2»
    -- puntúan casi igual contra «DISTRIBUIDORA NORTE»), donde elegir es tirar una
    -- moneda. La abstención es el modo de falla correcto.
    if v_id is not null and v_score >= 0.62 and (v_score - v_top2) >= 0.15 then
      return jsonb_build_object(
        'estado', 'propuesto',
        'candidatos', jsonb_build_array(jsonb_build_object(
          'id', v_id, 'name', v_name, 'cuit', v_cand_cuit,
          'score', round(v_score, 3), 'via', 'fuzzy'))
      );
    end if;
  end if;

  return jsonb_build_object('estado', 'no_encontrado', 'candidatos', '[]'::jsonb);
end;
$$;

comment on function public.proponer_proveedor_para_cabecera is
  'Spec 173 · propone el proveedor de una cabecera leída: CUIT normalizado → nombre normalizado → trigramas con umbral 0,62 y margen 0,15. Con 2+ candidatos NUNCA resuelve (el CUIT está repetido en el catálogo real). El que decide es la pantalla.';

-- ── El grant, que es la mitad del trabajo ─────────────────────────────────
--
-- La 0094 acaba de cerrar esta familia entera: nueve RPC `security definer` que
-- recibían un `business_id` del que llama y eran alcanzables por `anon`, o sea por
-- cualquiera con la publishable key. Esta función tiene EXACTAMENTE esa forma
-- —definer, `business_id` por parámetro, sin chequeo de membresía adentro— y
-- filtra el catálogo de proveedores completo con nombres y CUIT. No puede ser la
-- que vuelve a abrir la puerta que la 0094 cerró.
--
-- El `revoke ... from public` no es decorativo: en Postgres el EXECUTE se otorga a
-- PUBLIC por defecto al crear la función, así que sin esa línea el revoke a
-- anon/authenticated es cosmético —lo heredan igual—.
--
-- El chequeo de permiso no va acá adentro sino donde ya vive: en el endpoint, que
-- la llama con `createSupabaseServiceClient()` después de resolver el negocio y el
-- rol. Repetirlo en la base sería escribir la misma regla dos veces y encima
-- dejaría entrar por PostgREST a cualquier encargado, salteando las validaciones
-- del endpoint.
revoke all on function public.proponer_proveedor_para_cabecera(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.proponer_proveedor_para_cabecera(uuid, text, text)
  to service_role;

-- La 0094 dejó escrito el invariante y un bloque que lo verifica, pero ese bloque
-- corre ANTES que esta migración en un `db reset` — o sea que no ve lo que agrego
-- acá. Lo vuelvo a chequear para esta función, que es lo que hace que el olvido se
-- note en el reset y no meses después, en la próxima ronda de QA.
do $verifica$
begin
  if has_function_privilege('anon', 'public.proponer_proveedor_para_cabecera(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.proponer_proveedor_para_cabecera(uuid, text, text)', 'EXECUTE') then
    raise exception
      'proponer_proveedor_para_cabecera quedó alcanzable desde el borde público. Es security definer y recibe business_id por parámetro: revocale el execute a public/anon/authenticated (ver 0094).';
  end if;
end
$verifica$;
