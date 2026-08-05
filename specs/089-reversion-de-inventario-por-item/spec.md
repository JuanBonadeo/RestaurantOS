# Feature Specification: El stock vuelve cuando se cancela una línea

**Feature Branch**: `089-reversion-de-inventario-por-item`

**Created**: 2026-08-05

**Status**: 🟡 Implementada · migración aplicada al cloud · falta verificación en vivo

**Input**: Juan, 2026-08-05: *"hay que evaluar como se manejan los estados de los pedidos en todos los casos"*.

**Issue**: #141

**Bloquea a**: [`091`](#143) — sincronizar los ejes **sin esto** haría que anular una mesa devuelva al inventario la comida que sí se cocinó y se sirvió. Primero el trigger, después la sincronización.

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-02, H-03, H-15, H-16, H-27.

## Contexto y problema

La única reversión de inventario que existía colgaba del eje equivocado:

```sql
AFTER UPDATE ON orders WHEN new.status = 'cancelled'   -- 0001:3019, :264
```

`orders.status` es el eje que **el salón nunca escribe** (`anularMesa` marca `lifecycle_status` y no lo toca). En el cloud hay **23 órdenes anuladas con `status='pending'`**: veintitrés anulaciones que no devolvieron un solo insumo.

Y aun cuando el trigger corría —un delivery cancelado desde el board— estaba incompleto en cuatro frentes:

| | Qué |
|---|---|
| **H-03** | `continue` **explícito** sobre `track_stock=true` (`0001:270-272`). Las bebidas no volvían nunca, por ningún camino. Para `stock_items` no existía reversión de ninguna clase y el CHECK ni siquiera admitía `kind='reversion'` (`0001:1768`). |
| **H-02** | Recorría **todos** los `order_items` sin mirar si la comida ya había salido → devolvía al inventario platos cocinados y servidos. |
| **H-27** | Escribía `cost_cents_snapshot = 0` literal (`0001:293-303`). `getProfitMetrics` sumaba el costo y excluía la venta: el food cost salía 4-5 puntos arriba del real. |
| **H-15** | Nadie reactivaba `products.is_available` cuando el stock volvía a subir. La última botella se cancelaba y el vino quedaba apagado en la carta, con la botella física en la heladera. |

Y **no existía ningún trigger `AFTER UPDATE ON order_items`** (verificado contra el cloud), así que `cancelarItem`, `cancelarComanda` y `cancelarItemEnCuenta` tampoco movían inventario: anular una línea por rotura no devolvía nada.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿De qué cuelga la reversión? | **De `order_items.cancelled_at`**, no de `orders.status`. Es el hecho real ("esta línea no se consume") y lo escriben los cuatro caminos de cancelación, no sólo el canal online. |
| ¿La comida ya entregada vuelve al inventario? | **No.** Una línea con `kitchen_status='delivered'` se saltea: el plato se cocinó y salió. Devolver el insumo sería inventar stock que no está en la heladera. Es el mismo criterio que `anularMesa` ya aplica con las comandas entregadas. |
| ¿Se dropea el trigger viejo sobre `orders`? | **No, todavía.** Mientras la [`090`](#142) no esté, `updateOrderStatus(cancelled)` sigue siendo un camino que sólo escribe `orders.status`; dropearlo ahora dejaría al canal online sin reversión entre una spec y la otra. Se reescribe para delegar en el núcleo nuevo. |
| ¿Cómo se evita revertir dos veces? | **Idempotencia por dato, no por orden de ejecución.** Los dos triggers pueden verse en la misma transacción (la 090 cancela los ítems *y* pone la orden en `cancelled`) y el orden entre ellos no está garantizado. En vez de razonar sobre eso se sostiene el invariante directo: *el stock de una línea se devuelve como mucho una vez*, y la prueba es la propia fila de reversión. |
| ¿Se backfillea el stock histórico? | **No.** Ejecutar la reversión retroactiva sobre los 29 ítems vivos descuadraría el inventario contra los ajustes manuales que el encargado ya hizo para compensar. Se declara el corte: de acá en adelante revierte solo, el pasado se arregla con el conteo físico del próximo cierre. |
| ¿Entra el delta de `editarItemComanda` (H-16)? | **No en esta spec** — ver Fuera de alcance. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La cerveza vuelve al stock (Priority: P1)

Como encargado, quiero que al anular una mesa con 6 cervezas el stock de barra vuelva a subir.

**Independent Test**: cancelar la línea de un producto `track_stock`. `stock_items.current_qty` sube por la cantidad de la línea y queda una fila `stock_movimientos kind='reversion'`. Hoy no vuelve nada, por ningún camino.

### User Story 2 - El vino vuelve a la carta (Priority: P1)

Como dueño, quiero que si el stock vuelve a subir el producto se reactive solo.

**Independent Test**: producto en 0 y `is_available=false`; cancelar una línea suya. `current_qty > 0` → `is_available` vuelve a `true`.

### User Story 3 - La comida servida no se inventa (Priority: P1)

Como encargado, quiero que anular una mesa no devuelva al inventario lo que ya se comió.

**Independent Test**: línea con `kitchen_status='delivered'`; cancelarla. **Cero** filas de reversión, stock intacto.

### User Story 4 - El margen deja de mentir (Priority: P2)

Como dueño, quiero que Rentabilidad no me cargue el costo de lo que se canceló.

**Independent Test**: cancelar una línea con receta. La fila de reversión lleva el costo **real** y `getProfitMetrics` lo resta del food cost.

## Requisitos

- **FR-001** `stock_movimientos_kind_check` acepta `'reversion'`.
- **FR-002** Núcleo `fn_stock_reversion_item(order_item_id)`: devuelve al inventario lo que consumió **una** línea. Cubre receta (explotando sub-recetas) **y** `track_stock`.
- **FR-003** El núcleo es **idempotente**: si ya existe una fila de reversión para ese `order_item_id` (en `ingredient_consumptions` o en `stock_movimientos`), no hace nada. Índices parciales nuevos para que el chequeo sea barato.
- **FR-004** El núcleo **saltea** las líneas con `kitchen_status = 'delivered'`.
- **FR-005** La fila de reversión de receta lleva el `cost_cents_snapshot` **real**, en positivo (magnitud, igual que `'venta'`); el signo lo pone quien lee.
- **FR-006** Si tras la reversión `current_qty > 0`, se reactiva `products.is_available`.
- **FR-007** Trigger `trg_stock_reversion_por_item` — `AFTER UPDATE ON order_items WHEN (old.cancelled_at IS NULL AND new.cancelled_at IS NOT NULL)`.
- **FR-008** `fn_recipe_stock_reversion` (sobre `orders`) se reescribe para delegar en el núcleo línea por línea, y así hereda idempotencia, cobertura de `track_stock`, costo real y el salteo de lo entregado.
- **FR-009** `getProfitMetrics` incluye `reversion` en el conjunto y la **resta** del food cost, con piso en cero (una reversión puede caer en el rango de fechas con su venta afuera).

## Fuera de alcance

- **H-16 · el delta de `editarItemComanda`.** Corregir cantidad o producto de una línea sigue sin mover inventario. Es un caso distinto —no es "esta línea no se consume" sino "se consume otra cosa"— y necesita su propio trigger `AFTER UPDATE` sobre `quantity`/`product_id` que revierta lo viejo y descuente lo nuevo. **Queda abierto en #141**; meterlo acá mezclaba dos invariantes en un trigger.
- Backfill del stock histórico (decisión explícita arriba).
- Estación por defecto, reversión de `merma`, y el resto del inventario.

## Riesgos → tests

| Riesgo | Cómo se verificó |
|---|---|
| El stock de receta no vuelve | ✅ contra el cloud: `-101.407 → -98.861`, 8 filas de reversión |
| El costo sigue en 0 | ✅ `costo_total = 319558` centavos (antes: 0 literal) |
| Doble reversión (ítem + orden en la misma tx) | ✅ segunda llamada al núcleo → sigue en 8 filas |
| Las bebidas no vuelven | ✅ `current_qty 47 → 48`, 1 fila en `stock_movimientos` |
| Se inventa stock de comida servida | ✅ línea `delivered` → **0** reversiones |
| El margen se va a negativo | piso en cero en `getProfitMetrics` |

## Notas de implementación

**Migración `0039_reversion_de_stock_por_item.sql`, aplicada al cloud** `tjfufswzsxfujcpoxapx`.

Un detalle de plpgsql que vale la pena dejar escrito: el núcleo corta con `if not found`, **no** con `if v_item is null`. Sobre un `record`, `IS NULL` sólo da true si *todos* los campos son null — no es la pregunta que uno cree estar haciendo, y con un join que trae `business_id` habría dado false aun sin fila.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ (los `*.integration` fallan por falta de stack local, igual que antes).
- **Comportamiento verificado contra el cloud con datos reales, en un `DO` con rollback** — los cinco casos de la tabla de riesgos.

**Lo que NO está verificado:**

- **No hay test automatizado del trigger.** La verificación fue manual contra el cloud (con rollback) porque Docker no estaba levantado en esta máquina. Falta un `*.integration.test.ts` que fije los cinco casos.
- **Nada probado en vivo con el rol real**: anular una mesa con bebidas desde la app y ver el stock subir en la pantalla de stock.
- **El trigger está vivo en el cloud desde ya.** Es aditivo (sólo actúa sobre cancelaciones, que son deliberadas y poco frecuentes) e idempotente, pero conviene mirar el primer caso real.
