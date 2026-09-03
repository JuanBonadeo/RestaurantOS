-- 0061 · Datos fiscales del cliente (spec 150)
--
-- `customers` guardaba con qué contactar a alguien (teléfono, nombre, mail) pero
-- no con qué facturarle. Para emitir una Factura A había que tipear el CUIT, la
-- razón social y la condición de IVA en cada cobro — el mismo sanatorio, todos
-- los meses, once dígitos a mano en un comprobante fiscal.
--
-- Los tres campos son NULLABLE a propósito: la enorme mayoría de los clientes son
-- consumidores finales que nunca van a tener CUIT, y el alta desde la carta, el
-- chatbot y el walk-in no puede pedirlos. Un cliente con datos fiscales es un
-- cliente normal que además se puede facturar.
--
-- El origen natural de estos datos es `mxcli` de MaxiRest: 410 clientes con CUIT
-- en Golf, 62 en KCC (ver wiki/negocio/maxirest-clientes-mxcli.md). El import es
-- el paso siguiente; esta migración es dónde aterriza.

alter table public.customers
  add column if not exists cuit text,
  add column if not exists razon_social text,
  add column if not exists condicion_iva smallint;

-- El CUIT se guarda NORMALIZADO: 11 dígitos, sin guiones. En MaxiRest viene como
-- "30-50023730-5" en un char(70), y el front ya normaliza con replace(/\D/g,"")
-- antes de emitir; el check evita que un import o un INSERT a mano metan el
-- formato con guiones y después no matcheen entre sí.
alter table public.customers
  drop constraint if exists customers_cuit_normalizado;
alter table public.customers
  add constraint customers_cuit_normalizado
  check (cuit is null or cuit ~ '^[0-9]{11}$');

-- Códigos de condición frente al IVA de ARCA (RG 5616), los mismos que ya usa
-- `invoices.condicion_iva_receptor` (smallint): 1 Resp. Inscripto, 4 Exento,
-- 5 Consumidor Final, 6 Monotributo. OJO: NO son los códigos internos de
-- MaxiRest — su `tipo_iva` usa otra numeración (allá el "1" es justamente el que
-- no tiene CUIT), así que el import tiene que mapear, no copiar.
alter table public.customers
  drop constraint if exists customers_condicion_iva_valida;
alter table public.customers
  add constraint customers_condicion_iva_valida
  check (condicion_iva is null or condicion_iva in (1, 4, 5, 6));

-- Buscar al cliente por CUIT en el cobro. Parcial: sólo indexa a los que
-- facturan (410 sobre 2.786 en Golf), no a toda la cartera de delivery.
create index if not exists customers_business_cuit_idx
  on public.customers (business_id, cuit)
  where cuit is not null;

-- ── La factura queda vinculada al cliente ───────────────────────────────────
--
-- `invoices` ya guardaba `cuit_receptor` y `razon_social_receptor`, pero sueltos:
-- ninguna factura sabía a qué cliente le corresponde, así que no se podía
-- responder "qué le facturamos a este cliente" — que es exactamente lo que hace
-- falta para la liquidación mensual.
--
-- ON DELETE SET NULL, nunca CASCADE: un comprobante fiscal emitido no se borra
-- porque alguien depure la lista de clientes. El CUIT y la razón social quedan
-- igual en la factura, que es el dato que vale.
alter table public.invoices
  add column if not exists customer_id uuid
  references public.customers(id) on delete set null;

create index if not exists invoices_customer_idx
  on public.invoices (customer_id)
  where customer_id is not null;

comment on column public.customers.cuit is
  'CUIT normalizado a 11 dígitos, sin guiones. NULL en consumidores finales.';
comment on column public.customers.condicion_iva is
  'Condición frente al IVA (ARCA RG 5616): 1 RI, 4 Exento, 5 Cons. Final, 6 Monotributo.';
comment on column public.invoices.customer_id is
  'Cliente al que se le facturó. NULL en las B a consumidor final sin identificar.';
