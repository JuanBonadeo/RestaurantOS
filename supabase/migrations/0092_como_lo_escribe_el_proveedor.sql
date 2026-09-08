-- 0092 · Cómo lo escribe el proveedor
--
-- La base del lector de facturas (spec 172). Cuatro piezas:
--
--   1 · un normalizador de nombres, UNO SOLO para todo el repo
--   2 · el índice único que impide crear insumos duplicados
--   3 · `supplier_ingredient_aliases`: qué insumo quiso decir ESTE proveedor
--       cuando escribió ESTE texto
--   4 · `source_text` / `match_source` en el renglón: lo que decía el papel y de
--       dónde salió el match
--
-- ── 0 · pg_trgm ───────────────────────────────────────────────────────────
--
-- Está instalado en el cloud (v1.6, en el schema `extensions`) y NO en el stack
-- local, así que la migración no puede darlo por hecho: sin esto el matcher
-- falla recién en runtime, con «function word_similarity does not exist».
--
-- `with schema extensions` para que quede donde ya vive en el cloud y el
-- `search_path` de la función de abajo funcione igual en los dos lados.
create extension if not exists pg_trgm with schema extensions;

-- ── 1 · el normalizador, y por qué es uno solo ────────────────────────────
--
-- Es la deuda que la 164·D3 dejó escrita con todas las letras: «la normalización
-- que hace falta para no duplicar es LA MISMA que la #245 necesita para mapear
-- línea de comprobante → insumo. Hacerla dos veces es hacerla mal una.»
--
-- `translate` y no `unaccent`: unaccent NO está instalado en este proyecto
-- (verificado con `pg_extension`) y además no es IMMUTABLE, así que no puede
-- vivir en un índice sin un wrapper. `translate` es inmutable y no necesita
-- extensión.
create or replace function public.normalizar_texto_insumo(p text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select btrim(regexp_replace(
    lower(translate(p,
      'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ',
      'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

comment on function public.normalizar_texto_insumo is
  'Spec 172 · la clave normalizada de un nombre de insumo o de un renglón impreso. Una sola definición para el índice único, el alias y el matcher (deuda 164·D3).';

-- ── 2 · el índice que impide crear los duplicados ─────────────────────────
--
-- MEDIDO antes de escribir esto: normalizando los 122 insumos activos de
-- golf-jcr y los 122 de demo hay CERO colisiones. Los ~35 duplicados de la
-- 164·D3 no existen todavía: son los que CREARÍA `importIngredients` corriendo
-- contra el índice btree crudo de `(business_id, name)`, que distingue
-- «Muzarella» de «MUZZARELLA».
--
-- O sea que la deuda no era «limpiar 35 duplicados antes de poder matchear»,
-- era «poner el índice que impide crearlos» — y eso se puede hacer hoy, sin
-- limpiar nada. Después de esto, un import que los generaría falla ruidosamente
-- en vez de dejar 35 insumos gemelos con recetas colgadas de cualquiera.
--
-- Sólo sobre los activos: un insumo dado de baja puede compartir nombre con el
-- que lo reemplazó, y forzar la unicidad ahí rompería bajas ya hechas.
create unique index if not exists ingredients_business_name_norm_uidx
  on public.ingredients (business_id, public.normalizar_texto_insumo(name))
  where is_active;

-- ── 3 · la memoria del proveedor ──────────────────────────────────────────
--
-- Tabla nueva y no una columna en `supplier_ingredients`: esa responde «qué le
-- compro a este proveedor» y tiene PK compuesta `(supplier_id, ingredient_id)`.
-- El alias responde «cómo lo escribe», que es N textos → 1 insumo. Meterle una
-- columna de texto a esa PK rompería la semántica de las dos.
--
-- Lo que esta tabla NO guarda: el precio. El precio es justamente lo que estamos
-- aprendiendo DEL comprobante, y uno memorizado competiría con el impreso. La
-- memoria responde qué insumo, nunca cuánto.
create table if not exists public.supplier_ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id)  on delete cascade,
  -- La clave: lo impreso, normalizado. Siempre por normalizar_texto_insumo().
  alias_norm   text not null,
  -- Lo que decía el papel, sin tocar. Es lo que se le muestra a la persona.
  alias_raw    text not null,
  ingredient_id   uuid not null references public.ingredients(id) on delete cascade,
  presentation_id uuid references public.ingredient_presentations(id) on delete set null,
  -- De qué capa salió la propuesta que se confirmó. Sin esto no hay forma de
  -- auditar un alias malo ni de medir si los umbrales sirven: un alias nacido de
  -- una sugerencia del modelo sería indistinguible de uno confirmado 20 veces.
  origen text not null check (origen in ('exacto', 'fuzzy', 'llm', 'manual', 'manual_corregido')),
  -- Cuántas veces se confirmó SIN corregir. Una corrección lo resetea a 1.
  confirmations integer not null default 1 check (confirmations > 0),
  last_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint supplier_ingredient_aliases_alias_norm_check
    check (length(alias_norm) between 2 and 120)
);

-- LA restricción del modelo: un texto, un significado, POR PROVEEDOR. Si el
-- mismo texto se mapeara a dos insumos, «la memoria dice X» pasaría a ser una
-- afirmación probabilística — que es exactamente lo que la 164·D2 prohíbe.
create unique index if not exists supplier_ingredient_aliases_key
  on public.supplier_ingredient_aliases (business_id, supplier_id, alias_norm);

create index if not exists supplier_ingredient_aliases_ingredient_idx
  on public.supplier_ingredient_aliases (business_id, ingredient_id);

comment on table public.supplier_ingredient_aliases is
  'Spec 172 · qué insumo quiso decir ESTE proveedor cuando escribió ESTE texto. Se puebla sólo al confirmar un renglón. Guarda el qué, nunca el cuánto.';

alter table public.supplier_ingredient_aliases enable row level security;

-- Manager, como todo el módulo desde la 0068.
drop policy if exists supplier_ingredient_aliases_select on public.supplier_ingredient_aliases;
create policy supplier_ingredient_aliases_select on public.supplier_ingredient_aliases
  for select to authenticated using (public.is_business_manager(business_id));

drop policy if exists supplier_ingredient_aliases_insert on public.supplier_ingredient_aliases;
create policy supplier_ingredient_aliases_insert on public.supplier_ingredient_aliases
  for insert to authenticated with check (public.is_business_manager(business_id));

-- A diferencia de `supplier_invoice_items`, ESTA tabla sí lleva UPDATE: un alias
-- es una opinión revisable, no un hecho contable. Corregirlo no reescribe
-- ninguna plata ya escrita.
drop policy if exists supplier_ingredient_aliases_update on public.supplier_ingredient_aliases;
create policy supplier_ingredient_aliases_update on public.supplier_ingredient_aliases
  for update to authenticated
  using (public.is_business_manager(business_id))
  with check (public.is_business_manager(business_id));

drop policy if exists supplier_ingredient_aliases_delete on public.supplier_ingredient_aliases;
create policy supplier_ingredient_aliases_delete on public.supplier_ingredient_aliases
  for delete to authenticated using (public.is_business_manager(business_id));

-- ── 4 · lo que decía el papel ─────────────────────────────────────────────
--
-- El equivalente de `mxitc.referencia`, que MaxiRest tiene y nosotros perdíamos.
-- Todo el análisis que sostiene la 165 —«mxstk.compras matchea mxitc en 1.481 de
-- 1.481 filas»— se pudo escribir SÓLO porque esa columna existía.
--
-- `match_source` es lo único que permite responder «la máquina propuso X y la
-- persona lo corrigió a Y» después de que se cierra el diálogo. Un umbral que no
-- se puede medir no se puede defender: 0,62 quedaría siendo 0,62 porque sí.
--
-- Las dos se escriben en el insert y NUNCA se actualizan, así que la regla de la
-- 165 —los renglones no se editan, se anula y se rehace— queda intacta. Cero
-- backfill: la tabla tiene 0 filas en los tres negocios.
alter table public.supplier_invoice_items
  add column if not exists source_text  text,
  add column if not exists match_source text
    check (match_source in ('memoria', 'exacto', 'fuzzy', 'llm', 'manual', 'manual_corregido'));

comment on column public.supplier_invoice_items.source_text is
  'Spec 172 · el renglón tal cual venía impreso. El equivalente de mxitc.referencia.';
comment on column public.supplier_invoice_items.match_source is
  'Spec 172 · de qué capa salió el match que la persona confirmó. Es lo que permite medir si los umbrales sirven.';

-- ── 5 · la propuesta de insumo para una tanda de líneas ───────────────────
--
-- Corre en la base y no en TypeScript porque los umbrales se midieron con
-- `pg_trgm` (17 aciertos, 0 errores y 8 abstenciones sobre 25 líneas reales
-- contra los 122 insumos de golf-jcr); reimplementar trigramas en TS haría que
-- esos números dejaran de aplicar.
--
-- `search_path` incluye `extensions`: pg_trgm vive ahí y no en `public`, así que
-- copiar el `set search_path = public` del resto de los RPC del módulo haría
-- fallar `word_similarity` en runtime.
--
-- LA FÓRMULA. `word_similarity` sola encuentra el nombre adentro de la línea
-- impresa («Papa» dentro de «Papa Lavada») pero prefiere el genérico más corto:
-- medido, «SORRENTINOS DE CALABAZA» da 1,00 con `Calabaza`, «Crema de leche» da
-- 1,00 con `Leche`, «Ñoquis de papa» da 1,00 con `Papa`. Elegiría
-- sistemáticamente el insumo equivocado Y más barato, que es el peor error
-- posible para algo que escribe plata. El término `similarity` penaliza al
-- genérico corto y desarma esa trampa.
create or replace function public.proponer_insumos_para_lineas(
  p_business_id uuid,
  p_supplier_id uuid,
  p_lineas      jsonb   -- ["ENTRECOT", "FILET PECH. SURAVIC", ...]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_out   jsonb := '[]'::jsonb;
  v_texto text;
  v_norm  text;
  v_ing   uuid;
  v_src   text;
  v_score numeric;
  v_top2  numeric;
begin
  for v_texto in select jsonb_array_elements_text(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_norm  := normalizar_texto_insumo(v_texto);
    v_ing   := null;
    v_src   := null;
    v_score := null;

    -- L1 · la memoria de ESTE proveedor. Es una decisión que ya tomó un humano
    -- sobre este texto exacto: gana sobre todo lo demás.
    if p_supplier_id is not null then
      select a.ingredient_id into v_ing
        from supplier_ingredient_aliases a
        join ingredients i on i.id = a.ingredient_id and i.is_active
       where a.business_id = p_business_id
         and a.supplier_id = p_supplier_id
         and a.alias_norm  = v_norm
       limit 1;
      if v_ing is not null then v_src := 'memoria'; v_score := 1; end if;
    end if;

    -- L2 · el nombre exacto, normalizado. No es una adivinanza: la cadena, sin
    -- mayúsculas ni acentos, ES el nombre del insumo.
    if v_ing is null then
      select i.id into v_ing
        from ingredients i
       where i.business_id = p_business_id
         and i.is_active
         and normalizar_texto_insumo(i.name) = v_norm
       limit 1;
      if v_ing is not null then v_src := 'exacto'; v_score := 1; end if;
    end if;

    -- L3 · el fuzzy, con umbral Y margen. El margen no es redundante: mata los
    -- empates a tres bandas («Pickers Pulpa de Pal» da 0,000 de margen) y es lo
    -- que salva «SORRENTINOS DE CALABAZA» de caer en «Calabaza».
    if v_ing is null and length(v_norm) >= 3 then
      with puntajes as (
        select i.id,
               0.6 * word_similarity(normalizar_texto_insumo(i.name), v_norm)
             + 0.4 * similarity(normalizar_texto_insumo(i.name), v_norm) as score
          from ingredients i
         where i.business_id = p_business_id and i.is_active
         order by score desc
         limit 2
      )
      select (select id from puntajes limit 1),
             (select score from puntajes limit 1),
             coalesce((select score from puntajes offset 1 limit 1), 0)
        into v_ing, v_score, v_top2;

      -- 0,62 y no 0,45: medido, hay un hueco de 0,30 entre el peor acierto
      -- (QUESO MUZZARELLA → Muzarella, 0,650) y el peor falso positivo
      -- (PAN RALLADO → Panko, 0,355). Bajarlo recupera CHAMPIGNON pero deja
      -- 0,145 de aire contra Panko — y Panko escribiría el precio del pan
      -- rallado sobre el panko. La abstención es el modo de falla correcto.
      if v_score is null or v_score < 0.62 or (v_score - v_top2) < 0.15 then
        v_ing := null; v_src := null; v_score := null;
      else
        v_src := 'fuzzy';
      end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'texto',         v_texto,
      'ingredient_id', v_ing,
      'match_source',  v_src,
      'score',         v_score
    );
  end loop;

  return v_out;
end;
$$;

comment on function public.proponer_insumos_para_lineas is
  'Spec 172 · propone un insumo por línea impresa: memoria del proveedor → nombre exacto normalizado → trigramas con umbral 0,62 y margen 0,15. NUNCA auto-asigna: el que decide es el checkbox de la pantalla.';

grant execute on function public.normalizar_texto_insumo(text) to authenticated, service_role;
grant execute on function public.proponer_insumos_para_lineas(uuid, uuid, jsonb) to authenticated, service_role;
