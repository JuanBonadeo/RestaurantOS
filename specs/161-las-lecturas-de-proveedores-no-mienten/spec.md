# 161 · Las lecturas de proveedores no mienten

**Issue:** [#242](https://github.com/gachetponzellini/RestaurantOS-app/issues/242) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-07)

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) (el
circuito), [`159`](../159-la-pantalla-como-la-de-maxirest/spec.md) (las
pantallas que leen), [`160`](../160-la-caja-administrativa/spec.md) (la caja de
donde sale el pago).

---

## Por qué

Las tres pantallas de la 159 muestran plata que puede estar mal **sin que nada
lo diga**, y una guarda de la 158 deja pasar lo que vino a impedir. Los cuatro
problemas comparten archivo y causa: **el `error` de PostgREST se descarta**.

**1 · `postgrest-js` no tira: devuelve `{data: null, error}`.** Y el módulo hace
`(res.data ?? [])`, que convierte un fallo de red en «no hay filas». Los tres
modos, probados:

| Falla | Qué muestra la pantalla |
|---|---|
| `supplier_payments` | el proveedor debe **todo** — los pagos no existen |
| `supplier_invoices` | «No hay comprobantes impagos» y «No hay nada que pagar este mes» |
| `supplier_payment_allocations` | el encabezado dice **$0** y la lista dice que debe |

No hay ningún `error.tsx` que lo atrape. Un `catch` no alcanza: **no se lanza
nada**.

**2 · PostgREST corta en 1.000 filas.** `products` tiene **1.326** en este mismo
cloud y devuelve 1.000 con `content-range: 0-999/1326`. `getVencimientos` y
`getProyeccionPagos` traen comprobantes, pagos e imputaciones **del negocio
entero**, sin `.range()` ni filtro de fecha. Al ritmo del Golf (3.677
comprobantes y 5.761 pagos en 2025), `supplier_payments` cruza las 1.000 en
**~2 meses** y `supplier_invoices` en **~3**. No falla: **devuelve un número más
chico**, que es peor.

Misma causa raíz que el `.in()` de la ficha, que revienta a ~650 comprobantes
por proveedor (600 UUIDs pasan, 680 dan `Bad Request`).

**3 · La guarda de anulación falla ABIERTA.**
`cuenta-corriente-actions.ts:161` no destructura `error`: si la lectura de
imputaciones falla, `conPagoVivo = false` y **el comprobante pago se anula
igual**. No hay red abajo — el FK `ON DELETE RESTRICT` protege el borrado, no la
anulación lógica.

El peor de los otros ocho `.select()` del archivo es el de `allocs` en
`registrarPagoProveedor` (línea 267): si falla, `repartirPago` imputa contra
facturas **ya pagadas**.

**4 · Las tres escrituras del pago no son atómicas.** Sangría → pago →
imputaciones, y sólo la segunda revierte. Si falla la tercera:
`console.error` y **devuelve OK**. La caja quedó con la plata de menos, el saldo
bajó, el comprobante sigue impago en tres pantallas, y el toast dice «Pago
registrado.».

## Las decisiones

**D1 · `unwrap()`: el error deja de ser opcional porque no se puede escribir el
código sin mirarlo.**

```ts
unwrap(await service.from("supplier_payments").select(...))
```

Toma el `{data, error}` entero y devuelve `data`, o lanza. Lo que lo hace
funcionar no es que sea corto: es que **no hay forma de llamarlo sin pasarle el
`error`**, porque recibe el resultado completo. Un helper que recibiera sólo
`data` reproduciría el bug.

Y lanzar es lo correcto acá: en un Server Component, la excepción la toma Next y
muestra el error. **Ver que se rompió es infinitamente mejor que ver $0.** El
modo de falla que esta spec ataca es precisamente el silencioso.

**D2 · La paginación va en el helper, no en cada llamada.**

`fetchAll()` pagina con `.range()` hasta traer todo. Necesita `.order()` estable
o PostgREST puede repetir o saltear filas entre páginas — se ordena por `id`,
que es el único campo garantizado único.

Y la lista de IDs del `.in()` se parte en lotes de 300 (medido: 600 pasan, 680
no; 300 deja margen para UUIDs más largos en la URL).

**No se cambia a agregar en SQL.** Sería más eficiente, pero el saldo lo calcula
hoy una **función pura testeada** (`cuenta-corriente.ts`, 33 tests) y moverlo a
la base cambia el diseño de la 158 sin que nadie lo haya pedido. Esta spec
arregla la lectura, no rediseña el cálculo. Cuando el volumen lo exija, el lugar
donde se arregla es uno solo, que es justamente lo que el comentario de
`getSaldosDeProveedores` ya anticipa.

**D3 · La guarda de anulación falla CERRADA.**

Si no se puede saber si hay pagos vivos, no se anula. Es una decisión de riesgo,
no de estilo: anular de más ensucia el informe y descuadra el saldo; anular de
menos le pide al encargado que reintente.

**D4 · El pago va a una RPC transaccional, no a un `try/catch` más prolijo.**

Las tres escrituras son de plata y tienen que ser una. El repo ya tiene el
patrón exacto —`registrar_pago_tx` de la 0007, hecha para el mismo modo de falla
en el cobro— y este caso es peor, porque acá la primera escritura mueve efectivo
de una caja.

Con la RPC, el rollback lo hace Postgres: desaparece la reversión manual de la
sangría, desaparece el `console.error` que devolvía OK, y el `imputaciones`
huérfano deja de ser posible.

**Idempotencia**: no entra. La 0007 la necesitaba porque el cobro se dispara
desde un botón en hora pico y el doble-submit estaba **medido**. Acá el pago se
carga desde el panel, de a uno, y no hay ningún caso reportado. Meterla sin
evidencia es agregar una columna y un índice que nadie va a usar.

## Alcance

**Datos** — migración `0069`: RPC `registrar_pago_proveedor_tx` (sangría + pago
+ imputaciones en una transacción).

**Server:**
- `unwrap()` y `fetchAll()` nuevos, y los ~20 call sites de
  `cuenta-corriente-queries.ts` y `queries.ts`.
- `getVencimientos`, `getProyeccionPagos`, `getSaldosDeProveedores` y
  `getCuentaDeProveedor` pasan por `fetchAll`.
- El `.in()` de `getSuppliers` y el de la ficha, por lotes.
- La guarda de `anularComprobante` y los otros 8 `.select()` del archivo.
- `registrarPagoProveedor` llama a la RPC.

**Tests:** `unwrap`/`fetchAll` con un cliente falso (el fallo de red se simula,
no se espera); la guarda cerrada; la RPC probada contra el cloud en una
transacción que revierte.

## Qué NO entra

- **Agregar en SQL** (D2).
- **Idempotencia del pago** (D4).
- **Un `error.tsx`** para el área de admin. Ayudaría, pero es de otro alcance y
  no arregla el silencio: con `?? []` no hay error que mostrar.
- **El resto de los módulos.** El mismo `?? []` está en medio repo; esta spec
  arregla proveedores, que es donde la 158 puso plata nueva. Si el patrón sirve,
  se propaga después.
- **Los menores de [#246](https://github.com/gachetponzellini/RestaurantOS-app/issues/246)**
  (el `toISOString()`, «Total comprado» con anulados, el pago mixto en el pie),
  aunque vivan en estos archivos.

## Escenarios de aceptación

1. **Dado** que falla la lectura de `supplier_payments`, **entonces** la pantalla
   **rompe visiblemente** — no dice que el proveedor debe todo.
2. **Ídem** para `supplier_invoices` y `supplier_payment_allocations`.
3. **Dado** un negocio con más de 1.000 pagos, **entonces** el saldo los cuenta
   todos.
4. **Dado** un proveedor con más de 650 comprobantes, **entonces** la ficha
   abre — hoy da `Bad Request`.
5. **Dado** que falla la lectura de imputaciones al anular un comprobante,
   **entonces** la anulación se rechaza.
6. **Dado** un comprobante con un pago vivo, **entonces** sigue sin poder
   anularse (no se rompe lo que ya andaba).
7. **Dado** que falla el insert de imputaciones, **entonces** el pago **y** la
   sangría se revierten, y el usuario ve un error — hoy ve «Pago registrado.».
8. **Dado** un pago normal en efectivo, **entonces** sigue funcionando igual:
   sangría en la Caja Mayor, pago, imputaciones, y el toast con lo que quedó a
   cuenta.

## Verificación

**Implementada y verificada el 2026-09-07.** `pnpm typecheck` limpio y **2.523
unitarios en verde** (19 nuevos); los 7 `*.integration.test.ts` fallan sin stack
local (ruido conocido). Migración `0069` aplicada al cloud.

**Escenarios 1-3 — el silencio.** `unwrap` recibe el resultado **entero** de
postgrest-js, así que no se puede llamar sin pasarle el `error`: el bug no se
puede reescribir por descuido. 13 tests con un cliente falso, incluido el caso
exacto (`{data: null, error}` → lanza en vez de devolver `[]`) y el truncado
(2.350 filas se traen en 3 páginas, la primera de las cuales PostgREST habría
cortado en 1.000).

**Escenario 5 y 6 — la guarda cerrada.** 6 tests: con la lectura de imputaciones
caída, `anularComprobante` **rechaza** («No pudimos verificar si el comprobante
tiene pagos»). Antes devolvía `ok: true` y dejaba el comprobante anulado con un
pago vivo colgando. Los casos que ya andaban siguen andando: sin imputaciones
anula, con pago vivo no, con el pago ya anulado sí.

**Escenario 7 — la atomicidad, probada contra el cloud.** Bloque `do $$` en una
transacción que revierte:

    1 · efectivo+imputación : pago=true sangría=true imputaciones=1
                              kind=sangria monto_caja=1000000
    2 · sobre-imputación    : rechazada (COMPROBANTE_SOBRE_IMPUTADO)
        ATOMICIDAD → sangrías nuevas=0  pagos nuevos=0
    3 · transferencia       : pago=true sangría=NULL  caja_id=NULL

La línea que importa es la de ATOMICIDAD: cuando la imputación falla, **no queda
ni la sangría ni el pago**. Ése era el modo de falla — la caja con la plata de
menos y el toast diciendo «Pago registrado.».

**Escenario 8 — el camino feliz, en vivo.** Con Sofía (encargada) en `demo`, un
pago de $75.000 en efectivo imputado a un comprobante, desde la pantalla:

    pago      $75.000 · cash · caja "Caja Mayor" (is_administrative = true)
    sangría   kind=sangria · $75.000 · "Pago a proveedor · Verdulería del Sur"
    imputado  1 imputación · $75.000

El saldo pasó de **$257.100 a $182.100** e impagos de 2 a 1, que es exactamente
557.100 − 375.000. El invariante de la 160 sobrevive a la mudanza: la caja sigue
siendo la administrativa, y la resuelve el server.

**Un test que cambió de forma sin aflojarse.** `pago-caja-administrativa.test.ts`
(spec 160) mockeaba los tres inserts; con la RPC, lo que antes se leía en
`inserts["caja_movimientos"][0].caja_id` ahora se lee en el `p_caja_id` de la
llamada. El invariante que fija es el mismo, y el test de «mandar una caja de
turno no la usa» sigue cazando el mismo reintroducido.

**Lo que apareció y NO se tocó:** «Deuda total» en Vencimientos ($357.100) y «Se
le debe» en la ficha ($257.100) difieren en los **$100.000 de un pago a cuenta**
— Vencimientos suma saldos de comprobantes impagos y la ficha resta todos los
pagos vivos. Son dos definiciones distintas del mismo número, preexistente a
esta spec y de la familia de
[#246](https://github.com/gachetponzellini/RestaurantOS-app/issues/246).

**Rastro en `demo`:** el pago de $75.000 a «Verdulería del Sur» es de este
verify. Las pruebas de la RPC corrieron en transacciones que abortan.
