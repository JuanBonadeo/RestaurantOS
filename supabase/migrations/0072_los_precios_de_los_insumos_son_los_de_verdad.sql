-- 0072 · Los precios de los insumos son los de verdad (issue #244, spec 164)
--
-- El catálogo de insumos de golf-jcr salió de `scripts/extract-maxirest.mjs` —una
-- curación a mano del catálogo real— pero **el seed guardó el precio POR UNIDAD
-- como precio del PACK**. La prueba está en que para varios insumos el factor de
-- error es EXACTAMENTE el `net_quantity` de su presentación:
--
--     Tomate       net 20 kg   → 20,0x     Ajo          net 10 un   → 10,0x
--     Harina 0000  net 25 kg   → 25,9x     Manzana roja net 10 kg   → 10,0x
--
-- Y donde no da exacto, la diferencia es la inflación entre el seed (2026-05-29)
-- y el precio del backup.
--
-- **El costo medido**: con los precios reales sobre las 436 líneas de receta que
-- golf-jcr ya tiene cargadas, el food cost pasa de **13,7% a 29,3%** —más del
-- doble— y **4 platos pasan a venderse a pérdida**. El dueño va a mirar esa
-- pantalla el día 1 y hoy le dice que gana el doble de lo que gana.
--
-- ── De dónde sale cada precio ─────────────────────────────────────────────
--
-- De `mxins.precio` del backup, multiplicado por el `net_quantity` de nuestra
-- presentación. **No se aplicó el factor `net_quantity` a ciegas**: eso habría
-- sido asumir que el error es idéntico en los 122, y no lo es —18 de los 97 que
-- cruzan estaban más CAROS que MaxiRest, así que a ésos el precio les BAJA—.
-- La fuente es el precio real, no una regla de tres.
--
--     97 de 122 insumos cruzan por nombre normalizado
--     73 suben · 18 bajan · 6 quedan igual
--     25 no cruzan y NO se tocan (ver abajo)
--
-- Los 25 sin match son de dos clases: los que en MaxiRest se llaman distinto
-- («Muzarella» vs QUESO MUZZARELLA, «Champiñones» vs CHAMPIGNON) y los que no
-- existen allá. Adivinar el match por similitud acá sería escribir un precio
-- inventado sobre plata que el dueño va a leer como si fuera medida. Quedan como
-- están y se resuelven con el matching que la #245 necesita igual.
--
-- ── Caveat honesto ────────────────────────────────────────────────────────
--
-- El backup es de mayo-2026 y hoy es septiembre: los precios llegan con cuatro
-- meses de atraso. Siguen siendo 3-40x mejores que los actuales, y el
-- `ingredient_price_log` —que hasta hoy tiene CERO filas en los tres negocios—
-- se llena solo con este cambio: a partir de acá hay histórico.
--
-- Se aplica a golf-jcr y a demo: los dos tienen el mismo catálogo salido del
-- mismo seed, con el mismo error. kcc no tiene insumos.

do $$
declare
  v_biz uuid;
  v_slug text;
  v_n int;
begin
  create temp table _precios (nombre text, cents bigint) on commit drop;
  insert into _precios (nombre, cents) values
    ('Aceite de girasol', 1704865),
    ('Aceite de oliva', 900000),
    ('Aceitunas negras', 1018594),
    ('Acelga', 222222),
    ('Aceto balsámico', 256250),
    ('Ajo', 700000),
    ('Albahaca', 150000),
    ('Alcaparras', 289222),
    ('Apio', 200000),
    ('Arroz', 803175),
    ('Atún desmenuzado', 134620),
    ('Azúcar', 544735),
    ('Berenjena', 1267605),
    ('Boga despinada', 2178570),
    ('Bondiola de cerdo', 2184000),
    ('Calabaza', 300000),
    ('Caldo de verduras', 951272),
    ('Carne picada', 5750000),
    ('Carré de cerdo', 1930500),
    ('Cebolla', 750000),
    ('Cebolla de verdeo', 1351351),
    ('Chorizo', 1050000),
    ('Churrasquito', 3541500),
    ('Costilla asado', 20500000),
    ('Costilla de cerdo', 3849645),
    ('Crema de leche', 725000),
    ('Crepe', 5600),
    ('Discos de empanada', 129996),
    ('Dulce de leche', 2333385),
    ('Entraña', 7350000),
    ('Entrecot', 17500000),
    ('Filet de abadejo', 5380000),
    ('Filet de salmón', 6580000),
    ('Frutillas', 357142),
    ('Harina 0000', 2124900),
    ('Hongos de pino', 468854),
    ('Huevos', 574980),
    ('Jamón cocido', 3953200),
    ('Jamón crudo', 9360000),
    ('Langostinos pelados', 2190000),
    ('Leche', 165625),
    ('Lechuga', 1803921),
    ('Limón', 1750000),
    ('Lomo', 12250000),
    ('Manteca', 216960),
    ('Manzana roja', 2009340),
    ('Manzana verde', 2997600),
    ('Masa pastas frescas', 45176),
    ('Masa pastas rellenas', 17871),
    ('Matambre de cerdo', 3885900),
    ('Matambre de vaca', 5970000),
    ('Mayonesa', 1282464),
    ('Molleja', 5700000),
    ('Morcilla', 2999700),
    ('Mostaza', 128012),
    ('Nalga', 10500000),
    ('Nueces', 1799469),
    ('Ojo de bife', 9819005),
    ('Osobuco', 2925000),
    ('Pacú', 2560000),
    ('Pan de mesa', 300000),
    ('Pan lactal', 245000),
    ('Panceta ahumada', 4222600),
    ('Panko', 1000000),
    ('Papa', 4000000),
    ('Peceto', 6000000),
    ('Pera', 3000000),
    ('Perejil', 162162),
    ('Puerro', 333333),
    ('Queso azul', 2800000),
    ('Queso barra', 3840000),
    ('Queso crema', 2242030),
    ('Queso provolone', 6800000),
    ('Queso sardo', 4560000),
    ('Ravioles de verdura', 77847),
    ('Rebozador', 236465),
    ('Rúcula', 250000),
    ('Sal fina', 208423),
    ('Sal parrillera', 179608),
    ('Salame bastón', 2480892),
    ('Salsa 4 quesos', 160959),
    ('Salsa blanca', 15808),
    ('Salsa bolognesa', 347992),
    ('Salsa crema', 38250),
    ('Salsa demiglasé', 744330),
    ('Salsa tuco', 191992),
    ('Solomillo', 1954600),
    ('Sorrentinos JyQ', 161200),
    ('Sorrentinos de calabaza', 103500),
    ('Sorrentinos de salmón', 248271),
    ('Tomate', 4500000),
    ('Tomate cherry', 200000),
    ('Tomate deshidratado', 2954430),
    ('Vainillas', 75670),
    ('Vinagre de alcohol', 93824),
    ('Zanahoria', 350000),
    ('Ñoquis de papa', 117723);

  foreach v_slug in array array['golf-jcr', 'demo']
  loop
    select id into v_biz from public.businesses where slug = v_slug;
    continue when v_biz is null;

    update public.ingredient_presentations p
       set cost_cents = np.cents
      from public.ingredients i, _precios np
     where p.ingredient_id = i.id
       and i.business_id = v_biz
       and i.name = np.nombre
       and p.is_default
       and p.cost_cents <> np.cents;

    get diagnostics v_n = ROW_COUNT;
    raise notice '% · presentaciones corregidas: %', v_slug, v_n;
  end loop;
end $$;
