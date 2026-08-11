# Feature Specification: Los ítems sin comanda también se editan

**Feature Branch**: `110-items-sin-comanda-editables`

**Created**: 2026-08-11

**Status**: 🔵 Propuesta — sin implementar. Issue [#169](https://github.com/gachetponzellini/RestaurantOS-app/issues/169).

**Input**: Pedido de Juan (2026-08-11): *"desde operación, al tocar una mesa, poder editar los ítems que no fueron comandados — hoy no hay forma — y que deje eliminar también"*.

## Contexto y problema

Hay ítems de una mesa que **ningún lugar de la app deja tocar**. No es que estén protegidos: es que no tienen UI.

**Dónde vive hoy la edición.** Editar (`editarItemComanda`) y quitar (`cancelarItem`) un ítem sólo se pueden disparar desde el **kanban de comandas** (`comandas-kanban.tsx:1204,1228`). El kanban dibuja **comandas**, y dentro de cada comanda sus ítems.

**Qué queda afuera.** Un ítem entra a una comanda sólo si tiene sector. `enviarComanda` inserta los ítems con `station_id` resuelto y **los de `station_id = null` no generan comanda** — así está escrito y es intencional (`actions.ts:449-460`, `:516`): son las bebidas y los productos de stock que el mozo lleva directo, sin papel en cocina. Consecuencia no buscada: **no aparecen en el kanban, y por lo tanto no se pueden editar ni eliminar en ningún lado**. Una Coca cargada de más queda en la cuenta hasta que se cobra.

**El panel de la mesa tampoco alcanza.** Al tocar una mesa en Operación, el panel muestra `OrderSummaryCard`: lista *todos* los ítems del pedido (incluidos los sin sector) y abajo las comandas por sector. Los ítems son **texto plano** — la card no tiene ni un gesto por línea; su único menú es «Entregar / Anular» a nivel **comanda** (spec 078). Se ven, no se tocan.

**Lo que sí está listo.** Las dos server actions ya son **por ítem**, no por comanda: `cancelarItem(orderItemId, motivo, slug)` y `editarItemComanda(slug, orderItemId, patch)` resuelven la orden desde el propio `order_item` y ya validan tenant, rol (`canCancelItem` / `canModifyPostEnvio`: encargado o admin), `lifecycle_status = open`, ítem no cancelado, y combos/menú del día. **No hay nada de server que falte**: el agujero es de UI.

## Requirements *(mandatory)*

- **FR-001**: En Operación → tocar una mesa, cada línea de ítem **no cancelada** de la cuenta abierta expone dos gestos: **editar** y **eliminar**.
- **FR-002**: El alcance del gesto son **todas** las líneas de la orden, tengan comanda o no. El bug es la asimetría; arreglar sólo las sin sector la dejaría viva del otro lado (el mismo ítem editable en el kanban y no en la mesa).
- **FR-003**: **Eliminar = `cancelarItem`, no un DELETE.** La línea queda con `cancelled_at` / `cancelled_reason` / `cancelled_by` y se recalcula el total. Borrar la fila rompería la auditoría (spec 34) y el arqueo. Se pide motivo, como en el kanban.
- **FR-004**: **Editar** usa `editarItemComanda`: cantidad, producto, notas y precio override. Ítems de combo, de menú del día o componentes (`is_combo_component`, `parent_order_item_id`, `daily_menu_id`) siguen rechazados por el server — la UI **no ofrece el gesto** en esas líneas en vez de dejar que el usuario choque contra el error.
- **FR-005**: Gate de rol en la UI, no sólo en el server: si el rol no es encargado/admin (`canCancelItem` / `canModifyPostEnvio`), los gestos no se dibujan. Un mozo no ve botones que le van a decir que no.
- **FR-006**: Cuenta cerrada (`lifecycle_status ≠ open`) → sin gestos. Es la regla de la spec 092 (H-48): no se reescribe plata ya cobrada. Vale también acá, donde la mesa puede estar en «pedir cuenta» o ya cobrada.
- **FR-007**: Si el ítem **sí** tiene comanda, editar o cancelar tiene que dejar cocina y papel consistentes con lo que ya hace el kanban: mismo camino de reimpresión/aviso que `editarItemComanda` y `cancelarItem` disparan hoy. No se abre una segunda semántica.
- **FR-008**: El panel refresca sin recargar la ruta (regla de la spec 102/103): total, líneas y comandas quedan al día tras el gesto.

## Preguntas abiertas

- **Q1**: ¿Editar un ítem **sin sector** (una bebida) tiene que poder cambiarle el producto, o alcanza con cantidad + eliminar? Cambiar producto puede moverlo a un producto **con** sector y ahí queda un ítem huérfano sin comanda — `enviarComanda` ya tiene el rescate de huérfanos (`actions.ts:428-460`), pero el edit no pasa por ahí. **Decidir antes de implementar.**
- **Q2**: ¿El gesto vive en `OrderSummaryCard` (la comparte mozo y admin) o en un wrapper sólo de admin? Tocar la card compartida arrastra a la vista del mozo.

## Verify

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de encargado** (nunca service_role):
  1. Mesa abierta con una bebida (producto **sin** sector) y un plato (con sector).
  2. En Operación, tocar la mesa: ambas líneas ofrecen editar/eliminar.
  3. Eliminar la bebida con motivo → baja del total, queda auditada, no desaparece de la base.
  4. Editar la cantidad del plato → total al día y cocina/comanda consistente.
  5. Con rol **mozo**: no se dibujan los gestos.
  6. Con la cuenta ya cobrada: no se dibujan los gestos.
