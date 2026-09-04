# 157 · Un solo cobro para las tres pantallas

**Issue:** [#234](https://github.com/gachetponzellini/RestaurantOS-app/issues/234) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesta (2026-09-03) — sin implementar

**Input:** Juan, 2026-09-03, mirando el cobro después de meter cuentas
corrientes: *"habría que unificar el cobro en venta rápida y en las mesas y en
pedidos también, veo que la parte de la facturación no aparece igual que en las
mesas"*.

**Depende de**: [`062`](../062-motor-de-cobro-unificado/spec.md) (el motor de
cobro, que ya es uno solo del lado del server),
[`053`](../053-condicion-iva-receptor/spec.md) (`ComprobanteFields`),
[`086`](../086-facturar-desde-el-cobro-del-encargado/spec.md)
(`FacturacionSection`), [`141`](../141-cuentas-corrientes/spec.md) (el fiado, que
al cablearse dejó la divergencia a la vista),
[`058`](../058-venta-rapida-mostrador/spec.md) y
[`123`](../123-venta-rapida-con-el-panel/spec.md) (la venta rápida y su
ergonomía, que no se toca).

---

## Por qué

**El server ya cobra igual en los tres lados.** La spec 062 unificó el motor:
todo pasa por `registrarPago` → `registrar_pago_tx`, con su lock, su guarda
anti-duplicado y su idempotencia. Lo que no se unificó nunca es **la pantalla**.

| | Elegir método | Elegir comprobante | Emitir después | Fiar |
|---|---|---|---|---|
| **Mesa** ([`cobrar-desktop-client`](../../src/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.tsx), 820 líneas) | `CobroForm` | `ComprobanteFields` | `FacturacionSection` | ✅ |
| **Pedido** ([`cobrar-pedido-sheet`](../../src/components/admin/cobrar-pedido-sheet.tsx), 205) | `CobroForm` | `ComprobanteFields` | ❌ | ✅ |
| **Venta rápida** ([`venta-rapida-panel`](../../src/components/admin/local/venta-rapida-panel.tsx), 676) | **propia** | ❌ | botón suelto | ✅ *(cableado a mano)* |

### El agujero que esto destapa

**En la venta rápida no se puede emitir una Factura A.** `emitInvoice` sale con
`tipoComprobante: "factura_b"` **hardcodeado**
([`venta-rapida-panel.tsx:351`](../../src/components/admin/local/venta-rapida-panel.tsx))
y la pantalla no monta `ComprobanteFields`, así que **no hay dónde cargar el CUIT
ni la condición de IVA**.

Y el mostrador es justo donde más se factura a empresas: el **evento
empresarial** y la **facturación mensual al sanatorio** son los dos casos que la
encargada describió, y los dos son a CUIT. Con los **378 receptores fiscales**
recién importados (spec 152), esto pasa de incómodo a bloqueante — se importó una
cartera para facturarle, desde una pantalla que sólo emite B.

### La prueba de que la divergencia cuesta

Cablear el fiado de la spec 141 costó **dos veces**: una en `CobroForm`, que
sirvió para mesa y pedido a la vez, y otra a mano en la venta rápida, con su
propio estado, su propio guard y su propio `credit_customer_id` en el submit. Lo
mismo va a pasar con el siguiente método de pago, y con el que venga después.

## Por qué divergieron (y qué NO hay que romper)

La venta rápida nació con un objetivo explícito (spec 058): *«tipear, Enter,
Enter, cobrar»*. Para eso armó su camino corto — grilla de métodos propia,
selector de caja propio, y la factura como **botón opcional después de cobrar**,
para no frenar la venta siguiente.

**Esa intención es correcta y se conserva.** Lo que no se conserva es que para
lograrla haya hecho falta *otro código*. La unificación tiene que dejar el
mostrador igual de rápido, o no sirve.

## Las decisiones

**D1 · Las tres montan `CobroForm`.** Es el componente que ya sabe de métodos,
ajuste por método, caja, propina, split, MP y —desde la 141— fiado. La venta
rápida pierde su grilla propia y gana todo lo que hoy no tiene.

**D2 · La ergonomía del mostrador entra en `CobroForm`, no al lado.** El camino
de teclado de la spec 075 y el «no me frenes la venta siguiente» pasan a ser un
**modo** del formulario (`size: "compact"` ya existe; hace falta algo como
`flujo: "rapido"`), no una reimplementación. Si al terminar la venta rápida quedó
más lenta, la spec falló aunque el código haya quedado más lindo.

**D3 · `ComprobanteFields` en las tres.** Es lo que destraba la Factura A en el
mostrador. El `factura_b` hardcodeado se va.

**D4 · `FacturacionSection` donde tiene sentido, no en las tres por simetría.**
La mesa la tiene porque el cliente pide la factura *después* de que le cobraste;
el mostrador tiene su botón «facturar la última venta» por la misma razón y
funciona. Unificar el **componente** sí; unificar el **momento** no — el pedido
sin mesa se factura al cobrar y no necesita el bloque post-cobro.

**D5 · Sin cambios de server.** `registrarPago`, `venderMostrador` y
`emitInvoice` quedan como están: esto es una spec de pantallas. Si aparece la
tentación de tocar el motor, es señal de que el alcance se fue.

## Alcance

- **`cobro-form.tsx`** — el modo rápido de D2.
- **`venta-rapida-panel.tsx`** — se va la grilla `METODOS`, el selector de caja y
  el `factura_b` hardcodeado; entran `CobroForm` + `ComprobanteFields`. Es el
  archivo que más cambia y el único con riesgo real de regresión.
- **`cobrar-pedido-sheet.tsx`** — sólo alinear el orden y los textos.
- **`cobrar-desktop-client.tsx`** — es la referencia; se toca lo mínimo.
- **Sin migración, sin cambios de dominio.**

## Qué NO entra

- **Tocar el motor de cobro** (D5).
- **Unificar el momento de facturar** (D4).
- **El cobro del mozo** (`mozo/mesa/[id]/cobrar`): es otra ergonomía —teléfono, a
  una mano, en el salón— y no comparte pantalla con estas tres. Ya usa
  `CobroForm`, que es lo que importa.

## Escenarios de aceptación

1. **Dado** el mostrador, **cuando** se cobra, **entonces** se puede elegir
   **Factura A** y cargar CUIT y condición de IVA — hoy es imposible.
2. **Dado** el mostrador, **cuando** se cobra con el teclado, **entonces** el
   recorrido «tipear, Enter, Enter, cobrar» sigue siendo el mismo número de
   teclas que antes de esta spec.
3. **Dado** cualquiera de las tres pantallas, **entonces** los métodos, el ajuste
   por método y el fiado se ven y se comportan igual.
4. **Dado** que se agrega un método de pago nuevo, **entonces** aparece en las
   tres sin tocar tres archivos. Es el test de que la unificación sirvió.
5. **Dado** el mostrador, **cuando** termina una venta, **entonces** la siguiente
   arranca sin esperar la factura, como hoy.

## Verificación

Pendiente — sin implementar.

El riesgo está concentrado en la venta rápida, que es la que se reescribe: el
verify en vivo tiene que ser **cronometrado**, no sólo funcional — contar las
teclas de una venta de mostrador antes y después. Y el escenario 1 se prueba
emitiendo una A real contra el sandbox, con uno de los 378 receptores importados:

    node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion"
