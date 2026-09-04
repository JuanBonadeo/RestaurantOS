# 156 · La Factura A y la B automática

**Issue:** [#233](https://github.com/gachetponzellini/RestaurantOS-app/issues/233) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto (2026-09-03)

**Input:** Juan, 2026-09-03, pegando el error que le salió al cobrar:

> *Esta orden ya tiene la Factura B 0001-00000004 autorizada. Anulala (se emite
> la nota de crédito) antes de emitir otro tipo de comprobante.*
>
> *"sale cuando quiero emitir una factura A a un cliente después de cobrar, creo
> que pasa pq se emite la factura B automáticamente. Entonces capaz deberíamos
> que diga la verdad: factura B emitida. Pero si quiere emitir A, la B tendría
> que cancelarla para luego emitir la A, no?"*

El diagnóstico es correcto. Es el hallazgo que quedó anotado al cerrar la
[spec 150](../150-factura-a-un-cliente/spec.md) y que ahora apareció en la cara
de alguien.

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

### La corrección al planteo

Son **dos casos distintos**, y sólo uno necesita anular nada:

| | Qué pasó | Qué corresponde |
|---|---|---|
| **A · Lo eligió antes** | Tildó «Factura A» y aun así salió la B | **La B no tenía que salir.** No hay nada que anular: el sistema tenía el dato y lo ignoró |
| **B · Lo pide después** | La B ya salió, y el cliente **después** pide la A | Sí: anular la B con su nota de crédito y emitir la A |

El caso A es un bug, no un flujo. Resolverlo con «anulá y volvé a emitir» le
cobra al operador una nota de crédito —un comprobante fiscal real, con número y
CAE— por un dato que había cargado bien desde el principio.

El caso B es legítimo y hoy es **prácticamente un callejón sin salida**: el
mensaje dice qué hacer, pero para hacerlo hay que salir del cobro, ir a
Facturación, encontrar el comprobante, abrirlo, tipear un motivo, anular… y
después no hay dónde emitir la A, porque la orden ya está cerrada y el sheet de
cobro no vuelve.

### Y el mesón no puede elegir antes

En el **cobro de mesa** (mozo y encargado) el problema es estructural, no de
orden: `FacturacionSection` se monta sólo con la orden **cerrada**
([cobrar-desktop-client.tsx](../../src/app/[business_slug]/admin/\(authed\)/mesa/[id]/cobrar/cobrar-desktop-client.tsx)),
que es exactamente cuando la B automática ya salió. Ahí el operador **nunca
tiene la chance** de pedir una A antes. Todas las mesas caen en el caso B.

## Las decisiones

**D1 · La emisión automática emite lo que el operador eligió, no siempre B.**
El arreglo del caso A. `registrarPago` recibe el comprobante elegido y se lo pasa
a `autoEmitInvoiceForOrder`, que se lo pasa al motor —`emitInvoiceCore` ya acepta
tipo, CUIT, razón social, condición y `fiscal_entity_id` desde la spec 150.

Es una sola emisión, no dos: no hay carrera que perder, no hay B que anular y se
conserva la propiedad que la 147 fue a buscar («toda mesa cobrada termina en
comprobante»). El `facturar()` posterior de la pantalla desaparece.

**D2 · Si la A elegida se rechaza, NO se cae a Factura B.** Es la tentación
obvia —«que al menos salga algo»— y está mal: emitir una B a consumidor final
cuando el operador pidió una A a un CUIT es declarar ante ARCA una operación que
no ocurrió, y encima se descubre tarde. Si la A se rechaza, la factura queda
`failed` con su aviso (spec 147 · D6) y se reintenta desde Facturación, que es lo
que ya pasa hoy con cualquier emisión rechazada.

**D3 · «Cambiar a Factura A» es una acción, no un instructivo.** El arreglo del
caso B. Un solo botón que hace las tres cosas en orden y las revierte si alguna
falla: emite la nota de crédito de la B, la marca anulada, y emite la A con los
datos del receptor. Vive donde el operador se entera del problema — el detalle
del comprobante en Facturación — y pide los mismos campos que el cobro (buscador
de entidades incluido, spec 150).

El motivo de la anulación no se le pregunta: lo sabemos. Es «se reemplaza por
Factura A a <CUIT>», y escribirlo nosotros es más fiel que un campo libre que
alguien va a llenar con «cambio».

**D4 · El mensaje dice qué pasó y ofrece la salida.** Hoy dice «anulala antes de
emitir otro tipo de comprobante», que es un instructivo para un viaje de cinco
pantallas. Con el D3 pasa a decir que la orden ya tiene la Factura B tal, y a
ofrecer el botón. El texto del guard en `emit-core` no cambia —es la última línea
de defensa del servidor y está bien como está—; lo que cambia es que la pantalla
lo intercepte en vez de mostrarlo crudo.

**D5 · No se toca cuándo dispara la auto-emisión.** La tentación es apagarla
mientras haya una A a medio cargar. No: `afip_auto_emit` existe porque en
golf-jcr hubo **11 mesas cobradas y 1 con intento de comprobante** (spec 147), y
cualquier condición que la apague reabre esa puerta. La 147 se cumple igual —
sigue saliendo un comprobante por cobro—, sólo que del tipo correcto.

## Alcance

- **`registrarPago` acepta el comprobante elegido** (`cobro-actions.ts`) y lo
  pasa a `autoEmitInvoiceForOrder` → `emitInvoiceCore`. Validación en el borde:
  el input viene del cliente.
- **`cobrar-pedido-sheet.tsx`** manda el `ComprobanteState` en el cobro y deja de
  llamar a `emitInvoice` por separado.
- **`cambiarTipoDeComprobante` (nuevo action)** — el D3: NC de la vigente + A
  nueva, con gate `canAnularFactura` (encargado/admin: ya es quien anula).
- **UI del cambio** en `invoice-detail-sheet.tsx`, reusando `ComprobanteFields`.
- **El mesón**: `FacturacionSection` en el cobro de mesa ofrece «cambiar a
  Factura A» cuando ya hay una B autorizada, en vez del formulario muerto que
  muestra hoy.
- **Tests**: que el tipo elegido llegue al motor; que una A rechazada **no**
  emita una B; que el cambio deje exactamente una NC + una A y la B `cancelled`.

## Qué NO entra

- **Apagar o condicionar la auto-emisión** (D5).
- **Elegir el comprobante antes de cobrar en la mesa.** Sería lo ideal para que
  el mesón también caiga en el caso A, pero toca el camino más caliente de la
  operación ([spec 111](../111-sidebar-operacion-rediseno/spec.md) · FR-015: sentar a
  alguien dejó de costar un formulario, y agregarle uno al cobro va en contra) y merece
  su propia discusión. Con el D3 el mesón queda resuelto, aunque con una NC de
  por medio.
- **Cambiar A → B.** El caso real es al revés: el cliente pide la A porque la
  necesita para descargar. Bajar de A a B no lo pidió nadie.
- **Reusar el número de la B anulada.** No se puede: cada comprobante consume su
  numeración en ARCA.

## Escenarios de aceptación

1. **Dado** el cobro de un pedido con **Factura A tildada y CUIT válido**,
   **cuando** se cobra, **entonces** sale **una** Factura A y **ninguna** B.
2. **Dado** ese mismo cobro, **entonces** el error «esta orden ya tiene la
   Factura B» **no aparece nunca**.
3. **Dado** un cobro sin tocar nada, **entonces** sale la Factura B automática
   exactamente como hoy (spec 147 intacta).
4. **Dado** un cobro con Factura A elegida cuyo CUIT ARCA rechaza, **entonces**
   la factura queda `failed` con su aviso y **no se emite una B** (D2).
5. **Dado** una orden con Factura B autorizada, **cuando** se usa «cambiar a
   Factura A», **entonces** queda: la B `cancelled`, su nota de crédito
   `authorized` y una Factura A `authorized` al CUIT indicado.
6. **Dado** ese cambio, **cuando** la nota de crédito falla, **entonces** la B
   **sigue autorizada** y no se emite ninguna A — no se rompe a mitad de camino.
7. **Dado** ese cambio, **cuando** la A falla después de anular la B,
   **entonces** se avisa con claridad que la B quedó anulada y que hay que
   reintentar la A: la NC ya tiene CAE y no se puede deshacer.
8. **Dado** un mozo, **entonces** no puede cambiar el tipo de comprobante
   (`canAnularFactura` ya lo deja afuera).
9. **Dado** el cobro de mesa con una B ya emitida, **entonces** la pantalla
   ofrece el cambio en vez del formulario de emisión que hoy no sirve.

## Verificación

Pendiente — spec propuesta, sin código.

El verify va en `demo`, que es el negocio que **tiene `afip_auto_emit` prendido**
y donde el bug se reproduce de una: cobrar un pedido con Factura A tildada. Con
el gateway en sandbox el CAE vuelve al instante y se ve la A completa. Con Sofía
(encargada), que es quien cobra y quien anula.

Ojo con el escenario 5: deja **tres** comprobantes en la orden (B anulada, NC, A)
y hay que mirar los tres, no sólo que la A tenga CAE.

## Preguntas abiertas

1. **¿El cambio a A debería poder hacerse desde el ticket ya impreso?** El
   cliente pide la A mirando el ticket que le dieron. Hoy el operador tiene que
   encontrar la orden en Facturación. Si el papel llevara el número de pedido
   —lo lleva— alcanzaría con buscarlo, pero conviene confirmarlo con el local.
2. **¿Cuánto tiempo después se puede pedir la A?** ARCA acepta notas de crédito
   sin límite práctico, pero un cambio sobre una factura de otro mes mueve la
   liquidación del período. Puede requerir un tope (ej. mismo mes fiscal).
