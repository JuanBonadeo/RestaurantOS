# 152 · Importar los receptores de MaxiRest

**Issue:** [#228](https://github.com/gachetponzellini/RestaurantOS-app/issues/228) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ aplicado (2026-09-03) — **378 receptores en `golf-jcr`, 56 en `kcc`**

**Input:** Juan, 2026-09-03, al ver que `fiscal_entities` estaba vacía: *"ya
importaste los datos del maxirest?????"*.

Es el fast-follow que la [spec 150](../150-factura-a-un-cliente/spec.md) dejó
escrito en su **D7** y sacó de su alcance a propósito: el modelo y el flujo
tenían que existir antes de tener dónde importar. Ya existen —`fiscal_entities`
aplicada, el buscador en el cobro, el ABM en Facturación— y la tabla tiene
**una sola fila**, cargada a mano probando.

**Depende de**: [`150`](../150-factura-a-un-cliente/spec.md) (la tabla, la
normalización del CUIT y la pantalla donde se ven).

---

## Por qué

Golf le factura A a **410 clientes con CUIT**; KCC a **62**. Están en `mxcli`,
la tabla de clientes de MaxiRest, con CUIT, razón social, condición fiscal,
domicilio y contacto. Relevamiento completo en
[`wiki/negocio/maxirest-clientes-mxcli.md`](../../../wiki/negocio/maxirest-clientes-mxcli.md).

Sin import, la 150 le sirve al local **desde cero**: la primera factura a cada
uno de esos 410 sigue siendo la de hoy —tipear CUIT, razón social y condición— y
recién la segunda se beneficia. Son ~4.000 facturas A de historia entre los dos
puntos de venta: la cartera no es una hipótesis, es lo que el local factura todos
los meses.

Cargar 410 filas a mano no es una opción. Y el `external_ref` de la tabla existe
justamente para esto: para que un re-import sepa qué ya trajo.

## Las decisiones

**D1 · Script, no pantalla.** El repo ya importa MaxiRest así —
[`import-maxirest-empleados.ts`](../../scripts/import-maxirest-empleados.ts),
[`import-maxirest-empleados-kcc.ts`](../../scripts/import-maxirest-empleados-kcc.ts),
[`extract-maxirest.mjs`](../../scripts/extract-maxirest.mjs)— y esto no es una
función que el local vaya a usar: es una **migración de una sola vez** (dos, con
el re-run del cutover) que corremos nosotros con el backup en la mano. Una
pantalla de import obligaría antes a un paso de exportación a CSV que hoy no
existe, para un botón que se aprieta dos veces en la vida del proyecto.

El goteo posterior ya está cubierto: el alta desde el cobro y el ABM de la 150.

**D2 · Entra sólo quien tiene CUIT.** De los 2.786 clientes de Golf, **2.376 son
consumidor final sin CUIT**: no son receptores de factura, son comensales. Si
entraran, `fiscal_entities` pasaría a ser una copia de la agenda del POS y el
buscador del cobro —que es lo que esta tabla existe para servir— se llenaría de
ruido. El corte es tener CUIT, que es la clave natural de la tabla.

**D3 · Sin razón social, se cae al nombre y apellido.** Acá está el agujero que
no se ve en el resumen: **410 tienen CUIT pero sólo 271 tienen razón social**.
Las otras **139 no se pueden insertar** — `razon_social` es NOT NULL con
`check (length(trim(razon_social)) > 0)`.

`mxcli` tiene `nombre` y `apellido` aparte de `razon`, así que la mayoría de esas
139 son personas físicas con CUIT cargadas por nombre. El fallback es
`razon` → `"apellido, nombre"` → **saltear y reportar**. Inventar una razón
social a partir del CUIT ("CUIT 30-...-5") sería peor que no traer la fila: queda
en la lista sin que nadie pueda reconocerla.

> **Al implementar:** el fallback rescata **138 de las 139** — queda una sola
> fila sin nombre (código 1178), y su CUIT entra igual porque está repetido en
> otra que sí lo tiene. **Ningún CUIT de Golf se pierde.**
>
> Y los datos pidieron una regla más: en **24 de esas 138**, `nombre` y
> `apellido` son **el mismo texto** (el usuario de MaxiRest escribió la empresa
> en los dos campos), y en otras 3 uno contiene al otro. Sin tratarlo, entraban
> como `"TANONI HNOS SA, TANONI HNOS SA"`. Cuando son iguales se usa uno solo;
> cuando uno contiene al otro, el más largo.

**D4 · Deduplica por `(business_id, cuit)`, que es el unique.** El backup trae
**30 CUIT repetidos** en esas 410 filas (378 distintos). Gana **la primera fila
con razón social**; si ninguna la tiene, la de `codigo` más bajo. Las descartadas
se reportan con su `codigo`, para poder mirarlas si el local pregunta.

**D5 · Un re-import no pisa lo que ya está.** Es la misma regla que el D4 de la
150, por la misma razón: si alguien corrigió una razón social en la pantalla de
Facturación, el import del mes siguiente no puede deshacerlo en silencio. El
script **inserta lo que falta y reporta lo que ya estaba**, sin tocarlo. Para eso
alcanza `on conflict do nothing` sobre el unique.

**D6 · El `tipo_iva` de MaxiRest NO son los códigos de ARCA.** Es la trampa de
esta spec. `fiscal_entities.condicion_iva` usa RG 5616 (1=RI, 4=Exento,
5=Consumidor Final, 6=Monotributo); MaxiRest usa numeración propia, donde el `1`
es justamente **el que no tiene CUIT**. Copiar el número sin mapear declararía
Responsable Inscripto a un consumidor final, en la tabla desde la que se emite un
comprobante fiscal.

**Resuelto con los datos, no con una suposición.** La primera versión de esta
spec asumía `6 → Monotributo` porque comparte dígito con el código de ARCA. Es
falso. El cruce contra los **189.380 comprobantes de `mxfac`** —que guarda
`cod_cpb` (la letra) junto al `tipo_iva`— lo cierra:

| `tipo_iva` | Clientes | Con CUIT | Comprobantes que recibió | → `condicion_iva` |
|---|---|---|---|---|
| `1` | 2.376 | 3 | 22.905 B, 10.764 H — **ninguna A** | **5** Consumidor Final |
| `2` | 399 | 396 | **2.782 Facturas A** | **1** Resp. Inscripto |
| `6` | 11 | 11 | 537 G, 144 B, 61 H — **ninguna A** | **4** Exento |

Los del `6` **no recibieron una sola Factura A en 189.380 comprobantes**, y un
monotributista sí puede recibirla. Mirando quiénes son, cierra: los 11 son el
Jockey Club de Rosario, la Federación de Golf del Sur del Litoral, la Federación
Santafesina de Tenis, dos asociaciones mutuales, una asociación civil, una
fundación, una caja de previsión social y un sanatorio — **CUIT 30 y 33, ni una
persona física**. Es el perfil de un exento, no de un monotributista.

Importarlos como Monotributo habría sido peor que un dato feo: la pantalla de
cobro le habría ofrecido **Factura A** a nueve entidades exentas
(`condicionesValidasPara("factura_a")` = RI o Monotributo).

**D7 · No se toca `customers`.** Los 7 casos en que un receptor además es comensal
se pueden enlazar después con `fiscal_entities.customer_id`; el import no lo hace.
Enlazar por nombre es adivinar, y de los 410 sólo 20 tienen teléfono — el único
dato con el que el match sería seguro. Que la columna quede en NULL no rompe
nada: es exactamente para lo que es nullable.

## Alcance

- **`scripts/extract-maxirest-clientes.mjs` (nuevo)** — saca `mxcli` del dump y
  escribe un JSON intermedio. El dump es **latin1** y los `INSERT` son una línea
  gigantesca por tabla, así que el parseo tiene que respetar comillas y escapes
  (cortar por comas rompe con cualquier razón social que tenga una). El
  `extract-maxirest.mjs` que ya existe tiene ese parser para `mxart`, pero
  hardcodea un path de Windows y números de línea: acá el path va por argumento y
  la tabla se busca por `INSERT INTO \`mxcli\``.
- **`scripts/import-maxirest-clientes.ts` (nuevo)** — toma el JSON, aplica D2–D6
  y escribe en `fiscal_entities` con `external_ref = mxcli.codigo`. Corre por
  negocio (`--slug golf-jcr` / `--slug kcc`) y **por defecto en dry-run**: imprime
  el reporte y no escribe nada hasta que se le pasa `--apply`.
- **El reporte** — cuántas entraron, cuántas ya estaban, y el detalle de las que
  no entraron con el motivo (sin razón social ni nombre, CUIT inválido, duplicado
  descartado, `tipo_iva` inesperado). Es lo que se le muestra al local.
- **Tests del mapeo y la deduplicación**, sobre las funciones puras: normalizar
  el CUIT, elegir la razón social (D3), resolver duplicados (D4) y mapear el
  `tipo_iva` (D6). Es lógica de datos fiscales — va con test primero, no con
  «corrí el script y parece que anduvo».

## Qué NO entra

- **Los 2.376 consumidores finales sin CUIT** (D2). Si algún día se quieren como
  `customers`, es otra spec y otra tabla — y choca con que `customers.phone` es
  NOT NULL.
- **Enlazar `customer_id`** (D7).
- **Migrar la cuenta corriente** (`bloq_cred` / `tope_cred` de `mxcli`). Es la
  [spec 141](../141-cuentas-corrientes/spec.md); los datos salen de la misma
  tabla y conviene traerlos cuando esa spec exista, no antes.
- **Validar los CUIT contra el padrón de ARCA.** Mismo criterio que la 150: el
  gateway rechaza el CUIT inexistente al emitir.
- **Una pantalla de import** (D1).

## Escenarios de aceptación

1. **Dado** el dump de Golf, **cuando** se corre el extractor, **entonces**
   salen las 2.786 filas de `mxcli` con sus campos, incluidas las razones
   sociales que tienen comas.
2. **Dado** ese JSON, **cuando** se corre el import en dry-run, **entonces** no
   se escribe nada y el reporte dice cuántas entrarían y cuántas no, con el
   motivo de cada exclusión.
3. **Dado** un cliente con CUIT `"30-50023730-5"`, **entonces** se guarda como
   `30500237305` — 11 dígitos, el CHECK de la tabla.
4. **Dado** un cliente **con CUIT y sin razón social pero con nombre y
   apellido**, **entonces** entra como `"APELLIDO, NOMBRE"` (D3).
5. **Dado** un cliente con CUIT y **sin razón social, nombre ni apellido**,
   **entonces** NO entra y aparece en el reporte con su `codigo`.
6. **Dado** el CUIT repetido en dos filas, **cuando** una tiene razón social y la
   otra no, **entonces** entra la que la tiene y la otra se reporta como
   descartada (D4).
7. **Dado** un `tipo_iva = 2`, **entonces** la entidad queda con
   `condicion_iva = 1` (Responsable Inscripto) — no con `2` (D6).
8. **Dado** un import ya corrido, **cuando** se vuelve a correr, **entonces** no
   se duplica ninguna fila y **no se pisa** ninguna existente, ni siquiera si el
   backup trae un dato distinto (D5).
9. **Dado** un cliente que alguien editó a mano en Facturación, **cuando** se
   re-importa, **entonces** su razón social corregida sigue ahí.
10. **Dado** el import terminado en `golf-jcr`, **cuando** la encargada abre el
    cobro y elige Factura A, **entonces** encuentra al Jockey Club de Rosario
    escribiendo «jockey», sin tipear el CUIT.
11. **Dado** el import corrido en `golf-jcr`, **entonces** `kcc` sigue con sus
    propias entidades y ninguna cruzada — el `business_id` va en cada fila.

## Verificación

**Tests** — 26 en `maxirest-import.test.ts`, escritos antes del script: el
fallback de la razón social y sus tres casos raros, el mapeo del `tipo_iva`, la
deduplicación (incluido que **no dependa del orden de las filas**), el CUIT
normalizado, el contacto opcional como `null`, y que un `tipo_iva` desconocido se
descarte en vez de adivinarse.

**Los números cierran contra el relevamiento**, que es la prueba de que el parser
lee bien el dump:

| | Golf | KCC |
|---|---|---|
| Filas en `mxcli` | 2.786 ✓ | 782 ✓ |
| Sin CUIT (comensales) | 2.376 | 717 |
| Con CUIT | 410 ✓ | 62 ✓ |
| **Entidades importadas** | **378** ✓ | **56** |
| Duplicadas por CUIT | 31 | 6 |
| Descartadas | 1 | 3 (CUIT `"- -"`) |

378 + 31 + 1 = 410 y 56 + 6 = 62: no se perdió ni se inventó una fila.

**Condición de IVA importada** — Golf: 368 RI, **9 Exento**, 1 Consumidor Final.
Los 9 exentos son los 11 del `tipo_iva = 6` menos dos duplicados (el Jockey Club
y el Sanatorio Neuropático estaban dos veces).

**En vivo**, con `sheila.tonso@golf-jcr.internal` (**encargada**, el rol real que
factura): la lista muestra los 378, y buscar «jockey» devuelve
**JOCKEY CLUB DE ROSARIO · 30-50023730-5 · Exento** (escenario 10). La búsqueda
por CUIT con guiones se verificó contra los datos importados.

> El escenario 10 se verificó en la pantalla de **Entidades fiscales**, no
> abriendo una mesa: exige el mismo `buscarEntidades` y no escribe nada en el
> negocio del cliente. El buscador del cobro ya quedó verificado en `demo` con la
> spec 150.

**Escenarios 8 y 9 (el re-import)** — correr el import de nuevo sobre Golf
escribió **0 filas** y reportó las 378 como ya existentes. Y contra una entidad
**editada a mano** (la de `demo`, que se había corregido a «SANATORIO PARQUE
S.A.» con su domicilio), el import con el dato original **no la pisó**: quedó
como la dejó la persona.

**Calidad de lo importado** — verificado en la base: `TANONI HNOS SA` (no
`"TANONI HNOS SA, TANONI HNOS SA"`), la ñ de `GRUPO OROÑO` intacta (el dump es
latin1), `DE CAPUA, CESAR ARIEL` completo, y los 378 con `external_ref` cargado
para que el próximo import sepa qué trajo.

## Preguntas abiertas

1. ~~**¿Qué es el `tipo_iva = 6`?**~~ ✅ **Resuelto con los datos: es Exento**
   (ver D6). No recibieron ni una Factura A en 189.380 comprobantes, y los 11 son
   clubes, federaciones, mutuales y fundaciones. Se importaron como `4`.
2. **¿Hay que re-correrlo en el cutover?** Sí. El backup de Golf es del
   **23/12/2025** y el local siguió cargando clientes en MaxiRest desde entonces;
   el de KCC es del **20/07/2026**. El D5 hace que re-correrlo sea seguro —está
   verificado— así que al migrar se corre de nuevo con un backup fresco y entran
   sólo los nuevos.
3. **Las 24 razones sociales con conflicto** (Golf) y 4 (KCC) quedaron con la que
   eligió el D4 y están listadas en el reporte del script. Casi todas son la
   misma empresa escrita de dos formas (`"VALOR AGREGADO S.R.L."` vs `"SRL"`),
   pero un par son typos que conviene corregir en la pantalla:
   `"WHELL S.A."` (por WHEEL), `"WEID INGENIERIA S.R.L."` (por WELD) y
   `"NEGOCIO DE GRANOS SRL"` (la otra fila decía `"NEGOCIOS DE GRANOS S.A."`).
4. **El código 2029 de Golf** entró como `"XXX, XXX"` (CUIT 30-64087256-6): es
   basura de carga en el origen. Está en el reporte «a revisar».
