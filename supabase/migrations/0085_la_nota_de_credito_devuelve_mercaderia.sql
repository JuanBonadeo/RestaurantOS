-- 0085 · La nota de crédito devuelve mercadería, y el comprobante se anula sin carrera
--
-- Tres agujeros del módulo de compras que la 0073 y la 161 dejaron abiertos
-- (issues #268 · hallazgos 1, 2 y 5).
--
-- ── 1 · La nota de crédito sumaba stock ───────────────────────────────────
--
-- `registrar_items_comprobante_tx` nunca miró el `document_type`: hacía
-- `stock_quantity = stock_quantity + v_base` para CUALQUIER comprobante. Cargar
-- una NC con renglones —los dos cajones de tomate podrido que se devolvieron—
-- sumaba 40 kg en vez de restarlos, así que el inventario se iba 80 kg contra la
-- realidad: los 40 que nunca entraron más los 40 que debieron salir. Y encima
-- reescribía `ingredient_presentations.cost_cents` con el precio del renglón de
-- la DEVOLUCIÓN, lo que asienta una fila en `ingredient_price_log` y duplica el
-- costo del plato en la ingeniería de menú.
--
-- La regla que faltaba es de una línea: **el signo lo manda el tipo de
-- comprobante**, igual que ya lo manda para el total (CHECK
-- `supplier_invoices_total_signo_coherente`, 0066). Y el precio no se toca: una
-- devolución no es un precio de compra — el proveedor no cobró eso, lo
-- reintegró.
--
-- El `document_type` no viaja como parámetro nuevo: la RPC ya lee el
-- comprobante para validar tenant y que esté vivo. Sacarlo de ahí evita que el
-- caller pueda mentir sobre el tipo, que es justo lo que la 165 quiso impedir
-- pasando el `business_id` en vez de confiar en el cliente.
--
-- ── 2 · Anular y pagar el mismo comprobante a la vez ──────────────────────
--
-- `anularComprobante` leía `supplier_payment_allocations` en una consulta suelta
-- y escribía la anulación tres round-trips después, con la RPC de reversión de
-- stock en el medio. En esa ventana entra entero un `registrar_pago_proveedor_tx`
-- (que sí toma `for update`, pero sobre un comprobante que todavía figura vivo):
-- quedan las dos escrituras, o sea un comprobante ANULADO con un pago VIVO
-- imputado — exactamente el estado que la guarda dice impedir. Como el saldo es
-- derivado (Σ comprobantes vivos − Σ pagos vivos), el proveedor pasa a tener
-- plata «a favor» que nadie le debe.
--
-- La guarda tiene que leer y escribir bajo el mismo lock que toma el pago.
-- `editarComprobante` copió la misma guarda y tiene la misma carrera, así que
-- lleva su propia RPC: arreglar uno solo dejaba vivo al gemelo.
--
-- ── 3 · La misma factura dos veces ────────────────────────────────────────
--
-- No había índice único: el mismo taco de papeles cargado dos veces duplica la
-- deuda y, si tenía renglones, el stock. El índice es PARCIAL a propósito —
-- `interno` es el 36% de las compras del Golf (la compra diaria sin papel) y ahí
-- dos compras iguales al mismo proveedor el mismo día son un hecho legítimo, no
-- un duplicado; y un comprobante anulado tiene que poder recargarse con el
-- mismo número.

-- ── 1 · el renglón respeta el signo del comprobante ───────────────────────

-- Con la NC, `quantity_base` es negativo: son unidades base que SALEN. `units`
-- sigue siendo positivo (dos envases devueltos son dos envases) — lo que cambia
-- de signo es la mercadería, no el conteo de bultos.
alter table public.supplier_invoice_items
  drop constraint if exists supplier_invoice_items_quantity_base_check;
alter table public.supplier_invoice_items
  add constraint supplier_invoice_items_quantity_base_check
  check (quantity_base <> 0);

create or replace function public.registrar_items_comprobante_tx(
  p_business_id uuid,
  p_invoice_id  uuid,
  p_created_by  uuid,
  p_items       jsonb   -- [{ingredient_id, presentation_id, units, unit_cost_cents}]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it        jsonb;
  v_ing       uuid;
  v_pres      uuid;
  v_units     numeric;
  v_costo     bigint;
  v_neto      numeric;
  v_base      numeric;
  v_n         integer := 0;
  v_tipo      text;
  v_devuelve  boolean;
begin
  -- El comprobante tiene que ser de este negocio y estar vivo. El `document_type`
  -- sale de acá y no de un parámetro: el caller no puede mentir sobre el signo.
  select document_type into v_tipo
    from supplier_invoices
   where id = p_invoice_id and business_id = p_business_id and cancelled_at is null;
  if not found then
    raise exception 'COMPROBANTE_NO_DISPONIBLE';
  end if;

  v_devuelve := v_tipo = 'nota_credito';

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_ing   := (v_it ->> 'ingredient_id')::uuid;
    v_pres  := nullif(v_it ->> 'presentation_id', '')::uuid;
    v_units := (v_it ->> 'units')::numeric;
    v_costo := (v_it ->> 'unit_cost_cents')::bigint;

    -- Tenant del insumo: el service client bypassa RLS y el FK sólo chequea
    -- existencia, no negocio.
    perform 1 from ingredients
     where id = v_ing and business_id = p_business_id for update;
    if not found then
      raise exception 'INSUMO_DE_OTRO_NEGOCIO' using detail = v_ing::text;
    end if;

    -- Cuántas unidades base entran. Sin presentación, `units` ya viene en base.
    v_neto := 1;
    if v_pres is not null then
      select net_quantity into v_neto
        from ingredient_presentations
       where id = v_pres and ingredient_id = v_ing;
      if v_neto is null then
        raise exception 'PRESENTACION_INVALIDA' using detail = v_pres::text;
      end if;
    end if;
    v_base := v_units * v_neto;
    if v_devuelve then
      v_base := -v_base;
    end if;

    insert into supplier_invoice_items (
      business_id, invoice_id, ingredient_id, presentation_id,
      units, quantity_base, unit_cost_cents, created_by
    ) values (
      p_business_id, p_invoice_id, v_ing, v_pres,
      v_units, v_base, v_costo, p_created_by
    );

    -- Alta (o baja) de stock. `v_base` ya trae el signo del comprobante.
    update ingredients
       set stock_quantity = stock_quantity + v_base,
           updated_at = now()
     where id = v_ing;

    -- El consumo, con el costo REAL — `ingresarStockCocina` escribía 0 acá.
    --
    -- `cost_cents_snapshot` es la plata del MOVIMIENTO entero (units × precio
    -- del envase), no el costo por unidad base. La 0073 escribía el costo
    -- unitario y quedaba fuera de convención contra todos los otros escritores
    -- —`fn_stock_reversion_item`, `fn_stock_delta_on_item_edit`— que guardan
    -- `costo_por_unidad × cantidad`. No rompía nada porque nadie leía las filas
    -- 'compra', pero es la columna que el CMV suma: dejarla en dos unidades
    -- distintas es una bomba de tiempo.
    --
    -- La devolución NO se anota como 'compra' negativa sino como 'reversion',
    -- que es la misma forma que ya usa `revertir_items_comprobante_tx` para la
    -- mercadería que nunca entró: `computeMermaReport` las lee con signo y las
    -- resta de «Entró». Una 'compra' en negativo caería en el `Math.abs` del
    -- reporte y sumaría al revés.
    insert into ingredient_consumptions (
      business_id, ingredient_id, quantity, cost_cents_snapshot, kind
    ) values (
      p_business_id, v_ing, v_base,
      round(v_costo * v_units),
      case when v_devuelve then 'reversion' else 'compra' end
    );

    -- La compra reescribe el costo del envase. El trigger
    -- `trg_ingredient_price_change` llena el histórico solo.
    --
    -- La NC no: devolver mercadería no es un precio de compra. Antes lo pisaba,
    -- y una devolución cargada a $4.500 el envase le duplicaba el costo al plato
    -- para siempre.
    if v_pres is not null and v_costo > 0 and not v_devuelve then
      update ingredient_presentations
         set cost_cents = v_costo
       where id = v_pres and cost_cents <> v_costo;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.registrar_items_comprobante_tx is
  'Spec 165 · carga los renglones de un comprobante: línea + movimiento de stock + consumo con costo real + precio del insumo, en UNA transacción. El signo lo manda el document_type: la nota de crédito devuelve mercadería y NO toca el precio (issue #268).';

-- `revertir_items_comprobante_tx` no cambia de forma: hace
-- `stock_quantity - quantity_base` y anota `-quantity_base`. Con la NC el
-- `quantity_base` es negativo, así que anular la NC devuelve la mercadería al
-- inventario y la reversión queda en positivo — simétrico en las dos
-- direcciones sin una línea nueva.

-- ── 2 · anular y editar bajo el mismo lock que el pago ────────────────────

create or replace function public.anular_comprobante_tx(
  p_business_id   uuid,
  p_invoice_id    uuid,
  p_cancelled_by  uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled timestamptz;
  v_vivos     integer;
begin
  -- El MISMO `for update` que toma `registrar_pago_proveedor_tx` (0069). Es lo
  -- que serializa las dos operaciones: si el pago llega primero, acá vemos su
  -- imputación ya escrita; si llegamos primero, el pago encuentra el
  -- comprobante anulado y levanta COMPROBANTE_NO_DISPONIBLE. Una de las dos
  -- pierde, que es la regla que el código decía sostener y no sostenía.
  select cancelled_at into v_cancelled
    from supplier_invoices
   where id = p_invoice_id and business_id = p_business_id
   for update;

  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO';
  end if;
  if v_cancelled is not null then
    raise exception 'COMPROBANTE_YA_ANULADO';
  end if;

  select count(*) into v_vivos
    from supplier_payment_allocations a
    join supplier_payments p on p.id = a.payment_id
   where a.invoice_id = p_invoice_id
     and a.business_id = p_business_id
     and p.cancelled_at is null;

  if v_vivos > 0 then
    raise exception 'COMPROBANTE_CON_PAGO_VIVO';
  end if;

  -- La reversión de stock va adentro de la misma transacción: si falla, no
  -- queda ni la anulación ni el stock a medias.
  perform revertir_items_comprobante_tx(p_business_id, p_invoice_id);

  update supplier_invoices
     set cancelled_at = now(),
         cancelled_by = p_cancelled_by,
         cancelled_reason = p_reason
   where id = p_invoice_id and business_id = p_business_id;
end;
$$;

comment on function public.anular_comprobante_tx is
  'Issue #268 · anula un comprobante con la guarda de pagos vivos y la reversión de stock DENTRO de la misma transacción y bajo el mismo for-update que el pago. Antes eran tres round-trips y un pago entraba en el medio.';

create or replace function public.editar_comprobante_tx(
  p_business_id uuid,
  p_invoice_id  uuid,
  p_campos      jsonb  -- sólo las claves que el usuario mandó
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled  timestamptz;
  v_vivos      integer;
  v_toca_plata boolean;
  v_tipo       text;
  v_total      bigint;
begin
  -- Mismo lock que `anular_comprobante_tx` por la misma razón: la guarda de
  -- pagos vivos estaba copiada acá con la carrera copiada adentro.
  select cancelled_at, document_type, total_cents
    into v_cancelled, v_tipo, v_total
    from supplier_invoices
   where id = p_invoice_id and business_id = p_business_id
   for update;

  if not found then
    raise exception 'COMPROBANTE_NO_ENCONTRADO';
  end if;
  if v_cancelled is not null then
    raise exception 'COMPROBANTE_ANULADO';
  end if;

  -- Spec 163 · D1: la plata (total, fecha, tipo) sólo se toca sin pagos vivos;
  -- la clasificación (concepto, vencimiento, número, notas) siempre.
  v_toca_plata := p_campos ?| array['total_cents', 'invoice_date', 'document_type'];

  if v_toca_plata then
    select count(*) into v_vivos
      from supplier_payment_allocations a
      join supplier_payments p on p.id = a.payment_id
     where a.invoice_id = p_invoice_id
       and a.business_id = p_business_id
       and p.cancelled_at is null;

    if v_vivos > 0 then
      raise exception 'COMPROBANTE_CON_PAGO_VIVO';
    end if;

    if p_campos ? 'document_type' then v_tipo := p_campos ->> 'document_type'; end if;
    if p_campos ? 'total_cents' then v_total := (p_campos ->> 'total_cents')::bigint; end if;
    if (v_tipo = 'nota_credito' and v_total > 0)
       or (v_tipo <> 'nota_credito' and v_total < 0) then
      raise exception 'SIGNO_INVALIDO';
    end if;
  end if;

  -- `? 'clave'` y no `coalesce`: el usuario puede querer BORRAR el concepto o el
  -- número (mandarlos en null), y un coalesce leería ese null como «no lo tocó».
  update supplier_invoices set
    expense_concept_id = case when p_campos ? 'expense_concept_id'
                              then nullif(p_campos ->> 'expense_concept_id', '')::uuid
                              else expense_concept_id end,
    invoice_number     = case when p_campos ? 'invoice_number'
                              then nullif(p_campos ->> 'invoice_number', '')
                              else invoice_number end,
    notes              = case when p_campos ? 'notes'
                              then nullif(p_campos ->> 'notes', '')
                              else notes end,
    due_date           = case when p_campos ? 'due_date'
                              then (nullif(p_campos ->> 'due_date', ''))::date
                              else due_date end,
    total_cents        = case when p_campos ? 'total_cents'
                              then (p_campos ->> 'total_cents')::integer
                              else total_cents end,
    invoice_date       = case when p_campos ? 'invoice_date'
                              then (p_campos ->> 'invoice_date')::date
                              else invoice_date end,
    document_type      = case when p_campos ? 'document_type'
                              then p_campos ->> 'document_type'
                              else document_type end
  where id = p_invoice_id and business_id = p_business_id;
end;
$$;

comment on function public.editar_comprobante_tx is
  'Issue #268 · edita un comprobante con la guarda partida (plata vs. clasificación) DENTRO de la misma transacción y bajo for-update. Gemelo de anular_comprobante_tx: tenía la misma guarda copiada y la misma carrera.';

grant execute on function public.anular_comprobante_tx(uuid, uuid, uuid, text)
  to authenticated, service_role;
grant execute on function public.editar_comprobante_tx(uuid, uuid, jsonb)
  to authenticated, service_role;

-- ── 3 · la misma factura no entra dos veces ───────────────────────────────
--
-- Parcial en tres sentidos, y cada uno es una decisión:
--   · `invoice_number is not null` — el 36% de las compras del Golf son
--     `interno` sin número, y ahí no hay nada que comparar.
--   · `document_type <> 'interno'` — dos compras diarias sin papel al mismo
--     proveedor el mismo día son un hecho legítimo.
--   · `cancelled_at is null` — un comprobante anulado (número mal tipeado,
--     importe mal) tiene que poder recargarse con el mismo número.
--
-- Incluye `document_type` en la clave porque una NC y su factura original
-- comparten número en muchos talonarios.
create unique index if not exists supplier_invoices_numero_unico_idx
  on public.supplier_invoices (business_id, supplier_id, document_type, invoice_number)
  where invoice_number is not null
    and document_type <> 'interno'
    and cancelled_at is null;

comment on index public.supplier_invoices_numero_unico_idx is
  'Issue #268 · la misma factura del mismo proveedor no entra dos veces. Parcial: no aplica a los internos sin número ni a los comprobantes anulados.';
