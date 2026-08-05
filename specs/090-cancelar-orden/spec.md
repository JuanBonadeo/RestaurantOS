# Feature Specification: Matar un pedido se hace en un solo lugar

**Feature Branch**: `090-cancelar-orden`

**Created**: 2026-08-05

**Status**: 🟡 Implementada · falta verificación en vivo

**Input**: Juan, 2026-08-05: *"si se anula la mesa el pedido debería quedar como algo distinto a pendiente, no?"*.

**Issue**: #142

**Depende de**: [`089`](#141) — el trigger de reversión por ítem tiene que existir **antes**, porque este helper empieza a marcar `cancelled_at` en masa y es lo que dispara la devolución de stock.

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-01, H-17, H-19, H-26, H-31.

## Contexto y problema

Cancelar un pedido se hacía en **cinco lugares** y ninguno lo hacía entero. Cada uno escribía el subconjunto de ejes que su autor tenía en la cabeza:

| Write-site | `status` | `lifecycle_status` | `cancelled_at` | ítems | comandas | totales |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `anularMesa` | ❌ | ✅ | ✅ | ⚠️ parcial | ✅ | ❌ |
| `updateOrderStatus(cancelled)` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `cancelOrderByCustomer` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `liberarMesa` | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| rescate de venta mostrador | ❌ | ✅ | ✅ | ❌ | — | ❌ |

Son **espejos exactos**: el salón escribía `lifecycle_status` y nunca `status`; el canal online, `status` y nada más. Medido en el cloud: **23 mesas anuladas** que la analítica contaba como venta y **4 pedidos cancelados** con la cuenta abierta.

Y tres agujeros más, cada uno con su síntoma en el local:

- **H-01 · el barrido de ítems.** `anularMesa` derivaba los ítems a cancelar **desde las comandas activas**, así que quedaban vivos (a) todo producto `track_stock` —las bebidas tienen `station_id = null` y nunca entran a `comanda_items`— y (b) los ítems de comandas ya entregadas. En el cloud: **29 ítems vivos por $606.200**, 27 de ellos nunca enviados a comanda. Se anula la Mesa 7 con 6 cervezas y al día siguiente Top productos las sigue mostrando.
- **H-17 · las comandas del canal online.** Cancelar un delivery desde el board no tocaba una sola comanda: el cocinero terminaba el plato y nadie lo venía a buscar. Si la comanda seguía `pendiente`, la comandera **la imprimía después de cancelada y sin cartel de ANULADA**.
- **H-31 · `liberarMesa`.** Un `anularMesa` degradado: cancelaba la cuenta y dejaba las comandas vivas **y accionables** (el botón sólo se apaga con `cancelled_at`, que nunca se escribía).

Y `anularMesa` **no recalculaba totales**, a diferencia de `cancelarItem`, así que una mesa anulada conservaba su `total_cents` completo — el número con el que `emitInvoice` facturaba y el que inflaba el denominador del reporte fiscal.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Un helper o una RPC transaccional? | **Helper TS por ahora.** La RPC es mejor (atomicidad real) pero obliga a duplicar en plpgsql la lógica de totales, que ya existe y está testeada en TS. El helper deja los cinco call-sites consistentes hoy; la RPC queda como paso posterior si aparece una carrera real. |
| ¿Qué ítems se cancelan? | **Todos los vivos de la orden**, con `.eq(order_id).is(cancelled_at,null)`. El recorrido por comandas queda **sólo** para decidir a quién se le imprime el ticket «ANULADA». |
| Si se cancelan todos los ítems, ¿vuelve todo el stock? | **No**, y está bien: de eso se ocupa el trigger de la [`089`](#141), que saltea las líneas `kitchen_status='delivered'`. La comida que salió no vuelve a la heladera. |
| ¿Desde qué estados se puede cancelar? | **Sólo desde `open`**. Es guarda optimista contra la carrera "el mozo cobra mientras el encargado anula": anular algo ya cobrado es una decisión con plata adentro y le corresponde a la [`092`](#144), que tiene las guardas de `payments` e `invoices`. |
| ¿Y si el UPDATE de la orden no matchea? | **Se corta, no se sigue.** Correr la cascada igual sería peor que no hacer nada: cancelaría los ítems de una orden **cobrada** y el recompute le bajaría el `total_cents` por debajo de lo que el cliente ya pagó. |
| ¿Los dos call-sites que escriben bajo RLS pasan a service client? | **No.** `updateOrderStatus` no tiene chequeo explícito de membresía: se apoya en RLS. Cambiarlo a service client abriría un agujero. El patrón queda: **el UPDATE bajo RLS prueba el permiso**, y recién entonces la cascada corre con el service client (que necesita tocar `order_items` y `comandas`). Por eso el helper se parte en dos. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La mesa anulada deja de ser una venta (Priority: P1)

Como dueño, quiero que una mesa anulada no aparezca en la facturación del día.

**Independent Test**: anular una mesa. La orden queda con `status='cancelled'` **y** `lifecycle_status='cancelled'`. Hoy queda `pending`.

### User Story 2 - Las cervezas vuelven (Priority: P1)

Como encargado, quiero que al anular una mesa se cancele **todo** lo cargado, no sólo lo que fue a cocina.

**Independent Test**: mesa con una cerveza (sin sector, sin comanda) y un plato (con comanda). Anular cancela **las dos** líneas. Hoy la cerveza queda viva.

### User Story 3 - Cocina se entera (Priority: P1)

Como cocinero, quiero dejar de preparar lo que se canceló.

**Independent Test**: cancelar un delivery ya marchado desde el board. La comanda activa queda anulada con su reimpresión encolada; la ya entregada se respeta.

### User Story 4 - Cobrar y anular a la vez no rompe nada (Priority: P2)

Como sistema, quiero que anular una mesa que se acaba de cobrar no toque la plata.

**Independent Test**: orden en `closed`; llamar `cancelarOrden`. Devuelve `cancelled:false`, no cancela ítems y el `total_cents` queda intacto.

## Requisitos

- **FR-001** `cancelarOrden(service, {orderId, businessId, motivo, actorUserId})` escribe los **cinco** ejes: `status`, `lifecycle_status`, `cancelled_at`/`reason`/`by`, **todos** los `order_items` vivos, y las comandas activas con `reprint_requested_at`.
- **FR-002** Recalcula totales con `recomputeOrderTotals`.
- **FR-003** El UPDATE de la orden va guardado por `.eq("lifecycle_status","open")`; si no matchea, **no** corre la cascada.
- **FR-004** Idempotente: las tres escrituras filtran por dato (`is null` en ítems y comandas). Segunda llamada → `cancelled:false` y cero escrituras.
- **FR-005** Las comandas **entregadas** no se anulan.
- **FR-006** `cancelDownstream` se exporta aparte para los call-sites que ya escribieron la orden bajo RLS.
- **FR-007** Los cinco call-sites lo usan: `anularMesa`, `liberarMesa` (vía `updateTableOperationalStatus`), `updateOrderStatus(cancelled)`, `cancelOrderByCustomer` y el rescate de venta mostrador.
- **FR-008** `recomputeOrderTotals` se muda de `comandas/actions.ts` a `orders/totals-recompute.ts`: en un módulo `'use server'` no se puede exportar sin convertirla en **server action invocable desde el browser**.

## Fuera de alcance

- Guardas de `payments` e `invoices` al anular → [`092`](#144).
- Que los consumidores lean los dos ejes (`isOrderDead`) y el backfill de las 63 filas → [`091`](#143).
- Pasar el helper a RPC transaccional.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1596 tests, 0 rojos** (suite completa **con stack local levantado**, integración incluida) · eslint limpio en todo lo tocado.
- Tests nuevos: `cancel-order.integration.test.ts` (6, contra Postgres real) — cubren los dos ejes, el ítem sin comanda, las comandas activas vs entregadas, el recompute, la idempotencia y la carrera del cobro.
- `anular-mesa.integration.test.ts` y `venta-mostrador.test.ts` siguen verdes sin tocarlos: el refactor preservó el comportamiento que ya estaba bien.

**Lo que NO está verificado:**

- **Nada en vivo con el rol real.** Falta anular una mesa con bebidas desde la app y ver: la orden en `cancelled` por los dos ejes, el stock de barra subir, y el ticket «ANULADA» salir por la comandera.
- **El backfill de las 23 órdenes ya rotas no se hizo** — es de la [`091`](#143). Hasta entonces conviven las viejas (mal) y las nuevas (bien).
- La atomicidad no es real: son cuatro escrituras seguidas, no una transacción. Si el proceso muere entre medio queda una orden cancelada con ítems vivos. La idempotencia permite re-ejecutar, pero **no hay nada que la re-ejecute solo**.
