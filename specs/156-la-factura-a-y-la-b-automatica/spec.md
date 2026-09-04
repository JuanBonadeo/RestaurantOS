# 156 · Se elige el comprobante antes de cobrar

**Issue:** [#233](https://github.com/gachetponzellini/RestaurantOS-app/issues/233) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto (2026-09-03)

**Input:** Juan, 2026-09-03, pegando el error que le salió al cobrar:

> *Esta orden ya tiene la Factura B 0001-00000004 autorizada. Anulala (se emite
> la nota de crédito) antes de emitir otro tipo de comprobante.*
>
> *"sale cuando quiero emitir una factura A a un cliente después de cobrar, creo
> que pasa pq se emite la factura B automáticamente"* … *"capaz habría que
> cambiar el orden, y que la elección del tipo de factura le salga antes de
> cobrar. Tendría más sentido."*

Tiene más sentido, y además es lo que arregla el caso que hoy no tiene arreglo:
**el cobro de mesa**, donde el operador nunca llega a pedir una A a tiempo.

**Depende de**: [`147`](../147-cobrar-una-mesa-emite-el-comprobante/spec.md) (la
B automática), [`150`](../150-factura-a-un-cliente/spec.md) (la A a un receptor
guardado), [`100`](../100-anular-cobro/spec.md) (el guard cruzado que tira el
mensaje: antes filtraba por tipo y dejaba entrar una A sobre una B viva).

---

## Por qué

### Qué pasa hoy, en orden

En el cobro de un pedido (`cobrar-pedido-sheet.tsx`):

1. El operador **tilda «Factura A»** y carga el CUIT. La pantalla ya tiene el dato.
2. Aprieta cobrar → `registrarPago` ([cobro-actions.ts:301](../../src/lib/billing/cobro-actions.ts))
   cierra la orden y llama a `autoEmitInvoiceForOrder`, que emite **Factura B**:
   nadie le pasó el tipo elegido, así que usa `afip_default_tipo`.
3. Recién ahí el `onPaid` de la pantalla llama a `facturar()` con la A.
4. El guard de la spec 100 encuentra la B `authorized` y devuelve el mensaje.

La orden queda con una Factura B que el operador **no pidió**, y con un error que
lo manda a anular algo que no debería existir.

### El mesón está peor: ahí no se puede elegir

En el **cobro de mesa** (mozo y encargado) no es un problema de orden sino de
diseño: `FacturacionSection` se monta **sólo con la orden cerrada**
(`cobrar-desktop-client.tsx`, `mozo/…/cobrar-client.tsx`), que es exactamente
cuando la B automática ya salió. El operador de mesa **nunca tiene la chance** de
pedir una A antes — y las mesas son el volumen del local.

Y hoy, en un negocio con la auto-emisión **apagada** (golf-jcr), esa sección
después del cobro es la única forma de emitir: se cobra, y después alguien tiene
que acordarse de facturar. Es exactamente lo que la spec 147 fue a arreglar para
la B, y sigue pasando para la A.

### La conclusión

El dato —a quién y con qué letra se le factura— se sabe **antes** de cobrar, en
los tres puntos. Pedirlo después es lo que crea el problema: obliga a emitir a
ciegas primero y a corregir con una nota de crédito después. Una nota de crédito
es un comprobante fiscal real, con número y CAE: no es un undo.

## Las decisiones

**D1 · El comprobante se elige antes de cobrar, en los tres puntos que cobran.**
`ComprobanteFields` (con el buscador de receptores de la spec 150) sube al
formulario de cobro del **pedido**, de la **mesa del mozo** y de la **mesa del
encargado**. Lo elegido viaja en `registrarPago` y es lo que se emite al cerrar
la orden: **una sola emisión, del tipo correcto**.

Los tres ya controlan su propio `onSubmit` → `registrarPago`, así que
`CobroForm` no se toca: cada pantalla monta el campo y manda el estado.

**D2 · Por defecto no se elige nada, y no cambia nada.** El control arranca
colapsado en «Factura B (consumidor final)», que es el 95 % de los cobros: **cero
taps de más** en el camino caliente. La spec 111 sacó el formulario de encima de
sentar a alguien (FR-015) y ese criterio vale igual acá — si esto costara un paso
en cada mesa, estaría mal aunque arregle la A.

Sin elección explícita, todo sigue como hoy: la auto-emisión de la 147 si el
negocio la tiene prendida, y la sección de después si no.

**D3 · Una elección explícita emite aunque `afip_auto_emit` esté apagado.** Sin
esto, mover la elección hacia arriba no le sirve a **golf-jcr**, que tiene el
flag en `false` — que es el único negocio real que hoy factura A.

No contradice el D3 de la spec 147 («apagado por defecto: un negocio que factura
a mano no se despierta emitiendo por un deploy»). Lo que ese flag protege es la
emisión **que nadie pidió**. Acá alguien la pidió, en la misma pantalla, tocando
un control: emitirla es obedecer, no despertarse solo.

**D4 · Si la A elegida se rechaza, NO se cae a Factura B.** Es la tentación
obvia —«que al menos salga algo»— y está mal: emitir una B a consumidor final
cuando el operador pidió una A a un CUIT es declarar ante ARCA una operación que
no ocurrió, y encima se descubre tarde. La factura queda `failed` con su aviso
(spec 147 · D6) y se reintenta desde Facturación, como cualquier rechazo.

**D5 · «Cambiar a Factura A» sigue haciendo falta, pero deja de ser el arreglo.**
Con el D1, el caso «lo eligió y salió otra cosa» desaparece. Queda el caso real y
distinto: **el cliente pide la A después**, mirando el ticket que ya se le dio.
Ahí sí corresponde anular con nota de crédito y emitir la A, y hoy es
prácticamente un callejón sin salida —el mensaje dice qué hacer, pero después no
hay dónde emitir la A porque la orden ya cerró.

Un botón que hace las tres cosas en orden: emite la NC de la B, la marca anulada,
emite la A. El motivo no se pregunta: es «se reemplaza por Factura A a <CUIT>», y
escribirlo nosotros es más fiel que un campo libre que alguien llena con «cambio».

**D6 · No se toca cuándo dispara la auto-emisión.** La tentación es apagarla
mientras haya una A a medio cargar. No: existe porque en golf-jcr hubo **11 mesas
cobradas y 1 con intento de comprobante** (spec 147), y cualquier condición que
la apague reabre esa puerta. Sigue saliendo un comprobante por cobro; lo único
que cambia es que sea del tipo que se pidió.

**D7 · En un pago parcial la elección espera.** El comprobante se emite cuando la
orden queda saldada, no en cada pago. Pasar el dato en un pago parcial no hace
nada —`autoEmitInvoiceForOrder` corre después de cerrar la orden— y el pago que
la cierra es el que lo aplica. Si la mesa se cobra en dos sesiones distintas y la
segunda no eligió, cae al comportamiento de siempre.

## Alcance

- **`registrarPago` acepta el comprobante elegido** (`cobro-actions.ts`) y lo
  pasa a `autoEmitInvoiceForOrder` → `emitInvoiceCore`, que desde la spec 150 ya
  toma tipo, CUIT, razón social, condición y `fiscal_entity_id`. Validación Zod
  en el borde: el input viene del cliente.
- **`autoEmitInvoiceForOrder`** emite el tipo elegido y, con elección explícita,
  no mira `afip_auto_emit` (D3).
- **Las tres pantallas de cobro** montan `ComprobanteFields` y mandan el estado:
  `cobrar-pedido-sheet.tsx` (que deja de llamar a `emitInvoice` aparte),
  `mozo/…/cobrar-client.tsx` y `admin/…/cobrar-desktop-client.tsx`.
- **`FacturacionSection` después del cobro se queda**, con menos trabajo: emitir
  cuando no se eligió nada y el flag está apagado, reintentar una fallida, y ser
  la puerta del «cambiar a Factura A» (D5).
- **`cambiarTipoDeComprobante` (nuevo action)** — el D5: NC de la vigente + A
  nueva, con gate `canAnularFactura` (encargado/admin, el mismo que ya anula).
- **Tests**: que el tipo elegido llegue al motor; que una A rechazada **no**
  emita una B (D4); que sin elección todo siga igual (147 intacta); que el
  cambio deje exactamente una NC + una A y la B `cancelled`.

## Qué NO entra

- **Apagar o condicionar la auto-emisión** (D6).
- **Cambiar A → B.** El caso real es al revés: el cliente pide la A porque la
  necesita para descargar. Bajar de A a B no lo pidió nadie.
- **Reusar el número de la B anulada.** No se puede: cada comprobante consume su
  numeración en ARCA.
- **Elegir el comprobante al abrir la mesa** (y no al cobrarla). Suena tentador
  —«el cliente avisa cuando se sienta»— pero mueve el dato fiscal a un momento
  donde todavía no se sabe quién paga ni cuánto, y ensucia el camino de sentar
  que la 111 acaba de limpiar.

## Escenarios de aceptación

1. **Dado** el cobro de un pedido con **Factura A elegida y CUIT válido**,
   **cuando** se cobra, **entonces** sale **una** Factura A y **ninguna** B.
2. **Dado** el cobro de una **mesa** (mozo o encargado) con Factura A elegida,
   **entonces** pasa lo mismo: una A, ninguna B, y sin pantalla intermedia.
3. **Dado** cualquiera de esos cobros, **entonces** el error «esta orden ya tiene
   la Factura B» **no aparece nunca**.
4. **Dado** un cobro **sin tocar el control**, **entonces** sale la Factura B
   automática exactamente como hoy (spec 147 intacta).
5. **Dado** un negocio con `afip_auto_emit` **apagado** y una Factura A elegida
   en el cobro, **entonces** la A se emite igual (D3).
6. **Dado** ese mismo negocio **sin elegir nada**, **entonces** NO se emite nada
   automáticamente y la sección de después sigue siendo la puerta (D3 no se
   desborda).
7. **Dado** un cobro con Factura A elegida cuyo CUIT ARCA rechaza, **entonces**
   la factura queda `failed` con su aviso y **no se emite una B** (D4).
8. **Dado** un **pago parcial** con Factura A elegida, **entonces** no se emite
   nada; el pago que salda la orden es el que emite la A (D7).
9. **Dado** una orden con Factura B autorizada, **cuando** se usa «cambiar a
   Factura A», **entonces** queda: la B `cancelled`, su nota de crédito
   `authorized` y una Factura A `authorized` al CUIT indicado.
10. **Dado** ese cambio, **cuando** la nota de crédito falla, **entonces** la B
    **sigue autorizada** y no se emite ninguna A — no se rompe a mitad de camino.
11. **Dado** ese cambio, **cuando** la A falla después de anular la B,
    **entonces** se avisa que la B quedó anulada y que hay que reintentar la A:
    la NC ya tiene CAE y no se puede deshacer.
12. **Dado** un mozo, **entonces** puede elegir Factura A al cobrar su mesa
    (es parte de cobrar) pero **no** puede cambiar el tipo de un comprobante ya
    emitido (`canAnularFactura` lo deja afuera).

## Verificación

Pendiente — spec propuesta, sin código.

El verify va en `demo`, que es el negocio con `afip_auto_emit` **prendido** y
donde el bug se reproduce de una. Con el gateway en sandbox el CAE vuelve al
instante y se ve la A completa. Con **Sofía (encargada)** para el cobro de mesa y
el cambio de tipo, y con **Pedro (mozo)** para el escenario 12 — el mozo elige,
pero no cambia.

El escenario 5 (flag apagado + elección explícita) es el que **no** se puede
probar en `demo` sin tocarle la config: se prueba con un negocio de prueba
propio, o se deja anotado como verificado sólo por test.

Ojo con el escenario 9: deja **tres** comprobantes en la orden (B anulada, NC, A)
y hay que mirar los tres, no sólo que la A tenga CAE.

## Preguntas abiertas

1. **¿El control va colapsado o visible?** El D2 dice colapsado por defecto.
   Para el mozo en el teléfono eso es un tap extra cuando **sí** hay que hacer
   una A. Conviene mirarlo con alguien del local: si el A/B es frecuente en una
   barra o un salón puntual, quizás convenga visible ahí.
2. **¿El cambio a A debería poder hacerse desde el ticket ya impreso?** El
   cliente pide la A mirando el papel que le dieron. Hoy hay que encontrar la
   orden en Facturación; el ticket lleva el número de pedido, así que alcanzaría
   con buscarlo — pero conviene confirmarlo con el local.
3. **¿Cuánto tiempo después se puede pedir la A?** ARCA acepta notas de crédito
   sin límite práctico, pero un cambio sobre una factura de otro mes mueve la
   liquidación del período. Puede querer un tope (ej. mismo mes fiscal).
