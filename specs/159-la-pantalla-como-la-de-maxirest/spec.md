# 159 · La pantalla como la de MaxiRest

**Issue:** [#238](https://github.com/gachetponzellini/RestaurantOS-app/issues/238) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-05)

**Input:** Juan, 2026-09-04, apenas quedó implementada la
[`158`](../158-comprar-y-pagarle-al-proveedor/spec.md): *"entonces la lógica, ya
estaría idéntica al maxirest, podríamos hacer que las interfaces sean lo más
parecidas posibles?"*

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) — el
circuito de compras, cuenta corriente y pago. Esta spec **no agrega datos**: los
de la 158 alcanzan.

---

## Por qué

La encargada de Golf viene de ocho años de MaxiRest. Lo que le ahorra re-aprender
no es el color de la pantalla: es **dónde está cada dato y cómo se llama**. La 158
trajo el circuito; esta trae la forma de leerlo.

### La distinción que ordena la spec

**Se copia la estructura de información y el vocabulario. No se copia el aspecto.**

El aspecto de MaxiRest es Visual FoxPro de 2013 —grillas grises con bordes 3D,
iconos, ventanas modales anidadas—. Reproducirlo choca de frente con el resto del
panel (Operación, Caja, Reservas ya tienen su identidad) y con el principio 2 del
producto: *pocas pantallas, pocos taps, letras grandes*. Una pantalla que parece
de otro programa no se lee como familiar: se lee como rota.

## Lo que ellos tienen y nosotros no

**1 · El master-detail.** Su «Manejo Integral de Proveedores» pone COMPRAS a la
izquierda —Fecha · Comprobante · Importe · **Saldo**— y, al seleccionar una fila,
**los pagos de esa compra** a la derecha —Fecha · Pago · Orden · Importe—. Es la
pantalla donde se responde *"esta factura, ¿con qué se pagó?"*.

Nosotros mostramos compras en una lista y pagos en otra, sin el vínculo a la
vista, aunque el dato **ya existe** en `supplier_payment_allocations`. La
imputación se calcula, se guarda… y no se muestra.

**2 · El saldo por comprobante.** Su grilla trae el importe *y* lo que queda
debiendo. La nuestra sólo el importe: un comprobante pagado a medias se ve igual
que uno intacto.

**3 · El período.** Su encabezado abre con *Período desde/hasta* + *Proveedor*.
La nuestra muestra todo desde el principio de los tiempos, que a 300 comprobantes
por mes deja de servir en el primer trimestre.

**4 · Los totales al pie.** Total del período, saldo, y **«Total pago a cuenta»**
separado — porque un pago a cuenta no cancela ningún comprobante y sumarlo con el
resto esconde por qué el saldo no cierra contra la lista.

**5 · La proyección de pagos.** Un **calendario del mes** con la plata a pagar
cada día, el detalle del día que se toca, y el total del mes. Es lo más útil de
todo su módulo y es lo único de esta spec que es funcionalidad y no acomodo:
nuestra lista de vencimientos está ordenada por atraso y responde *"¿a quién le
debo?"*, pero no responde **"¿cuánta plata necesito el jueves?"**, que es la
pregunta con la que se decide si se paga hoy o el lunes.

**6 · El vocabulario.** «Cta. Cte.», «orden de pago», «Total deuda / A cuenta /
Total a pagar». Son las palabras que ella ya tiene.

## Las decisiones

**D1 · El master-detail es una selección, no una navegación.** Tocar una compra
despliega sus pagos al lado (o debajo, en pantalla angosta) sin cambiar de página
ni abrir un modal. Si para ver con qué se pagó una factura hay que entrar y
volver, la pantalla perdió justo lo que la de ellos hace bien.

**D2 · Los pagos de cada compra viajan con la cuenta, no en un fetch por fila.**
`getCuentaDeProveedor` ya trae comprobantes, pagos e imputaciones para calcular el
saldo. Devolver también el cruce cuesta cero consultas nuevas; pedirlo al tocar
cada fila serían N round-trips para datos que ya estaban en memoria.

**D3 · El período filtra las compras, no el saldo.** El saldo del proveedor es
**siempre el total** —lo que se le debe no depende de qué ventana estés mirando—.
Filtrar el saldo por período daría un número que no es ninguna deuda real y que
además cambiaría al mover las fechas. MaxiRest tiene esta misma trampa y su
propio informe la esquiva mostrando el saldo del proveedor aparte del total del
período; se hace igual, y se rotula.

**D4 · El calendario muestra plata por día, y el día muestra a quién.** Cada
casilla lleva el total a pagar de ese día; tocarla lista los comprobantes que
vencen (proveedor, comprobante, importe). Un calendario que sólo pinta "hay algo"
obliga a tocar los 30 días para saber cuál duele.

**D5 · Lo vencido no desaparece del calendario: se acumula en el día de hoy.** Un
comprobante que venció el 28 y no se pagó **sigue siendo plata que hace falta**, y
en un calendario del mes que viene no estaría en ninguna casilla. Se suma a hoy,
marcado como atrasado. Si no, la proyección miente hacia abajo justo en los meses
en que uno se atrasó.

**D6 · Sin migración y sin tocar el server de la 158.** Esto es pantallas y
lecturas. Si aparece la tentación de cambiar una action, es señal de que el
alcance se fue.

## Alcance

**Lógica pura** (es lo que se testea primero) — en `cuenta-corriente.ts`:
- `pagosDeComprobante(invoiceId, imputaciones, pagos)` — el detalle del
  master-detail.
- `filtrarPorPeriodo(comprobantes, desde, hasta)`.
- `totalesDelPeriodo(comprobantes, imputaciones, pagos)` — total, saldo y pago a
  cuenta.
- `proyeccionPorDia(impagos, mes, hoy)` — el calendario, con la regla de D5.

**Lecturas:**
- `getCuentaDeProveedor` devuelve además las imputaciones cruzadas (D2).
- `getProyeccionPagos(businessId, mes)`.

**UI:**
- Ficha del proveedor: encabezado con **período**, grilla de compras con
  **saldo**, panel de **pagos de la compra seleccionada**, totales al pie.
- Tab nueva **«Proyección»** con el calendario del mes, el detalle del día y el
  total del mes.
- Vocabulario alineado en las pantallas de cuenta corriente y pago.

## Qué NO entra

- **El aspecto de FoxPro.**
- **Lista de Precios y Órdenes de Compra**, los otros dos botones de su barra:
  las dos tablas están **en 0** en el Golf (ya descartadas en la 158).
- **Migración**: los datos de la 158 alcanzan.
- **Tocar las actions de la 158** (D6).

## Escenarios de aceptación

1. **Dado** un comprobante pagado con dos pagos, **cuando** se lo selecciona en la
   ficha, **entonces** se ven **los dos pagos** con su fecha, medio e importe, sin
   cambiar de pantalla.
2. **Dado** un comprobante pagado a medias, **entonces** la grilla muestra su
   importe **y** su saldo — hoy se ve igual que uno intacto.
3. **Dado** un período elegido, **entonces** las compras listadas y los totales
   son los de ese período, **y el saldo del proveedor sigue siendo el total** (D3).
4. **Dado** un pago a cuenta, **entonces** figura en su propio total al pie y no
   se mezcla con lo imputado.
5. **Dado** un mes con vencimientos, **cuando** se abre «Proyección», **entonces**
   cada día con deuda muestra su importe y el mes muestra su total.
6. **Dado** un día del calendario, **cuando** se lo toca, **entonces** se listan
   los comprobantes que vencen ese día con su proveedor.
7. **Dado** un comprobante vencido y sin pagar, **entonces** aparece sumado al día
   de hoy y marcado como atrasado (D5) — no desaparece del calendario.
8. **Dado** un teléfono, **entonces** el master-detail sigue siendo usable: los
   pagos van debajo de la compra seleccionada, no en una columna de 200 px.

## Verificación

**Implementada y verificada el 2026-09-05.** En vivo en `demo` con el rol real
(Sofía, encargada). `pnpm typecheck` limpio y **2.347 unitarios en verde**; los
`*.integration.test.ts` fallan con `ECONNREFUSED 127.0.0.1:54321` —el stack
Supabase local— y **0 tests fallidos** en la corrida: el conteo de archivos
afectados varía entre corridas porque fallan en el `beforeAll`.

**Escenarios 1 y 2 — el master-detail y el saldo por fila.** Se pagó $ 200.000
imputados al comprobante de $ 482.100. La grilla pasó a mostrar las dos columnas
distintas —`Importe $ 482.100 · Saldo $ 282.100`—, que es lo que antes no se
podía ver. Al seleccionar la fila, el panel derecho:

    Pagos de Sin comprobante
    Transferencia · 2026-09-05 · $ 200.000

Y sólo ese: el pago a cuenta de $ 100.000 **no** aparece ahí, porque no está
imputado a ese comprobante. Sin seleccionar nada dice «Tocá una compra para ver
con qué se pagó»; con una compra impaga, «Sin pagos imputados · Debe $ 482.100».

**Escenario 3 — el período no toca el saldo (D3).** Con el período movido a
agosto, la grilla quedó en «Sin compras en el período» y el pie siguió diciendo
**«Saldo del proveedor (todo el historial): $ 182.100»**. Es la trampa que la
decisión venía a evitar.

**Escenario 4 — el pago a cuenta, aparte.** El pie muestra «Totales del período
$ 482.100 / $ 282.100» y en su propia fila **«Total pago a cuenta $ 100.000»**,
sin mezclarse con lo imputado.

**Escenarios 5 y 6 — el calendario.** Septiembre 2026 con «Total a pagar del mes
$ 282.100» y el importe en la casilla del 11. Al tocarla: «Vence el 2026-09-11 ·
Verdulería del Sur · Sin comprobante · $ 282.100».

**Escenario 7 — lo vencido se acumula en hoy (D5).** Se cargó una compra de
$ 75.000 con fecha 20/08; el vencimiento se recalculó solo a **27/08** (los 7 días
del proveedor) y quedó vencido. En el calendario aparece **en el día 5 —hoy—, en
rojo**, el total del mes subió a $ 357.100, y el detalle del día dice:

    Vence el 2026-09-05   [incluye atrasado]
    Verdulería del Sur · Sin comprobante · vencía 2026-08-27 · $ 75.000

En un calendario por fecha de vencimiento pura, esos $ 75.000 no habrían caído en
ninguna casilla de septiembre.

**Escenario 8 — en el teléfono.** Con viewport de teléfono, las dos columnas se
**apilan** (medido: mismos anchos, distinto `top`), la tabla entra en el ancho y
**el body no scrollea horizontalmente**. El detalle queda debajo de la compra
elegida, no en una columna de 200 px.

**Un descuido corregido en el camino.** Al reemplazar el bloque viejo por el panel
se fue con él el botón **«Cargar compra»** y la **foto del comprobante**. El botón
volvió al encabezado, junto a Pagar y Editar; la foto encontró un lugar mejor que
el que tenía —el panel de detalle, que es la pantalla donde se mira *un*
comprobante— y aparece bajo sus pagos cuando la compra seleccionada tiene una.

**Rastro en `demo`:** las dos compras y los tres pagos de «Verdulería del Sur» son
de este verify y del de la spec 158.

**Queda pendiente:** mostrarle la pantalla a la encargada de Golf y confirmar que
reconoce dónde está cada cosa. Se decidió (2026-09-04) avanzar sin esperarla, con
el backup y las capturas de la ayuda embebida como fuente — el riesgo asumido es
acertarle al programa y no a cómo ella lo usa.
