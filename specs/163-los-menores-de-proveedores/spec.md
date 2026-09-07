# 163 · Los menores de proveedores

**Issue:** [#246](https://github.com/gachetponzellini/RestaurantOS-app/issues/246) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-07)

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md),
[`159`](../159-la-pantalla-como-la-de-maxirest/spec.md),
[`161`](../161-las-lecturas-de-proveedores-no-mienten/spec.md) (de donde sale la
política de guardas que se reusa acá).

---

## Por qué

Cinco cosas independientes y chicas, juntas para no abrir cinco specs. Lo que
las une es que **todas son deuda de las specs 158 y 159**, no features nuevas.

## Las decisiones

**D1 · La edición de comprobante existe, y la guarda va partida.**

El Alcance de la 158 decía «alta / edición / anulación». La edición **nunca
existió**: cero `update` sobre `supplier_invoices` fuera de `anularComprobante`,
y el botón «Editar» de la ficha es el del *proveedor*.

El volumen honesto es bajo —~26 comprobantes editados en 5,7 años en MaxiRest
(0,2%)— pero es un **piso, no un conteo**: una corrección que sólo toca la
cabecera no deja rastro en ninguna tabla, y es justo la clase que aplica a
nuestro modelo header-only.

**El caso que duele** es el concepto de gasto: es columna nuestra, alimenta el
informe de la 158, y es lo típico que se descubre mal clasificado a fin de mes
con la compra ya paga. Hoy corregir un rótulo obliga a anular el pago, y
`anularPagoProveedor` marca la sangría que **el arqueo ya contó**. Nadie lo va a
hacer: el informe queda sucio para siempre.

Por eso la guarda se parte:

| | cuándo |
|---|---|
| **Plata** — total, fecha, tipo | sólo sin pagos vivos imputados |
| **Clasificación** — concepto, vencimiento, número, notas | siempre |

Y se parte **en el server**. La pantalla deshabilita los campos de plata con el
motivo escrito, pero eso es cortesía: filtrar un `<input>` no cierra un POST
directo. La lectura de imputaciones usa la misma política que la 161 · D3 — si
no se puede saber si hay pagos vivos, no se toca la plata.

**D2 · La orden de pago tiene número, y el trigger es el de `orders`.**

Guardamos un UUID y el libro renderiza «Efectivo + fecha + monto»: **dos pagos en
efectivo del mismo monto el mismo día son indistinguibles**. MaxiRest numera
14.539 órdenes, 8,9 por día. El precedente exacto es `caja_cortes.numero`
(0063 · D14): *«correlativo por negocio, para poder nombrar el cierre por
teléfono»*.

El patrón es `set_order_number` (`0001:601`): trigger BEFORE INSERT con
`pg_advisory_xact_lock` por negocio. La clave del lock lleva el prefijo
`supplier_payments:` para **no serializar cobros contra pagos a proveedor**, que
no tienen nada que ver entre sí. Backfill cero.

Lo que **no** se porta es la pantalla del módulo 38: consultar ya lo hace la
ficha de la 159 y anular ya está. Y el argumento de que «el número es la única
forma de agrupar el acto de pago» es falso: agrupando bien, las 1.864 órdenes del
último año agrupan exactamente un comprobante cada una, y nosotros ya agrupamos
con `supplier_payment_allocations`.

**D3 · La foto se ve.**

`image-uploader.tsx`, en la rama `value && returnPath` —la única que usa
proveedores, porque el bucket es privado— pintaba **el mismo `ImagePlus` que el
estado vacío**. No había forma de saber si la foto quedó.

**Ya falló en el negocio real**: 2 objetos huérfanos en el bucket de golf-jcr,
subidos con 15 s de diferencia (jpeg 256 KB, después webp 8,9 KB) contra **0
filas** de `supplier_invoices` — alguien subió, no vio nada, y volvió a subir. Y
el 52% de los comprobantes del Golf no son fiscales: el papel es la única prueba
que queda.

El fix es un `objectURL` del archivo recién elegido, que cubre el caso que
importa (la acabás de subir y la ves); si el valor viene de la base, al menos se
distingue «Cargada» de vacío.

**D4 · El rubro de insumo NO entra acá.**

Es el punto 4 de la issue y se difiere **con el argumento de la propia issue**:
*«duele de verdad recién cuando el catálogo llegue a ~308»*, que es lo que hace
[#244](https://github.com/gachetponzellini/RestaurantOS-app/issues/244). Hoy son
122 insumos en una lista filtrable por nombre. Entra con la spec que traiga el
catálogo completo, no antes.

**D5 · Los restos, y por qué cada uno.**

- **`stats.ts` entero se borra.** Cero importadores, y tenía **test verde**:
  cobertura falsa, que es peor que no tener test.
- **`getSaldosDeProveedores` se borra.** Sin un solo caller desde que se escribió.
- **El parámetro `hastaFecha` de `getVencimientos` se borra.** Su único caller
  nunca lo pasa.
- **La fecha AR sale a un módulo.** `hoyAR`/`primerDiaDelMes` estaban copiadas en
  cuatro componentes y `supplier-stats.tsx` usaba `toISOString()`, que es **UTC**:
  después de las 21 hs el rango saltaba a mañana, y el 30 a las 21 el «hasta» se
  iba al mes siguiente. Una copia sola no se desincroniza.
- **«Total comprado» deja de contar los anulados.** `getSuppliers` y
  `getSupplierStats` no filtraban `cancelled_at`; la Cta. Cte. sí. La misma plata
  daba dos números distintos a doce líneas de distancia.
- **El pago mixto vuelve al pie.** `totalesDelPeriodo` filtraba con un `Set` de
  `payment_id`, así que **una sola** imputación sacaba al pago entero de la
  cuenta — pero `repartirPago` produce el mixto, y el toast prometía «$40.000
  quedaron a cuenta» mientras el pie decía **$0**. Con un `Map`, lo a-cuenta es
  lo que sobra de cada pago, que es la definición.

## Alcance

**Datos** — migración `0071`: `supplier_payments.numero`, su índice único parcial
y el trigger.

**Server:** `editarComprobante` + `SupplierInvoiceEditInput`; el `numero` en
`PAYMENT_COLS` y en el detalle del libro; `is("cancelled_at", null)` en las dos
queries de stats; `totalesDelPeriodo` con Map; `fechas-ar.ts`; las tres piezas
muertas borradas.

**UI:** `editar-comprobante-dialog.tsx` y el lápiz en la fila de la Cta. Cte.;
el preview del uploader; las cuatro copias de `hoyAR` reemplazadas.

## Qué NO entra

- **El rubro de insumo** (D4).
- **Regenerar `database.types.ts` y sacar los casts.** Es el resto más grande de
  la issue y toca los tres archivos del módulo más `caja_movimientos` y `cajas`.
  Merece su propio diff, y este ya toca nueve archivos.
- **Que la ficha pida las facturas dos veces** y los N `createSignedUrl` en serie.
  Es rendimiento, no corrección, y va junto con lo anterior.
- **Retro-numerar los pagos viejos.** Quedan en `NULL`, como los cortes anteriores
  a la 0063: inventarles un número es inventar un correlativo que nunca existió.

## Escenarios de aceptación

1. **Dado** un comprobante **ya pago**, **entonces** el concepto se puede
   corregir y el importe no.
2. **Dado** un comprobante sin pagos, **entonces** también se corrigen importe y
   fecha.
3. **Dado** que falla la lectura de imputaciones, **entonces** no se toca la
   plata.
4. **Dado** un comprobante anulado, **entonces** no se edita.
5. **Dado** un pago nuevo, **entonces** tiene número correlativo por negocio, y
   dos pagos seguidos no comparten número.
6. **Dado** el libro del proveedor, **entonces** el pago se lee «OP #N · Efectivo»
   y no sólo «Efectivo».
7. **Dado** que subís la foto de un comprobante, **entonces** la ves.
8. **Dado** un pago imputado en parte, **entonces** el pie muestra el resto como
   pago a cuenta — hoy muestra $0.
9. **Dado** un comprobante anulado, **entonces** no suma a «Total comprado».
10. **Dadas** las 21 hs de Argentina, **entonces** el rango de la Estadística
    sigue siendo hoy.

## Verificación

**Implementada y verificada el 2026-09-07.** `pnpm typecheck` limpio y **2.529
unitarios en verde** (17 nuevos); los 7 `*.integration.test.ts` fallan sin stack
local (ruido conocido). Migración `0071` aplicada al cloud.

**Escenarios 1-4 — la edición**, 11 tests. El caso central se verificó **en vivo**
con Sofía (encargada) en `demo`: el comprobante de $482.100 tiene **un pago vivo
imputado**, el diálogo abrió con el importe y la fecha **deshabilitados** y el
aviso *«Este comprobante ya tiene pagos: el importe y la fecha no se tocan»*, se
cambió el concepto de «Verdulería» a «Almacén» y el toast dijo **«Comprobante
corregido.»**. En la base:

    total_cents 48210000 · invoice_date 2026-09-04 · concepto Almacén · pagos_vivos 1

La plata intacta, el rótulo corregido, con el pago vivo colgando. Es exactamente
lo que hoy era imposible sin anular el pago.

**Escenario 5 — el correlativo**, probado contra el cloud en una transacción que
revierte: dos pagos seguidos sacaron **nº 1 y nº 2**, correlativo confirmado.

**Escenario 8 — el pago mixto.** Test rojo primero: `expected +0 to be 4000000`,
que es literalmente el bug (el pie decía $0 donde el toast prometía $40.000).

**Escenario 10 — la timezone.** Cero `toISOString()` en la carpeta.

**Rastro en `demo`:** el concepto se devolvió a «Verdulería» después del verify.
