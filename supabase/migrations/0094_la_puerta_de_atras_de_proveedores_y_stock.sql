-- ────────────────────────────────────────────────────────────────────────
-- 0094 — nueve RPC de plata que se podían llamar sin sesión
--
-- Las encontró un revisor de la ronda de QA sobre la 0085/0086 y al medirlas
-- resultó peor de lo denunciado: no es que las alcance «cualquier usuario
-- logueado», es que las alcanza **`anon`**, o sea cualquiera con la publishable
-- key — que viaja en el bundle del browser y es pública por diseño.
--
-- Las nueve son `security definer` (corren como `postgres`, salteando toda la
-- RLS), reciben el `business_id` **del que llama** y no lo validan contra nadie.
-- Medido en la ACL del cloud, las nueve tenían `=X/postgres` (PUBLIC) más los
-- grants explícitos a `anon` y `authenticated`:
--
--     anular_comprobante_tx            anula un comprobante de CUALQUIER negocio,
--                                      con la reversión de stock adentro
--     editar_comprobante_tx            le cambia el importe
--     registrar_items_comprobante_tx   le mete renglones y mueve el inventario
--     revertir_items_comprobante_tx    le saca la mercadería
--     registrar_pago_proveedor_tx      le inventa un pago y le toca la caja
--     adjust_ingredient_stock          le mueve el stock de cualquier insumo
--     proponer_insumos_para_lineas     le lee el catálogo de insumos entero
--     seed_caja_administrativa         le crea cajas
--     seed_expense_concepts            le crea conceptos de gasto
--
-- Es la misma puerta que la 0082 cerró para `invoices`, un pasillo más allá: ahí
-- el agujero era una policy RLS floja, acá es que la RLS ni siquiera participa.
--
-- ── Por qué el fix es un `revoke` y no un chequeo adentro de cada función ────
--
-- Porque **ningún camino de la app las llama con la sesión del usuario**. Las
-- nueve se invocan desde el server con `createSupabaseServiceClient()`:
--
--     anular_comprobante_tx          src/lib/proveedores/cuenta-corriente-actions.ts:166
--     editar_comprobante_tx          src/lib/proveedores/cuenta-corriente-actions.ts:242
--     registrar_pago_proveedor_tx    src/lib/proveedores/cuenta-corriente-actions.ts:418
--     registrar_items_comprobante_tx src/lib/proveedores/actions.ts:237
--     adjust_ingredient_stock        src/lib/ingredients/actions.ts:511 y :568
--     proponer_insumos_para_lineas   src/app/api/proveedores/leer-comprobante/route.ts:133
--     revertir_items_comprobante_tx  sin caller en TS (la llama anular_comprobante_tx)
--     seed_caja_administrativa       sin caller en TS (la llama ensure_caja_administrativa)
--     seed_expense_concepts          sin caller en TS (la llama ensure_default_expense_concepts)
--
-- El permiso de quién puede hacer esto ya vive donde corresponde: en las Server
-- Actions, con `can.ts`. Meterle además un `is_business_manager` adentro sería
-- escribir la misma regla dos veces —el antipatrón que esta misma ronda encontró
-- seis veces— y encima no cerraría la puerta: dejaría entrar por PostgREST a
-- cualquier encargado, salteando las validaciones de la action.
--
-- Los tres llamadores internos (`anular_comprobante_tx`,
-- `ensure_caja_administrativa`, `ensure_default_expense_concepts`) son a su vez
-- `security definer` de `postgres`, así que adentro de ellos el privilegio lo
-- pone el owner y siguen andando.
--
-- ── Esto no inventa una convención: la restaura ─────────────────────────────
--
-- El resto de las RPC de plata YA está cerrado — `registrar_pago_tx`,
-- `cerrar_caja_tx`, `anular_pago_tx`, `corregir_pago_tx`, `corregir_movimiento_tx`
-- y `trasladar_mesa_tx` dan `false` para anon y para authenticated. La familia de
-- proveedores y stock (0069, 0073, 0085, 0086, 0092) es la que nunca recibió el
-- revoke, y la 0085/0086 —de esta misma ronda— la amplió con tres funciones más.
--
-- `revoke ... from public` además de anon/authenticated: sin eso el revoke es
-- cosmético, porque en Postgres `EXECUTE` sobre funciones se otorga a PUBLIC por
-- defecto y los roles lo heredan igual.
--
-- Hallazgo: revisor de #268/#270 · problema 11
-- ────────────────────────────────────────────────────────────────────────

do $cierre$
declare
  v_fn text;
  v_fns text[] := array[
    'public.anular_comprobante_tx(uuid, uuid, uuid, text)',
    'public.editar_comprobante_tx(uuid, uuid, jsonb)',
    'public.registrar_items_comprobante_tx(uuid, uuid, uuid, jsonb)',
    'public.revertir_items_comprobante_tx(uuid, uuid)',
    'public.registrar_pago_proveedor_tx(uuid, uuid, bigint, text, date, text, uuid, uuid, text, jsonb)',
    'public.adjust_ingredient_stock(uuid, uuid, numeric, text, bigint, text, uuid)',
    'public.proponer_insumos_para_lineas(uuid, uuid, jsonb)',
    'public.seed_caja_administrativa(uuid)',
    'public.seed_expense_concepts(uuid)',
    -- La décima la encontró el propio bloque de verificación de abajo, y sólo
    -- en el stack LOCAL: en el cloud ya estaba cerrada. O sea que los grants de
    -- las dos bases venían divergidos y nadie lo sabía — que es justo lo que un
    -- invariante chequeado en cada `db reset` viene a evitar.
    -- Único caller: src/lib/orders/persist-order.ts:664, con service client.
    'public.increment_promo_use(uuid, uuid)'
  ];
begin
  foreach v_fn in array v_fns loop
    -- `to_regprocedure` en vez de asumir que existe: el stack local y el cloud
    -- pueden ir desfasados, y una migración de seguridad no tiene que romper
    -- por una función que todavía no llegó.
    if to_regprocedure(v_fn) is null then
      raise notice 'no existe todavía, la salteo: %', v_fn;
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end
$cierre$;

-- ── La migración se verifica a sí misma, y cubre a las que vengan ──────────
--
-- El invariante no es «estas nueve están cerradas» sino el general: **ninguna
-- función `security definer` que reciba un `business_id` por parámetro es
-- ejecutable desde el borde público sin chequear quién llama.** Hoy se cumple
-- para las 17 que matchean. Si alguien agrega una RPC nueva con la misma forma y
-- se olvida del revoke, esta migración vuelve a correr en el `db reset` y falla
-- ahí, que es meses antes de que la encuentre un revisor.
--
-- La salida: o le agregás el revoke, o le ponés adentro el chequeo de membresía
-- (`is_business_manager` / `is_business_member` / `is_platform_admin` /
-- `auth.uid`), que es lo que la excluye del match.
do $verifica$
declare
  v_abiertas text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                    ', ' order by p.proname)
    into v_abiertas
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and pg_get_function_identity_arguments(p.oid) like '%business%'
    and p.prosrc not like '%is_business_manager%'
    and p.prosrc not like '%is_business_member%'
    and p.prosrc not like '%is_platform_admin%'
    and p.prosrc not like '%auth.uid%'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if v_abiertas is not null then
    raise exception
      'RPC security definer con business_id alcanzables desde el borde público → %. Revocales el execute a public/anon/authenticated, o metele el chequeo de membresía adentro.',
      v_abiertas;
  end if;
end
$verifica$;
