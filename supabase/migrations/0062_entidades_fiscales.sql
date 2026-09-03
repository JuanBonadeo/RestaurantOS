-- 0062 · Entidades fiscales (spec 150) — reemplaza el enfoque de la 0061
--
-- La 0061 le colgó `cuit` / `razon_social` / `condicion_iva` a `customers`. Al
-- mirar los datos reales del backup de MaxiRest, ese modelo no cierra:
--
-- 1. **Son poblaciones casi disjuntas.** De los 410 clientes con CUIT de Golf,
--    sólo **7** coinciden con los 298 `customers` ya importados. El 98 % de las
--    entidades que facturan no comen en el salón: son empresas, el sanatorio, el
--    parque.
-- 2. **`customers.phone` es la identidad del modelo, y ellos no tienen.**
--    `phone` es NOT NULL + UNIQUE (business_id, phone), y `upsertCustomerByPhone`
--    lo dice con todas las letras: «sin teléfono no hay cliente: el nombre solo no
--    identifica a nadie». De los 410 con CUIT, **sólo 20 tienen teléfono**. Meterlos
--    en `customers` obligaba a inventarle un teléfono placeholder a 390 filas —
--    romper a mano la invariante que el código defiende a propósito.
-- 3. **Ensuciaba cuatro pantallas.** El buscador de clientes se usa al abrir mesa,
--    en el walk-in, al cargar un pedido y al reservar. Sumarle 410 razones sociales
--    empeora los cuatro flujos para servir a uno.
--
-- Un comensal y un receptor de factura son cosas distintas, y la clave natural lo
-- confirma: al comensal lo identifica el teléfono, al receptor el CUIT. Cuando son
-- la misma persona —7 casos— se enlazan con `customer_id`.
--
-- La 0061 se revierte entera: se aplicó hoy, nadie escribió en esas columnas
-- (verificado: 0 filas) y ningún código las lee.

-- ── Revertir 0061 ───────────────────────────────────────────────────────────
drop index if exists public.invoices_customer_idx;
alter table public.invoices drop column if exists customer_id;

drop index if exists public.customers_business_cuit_idx;
alter table public.customers drop constraint if exists customers_cuit_normalizado;
alter table public.customers drop constraint if exists customers_condicion_iva_valida;
alter table public.customers
  drop column if exists cuit,
  drop column if exists razon_social,
  drop column if exists condicion_iva;

-- ── La entidad fiscal ───────────────────────────────────────────────────────
create table if not exists public.fiscal_entities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,

  -- CUIT NORMALIZADO: 11 dígitos, sin guiones. MaxiRest lo trae "30-50023730-5"
  -- en un char(70) y el front normaliza con replace(/\D/g,"") antes de emitir;
  -- sin este check los dos formatos convivirían y no matchearían entre sí.
  cuit text not null check (cuit ~ '^[0-9]{11}$'),
  razon_social text not null check (length(trim(razon_social)) > 0),

  -- Códigos ARCA RG 5616, los mismos de `invoices.condicion_iva_receptor`:
  -- 1 Resp. Inscripto · 4 Exento · 5 Consumidor Final · 6 Monotributo.
  -- NO son los de MaxiRest, que usa numeración propia (allá el "1" es
  -- justamente el que no tiene CUIT): el import mapea, no copia.
  condicion_iva smallint not null check (condicion_iva in (1, 4, 5, 6)),

  -- Domicilio: `mxcli` lo trae (402 de los 410 tienen calle) y ARCA puede
  -- pedirlo para algunos comprobantes. Opcional hasta que se necesite.
  domicilio text,
  localidad text,
  provincia text,
  cod_postal text,

  -- Contacto propio: acá SÍ es opcional, al revés que en `customers`. De los 410
  -- con CUIT, 20 tienen teléfono y 3 e-mail — pedirlo dejaría afuera al 95 %.
  email text,
  phone text,

  -- Cuando el receptor además come en el local (7 de 410). Nullable y
  -- ON DELETE SET NULL: perder el comensal no borra a quien se le factura.
  customer_id uuid references public.customers(id) on delete set null,

  -- `mxcli.codigo`, para que un re-import sepa qué ya trajo.
  external_ref text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- La clave natural: un CUIT, una entidad por negocio. Es también la clave de
  -- deduplicación del import — el backup tiene 30 CUIT repetidos en 410 filas.
  unique (business_id, cuit)
);

create index if not exists fiscal_entities_business_razon_idx
  on public.fiscal_entities (business_id, razon_social);
create index if not exists fiscal_entities_customer_idx
  on public.fiscal_entities (customer_id)
  where customer_id is not null;

drop trigger if exists set_updated_at on public.fiscal_entities;
create trigger set_updated_at
  before update on public.fiscal_entities
  for each row execute function public.set_updated_at();

-- ── La factura queda vinculada a quien la recibe ────────────────────────────
--
-- ON DELETE SET NULL, nunca CASCADE: depurar la lista de clientes no puede
-- borrar un comprobante fiscal emitido. El CUIT y la razón social siguen
-- guardados en la propia factura, que es el dato que vale.
alter table public.invoices
  add column if not exists fiscal_entity_id uuid
  references public.fiscal_entities(id) on delete set null;

create index if not exists invoices_fiscal_entity_idx
  on public.invoices (fiscal_entity_id)
  where fiscal_entity_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Misma forma que `customers`, menos el `user_id = auth.uid()`: acá no hay
-- dueño-cliente que deba ver su propia fila. Sólo `authenticated`, y sólo
-- miembros del negocio: el CUIT de las empresas a las que factura el local no
-- se filtra a la carta pública. Las mutaciones van por service role desde las
-- server actions, igual que `customers` (que sólo tiene policy de SELECT).
alter table public.fiscal_entities enable row level security;

drop policy if exists fiscal_entities_select on public.fiscal_entities;
create policy fiscal_entities_select on public.fiscal_entities
  for select to authenticated
  using (is_business_member(business_id) or is_platform_admin());

comment on table public.fiscal_entities is
  'A quién se le emite un comprobante. Distinto de `customers`: al comensal lo identifica el teléfono, al receptor el CUIT. Origen: `mxcli` de MaxiRest.';
comment on column public.fiscal_entities.condicion_iva is
  'Condición frente al IVA (ARCA RG 5616): 1 RI, 4 Exento, 5 Cons. Final, 6 Monotributo.';
comment on column public.invoices.fiscal_entity_id is
  'A quién se le facturó. NULL en las B a consumidor final sin identificar.';
