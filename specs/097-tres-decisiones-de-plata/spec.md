# Feature Specification: Tres decisiones de plata

**Feature Branch**: `097-tres-decisiones-de-plata`

**Created**: 2026-08-05

**Status**: ✅ Implementada · migración aplicada al cloud

**Issues**: #146 (H-09) · #144 (H-35) · #141 (H-16)

**Input**: Juan, 2026-08-05, respondiendo las tres preguntas que la auditoría había dejado abiertas a propósito porque eran decisiones de negocio, no de código.

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-09, H-35, H-16.

## Las tres decisiones

| | Pregunta | Decisión de Juan |
|---|---|---|
| **H-09** | ¿La propina en efectivo entra al cajón o va al bolsillo del mozo? | *"No tomemos la propina como parte del sistema"* → **la propina no es plata del negocio.** |
| **H-35** | ¿Se puede anular un cobro que ya entró en un arqueo firmado? | *"Si la caja ya fue cerrada, que no se pueda anular."* |
| **H-16** | ¿Corregir una línea tiene que ajustar el inventario? | *"Habría que ajustar eso."* |

---

## H-09 · La propina sale de la plata del negocio

### El problema

`payments.tip_cents` tenía **tres significados** según por qué pantalla se cobrara, y **tres lecturas** distintas río abajo. Consecuencias medibles: la propina del mozo dependía de quién apretaba el botón, y un delivery con propina en efectivo dejaba sobrante en el arqueo todos los días.

### La convención

> **`amount_cents`** = la plata que entró por ese pago, **propina incluida**.
> **`tip_cents`** = cuánto de ese amount es propina.
> **La venta del negocio es `amount − tip`.**

No es una convención nueva: es la que `liquidacion-mozo.ts:34` (`neto = amount − tip`) y `totals.ts:18` (`total = subtotal − discount + tip`) **ya asumían**. Lo que faltaba era que la respetaran los tres que escriben y los dos que leen mal.

### Qué cambió

| Dónde | Antes | Ahora |
|---|---|---|
| `expected-cash.ts` | esperaba `amount` entero en el cajón | resta el tip: el arqueo deja de cerrar con sobrante |
| `caja/queries.ts` | `total_ventas += amount` → la propina contaba como venta **y** se reportaba aparte | `total_ventas += amount − tip` |
| Cobro desktop del encargado | `tip: { mode: "editable" }`, arrancaba en **0** | `mode: "fixed"` desde `order.tip_cents`, igual que la pantalla del mozo |
| Cobro de pedido online | propina **por encima** del amount | `mode: "fixed"` desde la orden |

**Nota sobre tarjeta:** una propina cobrada con tarjeta sí entra a la cuenta del negocio, pero **no al cajón físico**. Por eso `expected-cash` sólo descuenta el tip de los pagos en efectivo; lo que el negocio le debe al mozo por propinas con tarjeta sale de `total_propinas_cents`, que ahora es un número limpio.

---

## H-35 · Un arqueo firmado no se reescribe

### El problema

`anularCobro` es el martillo más grande de la caja —refunda **todos** los pagos de una orden— y sólo pedía rol y motivo. Anular **una línea suelta**, en cambio, sí pasaba por `evaluarGuardasDeAnulacion`, que respeta el último corte y las rendiciones. **La asimetría era al revés de lo razonable: el camino con menos control era el que más plata movía.**

Y el remate: el mensaje de la corrección fina decía *«Anulá el cobro y volvé a registrarlo»* — o sea que **empujaba al encargado justo por esa puerta** cada vez que la corrección se bloqueaba por el corte.

### Qué cambió

- `bloqueoPorPeriodoCerrado()` en `caja/periodo-cerrado.ts`: recorre los pagos `paid` de la orden y bloquea si alguno quedó del otro lado de un corte o de una rendición.
- `anularCobro` la llama **antes** de tocar nada.
- El mensaje de `correcciones.ts` ahora manda a registrar la diferencia como movimiento del período actual, que es la salida correcta.
- **`caja_audit_log` por cada pago reembolsado.** Antes anular no dejaba **nada** (grep vacío) y `payments` no tiene `refunded_by`: la plata desaparecía del arqueo sin que quedara quién la sacó. Es el mismo libro donde ya escriben las correcciones de línea.

**No se reusó `evaluarGuardasDeAnulacion` tal cual** a propósito: esa función también rechaza los pagos de Mercado Pago, y aplicarla entera acá habría dejado sin poder anular cualquier orden pagada con MP — una restricción que Juan no pidió y que sería una regresión.

---

## H-16 · Corregir una línea corrige el inventario

### El problema

`editarItemComanda` deja cambiar cantidad o producto de una línea ya cargada, pero **el stock no se movía**: los dos triggers de descuento son `AFTER INSERT` y sólo corren cuando la línea nace.

- 1 bife corregido a 4 → se cobran **4**, se costea **1**.
- Milanesa corregida a Bife → se descontó milanesa y **nunca** bife.

Es el peor de los tres de inventario porque **hace ver el margen mejor de lo real**: en Rentabilidad no se lee como error sino como buena noticia.

### Por qué no lo cubría la 089

Son invariantes distintos. El de la 089 es *"esta línea no se consume → devolvé todo"* y cuelga de `cancelled_at`. Éste es *"esta línea ahora consume otra cosa → ajustá la diferencia"*: otro disparador y otra cuenta (revertir lo viejo **y** descontar lo nuevo).

### Qué cambió

Migración `0042`: trigger `AFTER UPDATE ON order_items` cuando cambia `quantity` o `product_id`. Devuelve el consumo viejo y descuenta el nuevo, cubriendo receta y `track_stock`, y reaplicando el apagado de `is_available`.

**La reversión de la edición escribe `kind='ajuste'`, no `'reversion'`,** y no es cosmético: el núcleo de la 089 es **idempotente por la fila de reversión**, y una línea se puede editar varias veces seguidas (1 → 4 → 3). Con `'reversion'` la segunda edición se habría salteado. Además `ajuste` es lo que operativamente es.

Una línea **cancelada** no se toca en ninguna dirección.

## Verify

- `pnpm typecheck` ✅ · `eslint` limpio ✅ · `pnpm test` ✅ **1630 tests, 0 rojos** con stack local.
- Tests nuevos: 4 en `expected-cash.test.ts` que fijan la convención de propina (incluido el caso tarjeta y la compat con filas viejas sin `tip_cents`).
- **H-16 verificado contra datos reales del cloud**, en un `DO` con rollback — primero midiendo el bug y después el fix:

```
ANTES  · subir cantidad +3: stock 3 -> 3   (no se movía)
DESPUÉS· subir cantidad +3: stock 3 -> 0   ✅
       · bajar 5 después:   vuelve a 5     ✅
       · cambio de producto: viejo +1, nuevo −1  ✅
       · línea cancelada:   0 movimientos   ✅
```

**Lo que NO está verificado:**

- **Nada en vivo con el rol real.** Los tres tocan plata o inventario y merecen una pasada manual: cobrar una mesa con propina desde el desktop del encargado y ver que el arqueo cierre sin sobrante; intentar anular un cobro de un período ya arqueado; corregir una cantidad y ver moverse el stock.
- **H-35 no tiene test automatizado.** `bloqueoPorPeriodoCerrado` consulta dos tablas y necesita fixtures de corte y rendición; la lógica está leída y es chica, pero no ejercitada.
- **El stock histórico no se corrige.** Las ediciones pasadas dejaron el inventario mal y eso no se backfillea, por el mismo motivo que la 089: el encargado ya compensó a mano. El corte es el mismo — de acá en adelante ajusta solo.
