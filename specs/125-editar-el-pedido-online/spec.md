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

### Fase A · Una lista de ítems editable, compartida

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
- `lifecycle_status ≠ open` → sin gestos.

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

- **Las dos server actions de ítem.** Ya validan todo lo que hay que validar; se
  usan como están.
- **`routeOrderToCocina`.** Sigue siendo el camino de la primera marcha y sigue
  siendo idempotente a nivel orden. Agregar ítems es otra puerta.
- **El salón.** La fase B mueve código, no cambia el flujo del mozo.
- **La frontera de plata.** Orden cerrada no se edita (spec 092 · H-48).

## Decisiones pendientes — hay que cerrarlas antes de implementar

**D1 · Hasta qué estado se edita.** En la mesa la regla es una sola:
`lifecycle_status = open`. Propuesta: mantener exactamente esa, y que
`orders.status` sólo module la **advertencia** — sin comandas, edición silenciosa;
de `preparing` en adelante, aviso de que ya está en cocina y reimpresión
automática. De `on_the_way` en adelante el pedido está en la calle: ahí no hay
edición que valga, sólo el camino de anulación que ya existe.

**D2 · Pedido ya pagado (MP).** El webhook acredita el pago pero **no** llama a
`closeOrderIfFullyPaid` en la rama online: la orden queda `open`, o sea
**editable, y hoy nada avisa que la plata ya entró**. Si se saca un ítem, el
total baja por debajo de lo pagado y queda una devolución que el sistema no
modela. Es el borde más caro de los tres. ¿Se permite con confirmación explícita
y un registro del delta, o un pedido pagado sólo se anula y se rehace? **Decisión
de negocio.**

**D3 · Q1 de la spec 110, todavía abierta.** Editar una bebida (sin sector) y
cambiarla por un producto **con** sector deja un ítem huérfano sin comanda.
`enviarComanda` tiene rescate de huérfanos; `editarItemComanda` no pasa por ahí.

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
