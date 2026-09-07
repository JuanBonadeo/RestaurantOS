-- 0070 · Los conceptos que el Golf usa de verdad, y la precarga que estaba muerta
-- (issue #243, spec 162)
--
-- La apuesta central de la 158 —«el proveedor precarga el concepto de la
-- compra»— depende de `suppliers.default_expense_concept_id`, y ese campo está
-- en CERO en los dos negocios reales: golf-jcr 0 de 111, kcc 0 de 110. El
-- mecanismo está implementado (`actions.ts:181`, `invoice-dialog.tsx:87`) y no
-- tiene un solo dato.
--
-- En MaxiRest, en cambio, 57 de 77 proveedores tienen `cod_cga`, y
-- **13.845 de 14.010 comprobantes (98,8%) llevan exactamente ese default** —
-- medido sólo desde 2024, 4.462 de 4.464 (100,0%). Son 9,3 compras por día que
-- hoy se tipearían a mano.
--
-- ── Los seis conceptos nuevos ─────────────────────────────────────────────
--
-- El seed de la 0066 tiene 31 y el Golf usó 38 distintos. Se agregan sólo los
-- que pasan el criterio de contar filas (histórico completo, 8 años):
--
--     Lavadero    248 comprobantes · hasta 2026-05-14
--     Diarios     110              · hasta 2026-05-18
--     Kiosco       88              · hasta 2026-04-22
--     Bazar        80              · hasta 2026-04-29
--     Farmacia      5              · hasta 2026-04-10
--     Fumigación   16              · hasta 2019-04-24  ← ver abajo
--
-- `Fumigación` es el caso raro: su último comprobante es de hace siete años,
-- pero hay un proveedor **activo** cuyo default es ése, el servicio es
-- obligatorio por bromatología, y «Mantenimiento de instalaciones» no lo
-- describe. Un concepto cuesta una fila; que el encargado lo tipee todos los
-- meses, no.
--
-- Lo que NO se crea, y por qué —el mismo criterio, al revés—:
--
--     Materiales Iluminación (2)      → «Ferretería», que ya existe
--     Aceites (4)                     → «Almacén»
--     Liquidación SAC/Vacaciones/Final,
--       Pago Extras (2 a 3 c/u)       → «Sueldos»: son variantes de la misma
--                                        liquidación, no conceptos distintos
--     Gastos Mant. Cta Bancaria (1)   → «Gastos varios»
--
-- ── El backfill ───────────────────────────────────────────────────────────
--
-- Los 57 pares proveedor→concepto salen del backup real (`mxpro.cod_cga` ×
-- `mxcga.nombre`) y se cruzan por **nombre normalizado** —sin acentos, sin
-- puntuación, case-insensitive— porque el índice de `suppliers` es btree crudo:
-- «Verdulería» y «VERDULERIA» no matchean solos. Con el cruce exacto entran 48;
-- normalizando, los 57.
--
-- Sólo escribe donde el campo está NULL: es idempotente y no pisa nada que
-- alguien haya elegido a mano.
--
-- `payment_terms_days` NO se backfillea, y eso es una conclusión, no un
-- pendiente: `mxpro.dias_venc` está en 0 en los 77 proveedores y el Golf paga
-- contado (60% el mismo día, 93% dentro de la semana, lag promedio 2,2 días).

-- ── 1 · los seis conceptos, también para los negocios que vengan ───────────
create or replace function public.seed_expense_concepts(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.expense_concepts (business_id, name, rubro)
  select p_business_id, c.name, c.rubro
  from (values
    ('Carnes', 'mercaderias'), ('Verdulería', 'mercaderias'),
    ('Panadería', 'mercaderias'), ('Pescados', 'mercaderias'),
    ('Pollo y huevos', 'mercaderias'), ('Lácteos', 'mercaderias'),
    ('Quesos y fiambres', 'mercaderias'), ('Almacén', 'mercaderias'),
    ('Bebidas sin alcohol', 'mercaderias'), ('Bebidas con alcohol', 'mercaderias'),
    ('Vinos', 'mercaderias'), ('Cafetería', 'mercaderias'),
    ('Kiosco', 'mercaderias'),
    ('Energía eléctrica', 'servicios'), ('Gas', 'servicios'),
    ('Agua', 'servicios'), ('Internet', 'servicios'),
    ('Telefonía', 'servicios'),
    ('Lavadero', 'servicios'), ('Fumigación', 'servicios'),
    ('Elementos de limpieza', 'mantenimiento'), ('Ferretería', 'mantenimiento'),
    ('Mantenimiento de instalaciones', 'mantenimiento'),
    ('Reparación de maquinarias', 'mantenimiento'),
    ('Útiles de trabajo', 'mantenimiento'), ('Ropa de trabajo', 'mantenimiento'),
    ('Sueldos', 'personal'), ('Adelantos', 'personal'),
    ('Cargas sociales', 'impuestos'), ('Ingresos brutos', 'impuestos'),
    ('Cristalería', 'vajilla'), ('Mantelería', 'vajilla'), ('Bazar', 'vajilla'),
    ('Descartables', 'otros'), ('Gastos varios', 'otros'),
    ('Diarios', 'otros'), ('Farmacia', 'otros')
  ) as c(name, rubro)
  on conflict (business_id, name) do nothing;
end;
$$;

-- Backfill de los negocios que ya existen (el `on conflict do nothing` deja
-- intactos los 31 que ya tienen).
select public.seed_expense_concepts(id) from public.businesses;

-- ── 2 · la precarga de golf-jcr ───────────────────────────────────────────
--
-- `normalizar_nombre` vive sólo en esta migración: es el cruce de un backfill,
-- no una regla del dominio. Si mañana hace falta de verdad, se promueve.
do $$
declare
  v_biz uuid;
  v_actualizados int;
  v_sin_match int;
begin
  select id into v_biz from public.businesses where slug = 'golf-jcr';
  if v_biz is null then
    raise notice 'golf-jcr no existe en esta base: se saltea el backfill';
    return;
  end if;

  create temp table _pares (proveedor text, concepto text) on commit drop;
  insert into _pares (proveedor, concepto) values
    ('ACEITE DE OLIVA', 'Almacén'),
    ('AL VINO VINO', 'Vinos'),
    ('ALAMENIA', 'Carnes'),
    ('ANDINA', 'Bebidas sin alcohol'),
    ('AVP', 'Panadería'),
    ('BACA DISTRIBUIDORA', 'Descartables'),
    ('BODEGA LA RURAL', 'Bebidas con alcohol'),
    ('CARBONERIA EL TOLA', 'Útiles de trabajo'),
    ('CARNICERIA', 'Carnes'),
    ('CASA PIRQUE SA', 'Bebidas con alcohol'),
    ('CATALUNYA', 'Bebidas con alcohol'),
    ('CCU ARGENTINA', 'Bebidas con alcohol'),
    ('CEPRO', 'Almacén'),
    ('CIF', 'Útiles de trabajo'),
    ('CITRIC', 'Bebidas sin alcohol'),
    ('COCA COLA', 'Bebidas sin alcohol'),
    ('CUMBRE NEVADA', 'Lácteos'),
    ('DESINFECCIONES LASER', 'Fumigación'),
    ('DISTRIBUIDORA DIQUE SRL', 'Útiles de trabajo'),
    ('ENEAS', 'Carnes'),
    ('EUGENIO BATTILANA', 'Vinos'),
    ('HELADOS YO', 'Lácteos'),
    ('KAISER', 'Elementos de limpieza'),
    ('LA ESPAÑOLA PAPAS PELADAS', 'Verdulería'),
    ('LA ESPERANZA', 'Almacén'),
    ('LA VIRGINIA', 'Cafetería'),
    ('LANTIA', 'Bebidas sin alcohol'),
    ('LAS CARACOLAS', 'Pescados'),
    ('LAVADERO', 'Lavadero'),
    ('LENGUITAS', 'Panadería'),
    ('LUCO DISTRIBUDORA', 'Almacén'),
    ('MAKRO', 'Almacén'),
    ('NOBLEX', 'Bazar'),
    ('NUNZIO S.R.L', 'Panadería'),
    ('OVERCLEAN', 'Elementos de limpieza'),
    ('PALADINI', 'Carnes'),
    ('PANADERIA LA FLOR DE FISHERTON', 'Panadería'),
    ('PAPELERA SUIPACHA S.R.L.', 'Útiles de trabajo'),
    ('PEPINO', 'Almacén'),
    ('POLLO Y HUEVOS', 'Pollo y huevos'),
    ('POSITANO', 'Bebidas con alcohol'),
    ('PUERTO GABOTO', 'Pescados'),
    ('QUESOS Y LACTEOS', 'Quesos y fiambres'),
    ('QUILMES', 'Bebidas sin alcohol'),
    ('REDIGRAM/AGUA DE VIDA', 'Bebidas con alcohol'),
    ('RH PRODUCTORES AVICOLAS', 'Carnes'),
    ('ROSARIO ABRASIVOS', 'Elementos de limpieza'),
    ('ROSARIO GAS', 'Bebidas sin alcohol'),
    ('SAGITARIO GOLOSINAS', 'Kiosco'),
    ('SALTO GRANDE', 'Pollo y huevos'),
    ('SAN ROMAN', 'Carnes'),
    ('SODA SOCIAL', 'Bebidas sin alcohol'),
    ('TORTAS/POSTRES', 'Panadería'),
    ('TREMBLAY', 'Lácteos'),
    ('TRUCHAS', 'Pescados'),
    ('VERDULERIA', 'Verdulería'),
    ('YOGURES DAHI', 'Lácteos'),
    -- Los cuatro que cambiaron de nombre al migrar a la nube. Se listan con el
    -- nombre de ACÁ, no el de MaxiRest: dos proveedores que allá eran una sola
    -- ficha con barra («REDIGRAM/AGUA DE VIDA») se separaron, y a dos les
    -- recortaron el nombre («TORTAS/POSTRES» → «TORTAS», «LA ESPAÑOLA PAPAS
    -- PELADAS» → «PAPAS PELADAS»). Sin esto quedan afuera 50 comprobantes al
    -- año, y son los únicos recuperables: los otros cinco pares sin match son
    -- proveedores que directamente no existen en la nube.
    ('TORTAS', 'Panadería'),
    ('REDIGRAM', 'Bebidas con alcohol'),
    ('AGUA DE VIDA', 'Bebidas con alcohol'),
    ('PAPAS PELADAS', 'Verdulería');

  with norm as (
    select p.proveedor, p.concepto,
           lower(translate(p.proveedor, 'ÁÉÍÓÚÜÑáéíóúüñ.,-/()', 'AEIOUUNaeiouun')) as k
    from _pares p
  ),
  destino as (
    select s.id as supplier_id, ec.id as concept_id
    from norm n
    join public.suppliers s
      on s.business_id = v_biz
     and lower(translate(s.name, 'ÁÉÍÓÚÜÑáéíóúüñ.,-/()', 'AEIOUUNaeiouun')) = n.k
    join public.expense_concepts ec
      on ec.business_id = v_biz and ec.name = n.concepto
    where s.default_expense_concept_id is null
  )
  update public.suppliers s
     set default_expense_concept_id = d.concept_id
    from destino d
   where s.id = d.supplier_id;

  get diagnostics v_actualizados = ROW_COUNT;

  select count(*) into v_sin_match
  from _pares p
  where not exists (
    select 1 from public.suppliers s
    where s.business_id = v_biz
      and lower(translate(s.name, 'ÁÉÍÓÚÜÑáéíóúüñ.,-/()', 'AEIOUUNaeiouun'))
        = lower(translate(p.proveedor, 'ÁÉÍÓÚÜÑáéíóúüñ.,-/()', 'AEIOUUNaeiouun'))
  );

  raise notice 'golf-jcr · proveedores con concepto precargado: % · pares sin proveedor en la nube: %',
    v_actualizados, v_sin_match;
end $$;
