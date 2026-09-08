-- ────────────────────────────────────────────────────────────────────────
-- 0082 — un mozo no anula una factura autorizada ni inventa un CAE
--
-- Las tres policies de `invoices` preguntaban una sola cosa: `is_business_member`
-- (+ platform admin). Ni rol, ni estado, ni baja. Como los writes de la app van
-- todos por `createSupabaseServiceClient()` —que bypassea RLS—, esa RLS no
-- gobernaba ningún camino de la app: era exclusivamente la puerta del POST
-- directo a PostgREST con la publishable key y el JWT de cualquier miembro.
--
-- Medido contra esta misma base con el JWT real de un mozo de `demo`
-- (`begin; … rollback;`, nunca service_role):
--
--     UPDATE status='cancelled'          PASA  ← anuló una A de $500.000
--     UPDATE cae, total_cents            PASA  ← reescribió el CAE y el importe
--     INSERT status='authorized' + CAE   PASA  ← comprobante fantasma
--     SELECT toda la facturación         PASA
--
-- Qué se corrompe, con precisión: **no el libro IVA de ARCA**. El CAE vive
-- allá, `invoices` es el espejo local. Flipear la fila a `cancelled` no anula
-- nada ante ARCA (la factura sigue en Mis Comprobantes), y un CAE inventado no
-- crea un comprobante que ARCA nunca emitió. Lo que se corrompe es el espejo, y
-- el espejo es la verdad que usa la app para la caja, el reporte fiscal, la
-- reimpresión, la guarda de anulación de mesa (`bloqueoPorPlata`) y la de
-- re-emisión. Con eso alcanza para tapar un faltante de caja: anulás la fila y
-- el comprobante deja de contar en el reporte. Y encima el INSERT ocupa un
-- número de comprobante en el unique `(business, tipo, pv, numero)`, así que la
-- emisión real de ese número después choca.
--
-- El rastro no existe: `cancelled_by` lo escribe sólo la Server Action (queda
-- NULL por esta vía), `invoices` no tiene un solo trigger de auditoría y no hay
-- `caja_audit_log` para comprobantes. La fila anulada se ve igual que una
-- anulada en regla, pero sin nota de crédito asociada.
--
-- El agujero no era del mozo: `is_business_member` no filtra rol NI
-- `disabled_at`, así que cubría a cualquier fila de `business_users` del
-- negocio, incluido un empleado ya dado de baja.
--
-- En AR una factura autorizada se deshace de UNA sola manera: emitiendo la nota
-- de crédito. Eso es `anularFactura`, con `canAnularFactura` (encargado/admin)
-- y por service role. Nada más tiene por qué escribir esta tabla.
--
-- POR QUÉ ES DE RIESGO CERO PARA EL CAMINO FELIZ: los 30 accesos a `invoices`
-- en `src/` resuelven su cliente con `createSupabaseServiceClient()` salvo UNO,
-- `getFiscalSummary` (src/lib/admin/reports-extra-query.ts:26), que lee con el
-- cliente del usuario — y vive en `/admin/reportes`, que `sections.ts` da
-- `full` sólo al admin. Ningún componente cliente toca la tabla. Por eso el
-- SELECT puede bajar a manager sin romper una sola pantalla.
--
-- Hallazgo: issue #274 · 4
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 · escribir: nadie, desde el navegador ────────────────────────────────
--
-- Se DROPEAN en vez de endurecerse a manager. La ausencia de policy es más
-- restrictiva que cualquier cosa que pudiéramos escribir, y acá es lo correcto:
-- ni el encargado ni el admin escriben esta tabla por RLS — anulan y emiten por
-- las Server Actions, que corren con service role y dejan `cancelled_by`, el
-- motivo y la NC. Un `manager` en el WITH CHECK sería una puerta que nadie usa
-- y que igual permite inventar un CAE.
--
-- Es el mismo criterio que la 0068 aplicó a `supplier_payments` (sin DELETE) y
-- `supplier_payment_allocations` (sin UPDATE).
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
-- DELETE ya no tenía policy: se mantiene denegado.

-- ── 2 · leer: admin y encargado, no dados de baja ──────────────────────────
--
-- La facturación es plata y datos fiscales de clientes (CUIT, razón social) del
-- negocio entero. `is_business_manager` (0019) = admin + encargado + platform
-- admin, con `disabled_at is null`, que es exactamente lo que `sections.ts` le
-- da a `facturacion`.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.is_business_manager(business_id));

-- ── 3 · y el GRANT, para que no alcance con agregar una policy ─────────────
--
-- `anon` tenía `GRANT ALL` sobre la tabla. Hoy es inocuo (no hay policy para
-- `anon`, así que sin sesión no se llega), pero deja la escritura fiscal a un
-- `create policy` de distancia. Un comprobante no se escribe nunca desde el
-- borde público: el privilegio se va.
revoke all on table public.invoices from anon;
revoke insert, update, delete, truncate on table public.invoices from authenticated;
-- El SELECT de `authenticated` queda: lo necesita `getFiscalSummary`, que ahora
-- filtra por manager en la policy.

-- ── 4 · la migración se verifica a sí misma ────────────────────────────────
--
-- Si alguien recrea una policy de escritura, o deja el SELECT en
-- `is_business_member`, esto falla entero en vez de mentir que cerró la puerta.
do $$
declare
  v_escritura text;
  v_flojas    text;
begin
  select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname)
    into v_escritura
  from pg_policies
  where schemaname = 'public' and tablename = 'invoices'
    and cmd <> 'SELECT';

  if v_escritura is not null then
    raise exception 'INVOICES: quedaron policies de escritura → %', v_escritura;
  end if;

  select string_agg(policyname, ', ' order by policyname)
    into v_flojas
  from pg_policies
  where schemaname = 'public' and tablename = 'invoices'
    and (
      coalesce(qual::text, '') like '%is_business_member%'
      or coalesce(with_check::text, '') like '%is_business_member%'
    );

  if v_flojas is not null then
    raise exception 'INVOICES: quedaron policies con is_business_member → %', v_flojas;
  end if;

  if has_table_privilege('authenticated', 'public.invoices', 'INSERT')
     or has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
     or has_table_privilege('anon', 'public.invoices', 'SELECT') then
    raise exception 'INVOICES: los GRANT de escritura siguen abiertos';
  end if;
end $$;
