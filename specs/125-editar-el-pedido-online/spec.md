# 125 · Editar el pedido online, con las piezas de la mesa

**Issue:** [#195](https://github.com/gachetponzellini/RestaurantOS-app/issues/195) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-20: *"habría que ver cómo manejar la edición de pedidos
desde la parte de pedidos, porque va a ser medio un kilombo, el tema de las
comandas. Yo trataría de hacerlo lo más parecido a como está en las mesas, así no
tenemos que escribir mucho más código nuevo"*.

## Por qué

Un pedido online no se puede tocar. Entró mal, el cliente llama y agrega una
empanada, el encargado se equivocó de producto: hoy la única salida es cancelar
el pedido entero y volver a cargarlo — con otro número, otro control y otra
comanda.

La intuición de Juan es correcta y se queda corta: no es que la mesa **se
parezca**, es que **es la misma orden**. Un pedido online y una mesa son filas de
`orders` con `order_items`; lo único que las distingue es `table_id` y
`delivery_type`. Casi todo el aparato de edición de la mesa aplica sin tocarlo.

## Lo que ya está (y no hay que escribir)

| Pieza | Por qué sirve tal cual |
|---|---|
| `cancelarItem(orderItemId, motivo, slug)` | Resuelve la orden desde el ítem. Valida negocio, rol (`canCancelItem`) y `lifecycle_status = open`. **Nunca pide mesa.** |
| `editarItemComanda(slug, orderItemId, patch)` | Ídem: cantidad, producto, notas y precio override, con `canModifyPostEnvio`. |
| Comandas por batch | `createComandasForItems` calcula `batch` incremental por `(order_id, station_id)` y ya lo comparten `enviarComanda` y `routeOrderToCocina`. Agregar después = batch 2, igual que el mozo que manda los postres. |
| Kanban de comandas | Filtra por sector y negocio, **no** por mesa (`comandas/queries.ts`), así que ya muestra —y ya deja editar— las comandas de un pedido online. |
| Stock | Los triggers cuelgan de `order_items`: descuento al insertar, reversión al cancelar (0039), delta al editar cantidad (0042). Ya cubren el canal online. |
| Reimpresión | `encolarReimpresionDeItem` y `solicitarReimpresion` salen desde las propias actions. |
| Panel de carga | `PanelDeCarga` ya es el mismo shell en el salón y en la hoja online (specs 115 · 117 · 123). |

`lifecycle_status` nace `open` (baseline) y pasa a `closed` al saldarse
(`closeOrderIfFullyPaid`). Es la misma frontera de plata que gobierna la mesa:
**mientras la orden está abierta se edita, cobrada no.**

## Los tres agujeros reales

1. **Antes de confirmar no hay UI.** Un pedido en `pending` todavía no tiene
   comandas, así que no aparece en el kanban — el único lugar donde hoy se puede
   editar un ítem. Y los ítems **sin sector** (bebidas) no aparecen nunca. Es
   exactamente el problema de la [spec 110](../110-items-sin-comanda-editables/spec.md)
   (issue #169), del otro lado del mostrador.
2. **Agregar ítems a un pedido vivo no existe.** `routeOrderToCocina` **no
   sirve**: es idempotente a nivel orden — si ya hay comandas, no-op. Rutearía
   cero. El que sabe agregar líneas a una orden abierta es `enviarComanda`, atado
   a `tableId`.
3. **El control de pedido queda viejo.** Es el papel que se lleva el repartidor,
   uno por orden (`print_jobs`, índice parcial `where kind = 'control'`). Se
   emite al marchar y nadie lo vuelve a emitir. La mesa no tiene este problema:
   su papel equivalente es la cuenta, que se imprime al cobrar.

## Qué se construye

### Fase A · Una lista de ítems editable, compartida ✅

**Implementada** (2026-08-20): `f48dba1` (guarda de plata + el modal sale del
kanban a `components/shared/editar-items-modal.tsx`), `226101f` (el detalle del
pedido online), `43d7143` (el panel de la mesa — cierra la spec 110 · #169).

Dos cosas se decidieron sobre la marcha: el **sector es del ítem y no del
modal**, porque un pedido online mezcla parrilla y cocina en la misma pantalla;
y las líneas editables viajan **aparte** de las que se muestran — esas incluyen
las canceladas (se listan tachadas) y las comparte la vista del mozo.


Un componente que reciba `orderId` + los ítems + `canEdit`, y ponga **editar** y
**eliminar** en cada línea no cancelada, llamando a las dos actions que ya
existen. Se monta en dos lugares: el panel de la mesa en Operación y el detalle
del pedido online.

Reglas heredadas de la spec 110, sin cambiarles una coma:

- **Eliminar = `cancelarItem`, no un DELETE.** Queda `cancelled_at` /
  `cancelled_reason` / `cancelled_by` y se recalcula el total. Con motivo.
- **Editar = `editarItemComanda`**: cantidad, producto, notas, precio override.
- Combos, menú del día y componentes **no ofrecen el gesto** (el server ya los
  rechaza; que la UI no los dibuje evita el choque).
- Gate de rol en la UI además del server: un mozo no ve botones que le van a
  decir que no.
- `lifecycle_status ≠ open` **o `payment_status = paid`** → sin gestos. La UI no
  los dibuja y las dos actions lo rechazan.

**Esta fase cierra la spec 110 y este pedido con el mismo código.** Hacer 110
sola sería escribir dos veces la misma lista.

De paso, el detalle del pedido online pasa a usar `OrderSummaryCard` —ya es
genérica, la mesa es un prop opcional— y así muestra las comandas por sector, que
hoy no muestra.

### Fase B · `agregarItemsAOrden(orderId, items)`

Extraído de `enviarComanda`, que ya es casi todo genérico: resolver productos y
modifiers, `resolveStation`, insertar `order_items` con su `kitchen_status`,
agrupar por sector, `createComandasForItems`, el rescate de huérfanos y la
idempotencia por `client_line_key`. Lo único atado a la mesa es el bloque que
resuelve o crea la orden.

`enviarComanda(tableId, …)` queda como *«resolver la orden de la mesa → llamar al
núcleo»*. Ningún cambio de comportamiento del lado del salón: es el mismo código,
movido.

Con eso, **«Agregar ítems» en el detalle del pedido online** = `PanelDeCarga` (ya
compartido) + esa action. La comanda nueva sale como batch 2, con el mismo papel
y el mismo ruteo que cualquier agregado de mesa.

### Fase C · Que el papel diga la verdad

`print_jobs` **ya tiene `reprint_requested_at`**, el `GET /api/print-agent` ya
sirve los jobs con ese flag seteado, y el contenido del control **se arma al
vuelo** desde `orders` + `order_items` en cada GET — no hay payload congelado.

Entonces la fase C no es una feature: es setear ese flag cuando se edita un
pedido online que ya marchó, igual que `cancelarItem` encola la reimpresión de la
comanda. **Sin migración y sin tocar el contrato del agente.** El repartidor
recibe el papel con el pedido corregido.

## Qué NO cambia

- **La firma de las dos actions de ítem.** Se usan como están; lo único que se
  les agrega es la guarda de `payment_status` (ver D2), una línea en cada una.
- **`routeOrderToCocina`.** Sigue siendo el camino de la primera marcha y sigue
  siendo idempotente a nivel orden. Agregar ítems es otra puerta.
- **El salón.** La fase B mueve código, no cambia el flujo del mozo.
- **La frontera de plata.** Orden cerrada no se edita (spec 092 · H-48).

## La regla, en una línea

**Se edita mientras la orden esté abierta y no esté pagada.** Nada más.

```
lifecycle_status = 'open'  AND  payment_status <> 'paid'
```

Decidido con Juan (2026-08-20): *"si está pagado, no se debería poder editar,
hay que hacerlo simple"*. Las tres decisiones que estaban abiertas se cierran con
esa misma frase.

**D1 · Hasta qué estado se edita.** La regla de arriba y ninguna otra. El
`orders.status` **no** agrega condiciones: no hay una tabla de qué se puede hacer
en `preparing` y qué en `on_the_way`. Lo único que cambia con el estado es el
**aviso**: si el pedido ya marchó, la UI dice que está en cocina y la comanda se
reimprime sola.

Un pedido `delivered` impago sigue siendo editable, y está bien: es el delivery
que volvió y se cobra al mostrador (issue #190). Corregirlo **antes** de cobrar es
justamente el momento correcto.

**D2 · Pedido pagado.** No se edita: sin gestos de editar, eliminar ni agregar.
El pedido pagado que hay que cambiar se **anula** (`cancelarOrden`, spec 090, que
ya modela la devolución) y se rehace. Preferimos perder un número de pedido antes
que dejar una orden cobrada que no coincide con lo que se cobró.

Esto vale para todo el canal, no sólo MP: `payment_status = 'paid'` lo escriben
también el cobro del encargado y el cierre por saldo.

⚠️ **La guarda va en el server, no sólo en la UI.** Hoy `cancelarItem` y
`editarItemComanda` validan `lifecycle_status` pero **no** `payment_status`, y un
pedido pagado por MP queda `open` — el webhook acredita el pago y no llama a
`closeOrderIfFullyPaid`. O sea que hoy la base **deja** editar un pedido cobrado.
Es una línea en cada action, y aplica igual a la mesa (donde `paid` implica
`closed` en la práctica, así que no le cambia nada).

**D3 · El ítem que cambia de sector.** Cambiar de producto se ofrece **sólo entre
productos del mismo sector**, que es lo que ya hace el modal del kanban con
`getSwappableProducts(slug, station_id)`. Un ítem **sin** sector (una bebida)
ofrece cantidad, notas y eliminar — no cambio de producto.

Así el huérfano de la Q1 de la spec 110 no puede nacer, y no hay que escribirle un
rescate. Si el encargado necesita convertir una Coca en un plato: elimina la
línea y agrega la otra, que con la fase B es un gesto de dos toques.

## Verificación

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de encargado** (nunca service_role):
  1. Pedido online en `pending`: editar cantidad y eliminar una línea. Total al
     día, línea auditada, sin comanda de por medio.
  2. Confirmar ese pedido: la comanda sale con lo que quedó, no con lo original.
  3. Pedido ya marchado: agregar un ítem → **batch 2** en el sector que
     corresponde, y el control se reimprime con el pedido completo.
  4. Quitar un ítem ya comandado → la comanda se reimprime corregida y cocina no
     prepara el plato quitado.
  5. Ítem sin sector (una bebida): se edita y se elimina igual que el resto.
  6. Con rol **mozo**: no se dibujan los gestos.
  7. Pedido ya cobrado: no se dibujan los gestos.
