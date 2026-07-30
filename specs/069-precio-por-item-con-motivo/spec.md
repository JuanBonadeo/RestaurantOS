# Feature Specification: Precio por ítem editable con motivo (override de mostrador)

**Feature Branch**: `069-precio-por-item-con-motivo`

**Created**: 2026-07-30

**Status**: 🚧 En implementación. Issue [RestaurantOS-Brain#34](https://github.com/gachetponzellini/RestaurantOS-Brain/issues/34). Extiende la carga de pedido de los specs [054](../054-cargar-pedido-para-llevar/) / [055](../055-carga-pedido-teclado/) y la edición post-envío del spec [049](../049-comandas-encargado-anular-editar/).

**Input**: Pedido de Juan 2026-07-30 — *"vamos a tener que de alguna manera permitirle al encargado que cuando está cargando un producto, le deje editar el precio de ese item, solo por ese pedido, y que le pida un motivo, como cuando anula una mesa etc, tendría que quedar registro de eso"*.

## Contexto y problema

Hoy el precio de una línea **nunca lo fija el cliente**: la action lo lee de la DB y lo snapshotea. En [`enviarComanda`](../../src/lib/comandas/actions.ts) el insert es literal `unit_price_cents: product.price_cents`, y en [`persist-order.ts`](../../src/lib/orders/persist-order.ts) lo mismo. Es una defensa deliberada y correcta contra un cliente que manipula el carrito.

El costo de esa defensa es que **no hay ninguna vía para cobrar un precio distinto en una línea puntual**, y en un restaurante real eso pasa todos los días:

- **Producto fuera de carta.** El pescado del día que no está cargado, el plato que el chef improvisa. Hoy el encargado carga "lo más parecido" y el ticket miente.
- **Cortesía / atención al cliente.** Se le quema un plato al comensal, se le repone y esa línea va a $0. Hoy hay que cobrarla y después descontar del total.
- **Media porción, porción chica, sin guarnición.** Variantes que no justifican un producto nuevo en el catálogo.
- **Error de carta.** El precio impreso en la carta física quedó viejo y el cliente reclama; se respeta el precio de la carta esa vez.
- **Acuerdo puntual con un socio / evento.** Precio pactado para esa mesa, no para el catálogo.

El **workaround actual** es el descuento a nivel cuenta ([`aplicarPropinaYDescuento`](../../src/lib/billing/cuenta-actions.ts)): el encargado calcula a mano la diferencia y la mete como descuento global con motivo. Funciona para la plata, pero:

1. **Rompe la analítica de producto.** El descuento cuelga de la orden, no de la línea. La [ingeniería de menú](../../src/lib/admin/profit-query.ts) y el reporte de top-products siguen viendo el plato a precio de lista, así que el margen real por producto queda inflado.
2. **Rompe la factura.** ARCA se emite sobre las líneas; una cortesía cobrada a $2.000 y descontada aparte factura un ítem que no se cobró a ese precio.
3. **No escala a dos ajustes en la misma mesa.** Un descuento por orden, un motivo por orden. Dos cortesías distintas se funden en un número y una frase.
4. **Es aritmética mental en hora pico**, que es exactamente donde el sistema no debe pedir cuentas.

### Lo que ya existe y se reusa

- **El patrón "acción sensible + motivo obligatorio + quién + cuándo"** está resuelto tres veces: `cancelarItem` (`cancelled_at` / `cancelled_reason` / `cancelled_by` en `order_items`), `cancelarComanda` (spec 049, migración `0016`) y `anularMesa`. Esta spec **copia esa forma**, no inventa una nueva.
- **El motivo obligatorio validado server-side** ya está en `aplicarPropinaYDescuento`: *"El descuento requiere un motivo."* Mismo criterio.
- **Los gates por rol** viven en [`can.ts`](../../src/lib/permissions/can.ts). `canCancelItem` y `canModifyPostEnvio` ya devuelven `admin || encargado`. Se suma uno hermano.
- **`order_items.loaded_by`** ya registra quién cargó la línea. El override registra su propio actor porque puede no ser el mismo (el mozo carga, el encargado ajusta).
- **La edición post-envío** (`editarItemComanda`, spec 049) ya sabe re-snapshotear `unit_price_cents` y recalcular `subtotal_cents` + totales de la orden. El override entra como un campo más de ese patch.
- **El ticket de cocina no lleva precios** ([`ticket.ts`](../../src/lib/print/ticket.ts)) — la comanda no cambia en nada.

### Decisiones tomadas (Juan, 2026-07-30)

| Decisión | Resuelto |
|---|---|
| **Quién** | Solo **encargado / admin**. Gate nuevo `canOverrideItemPrice(role)`, hermano de `canCancelItem`. El mozo ve el precio efectivo pero no lo puede tocar. |
| **Tope** | **Libre**: cualquier entero ≥ 0, incluso $0 y **por encima** del precio de lista (plato fuera de carta más caro). Sin cap por porcentaje. El control es el rol + el registro, no un límite duro. |
| **Alcance** | **Al cargar** (antes de enviar) **y editando después** (ítem ya enviado, vía spec 049). |
| **Motivo** | **Texto libre obligatorio**, igual que anular mesa / cancelar ítem. Sin lista predefinida en fase 1. |

## User Scenarios & Testing

### User Story 1 — Cambiar el precio al cargar el producto (Priority: P1)

Como **encargado**, mientras cargo un pedido, toco el precio de una línea del carrito, escribo el precio que se va a cobrar por **esta vez** y el motivo, y la línea queda con ese precio. Al enviar, la mesa se cobra con el precio que puse. El catálogo no se toca.

**Why this priority**: Es el pedido literal. Sin esto no hay feature.

**Independent Test**: Cargar una línea con `price_override_cents` + `price_override_reason` desde `enviarComanda` con rol encargado → el `order_item` queda con `unit_price_cents` = el override, `price_original_cents` = el precio de catálogo, y `price_override_at` / `_by` / `_reason` poblados.

**Acceptance Scenarios**:

1. **Dado** un producto de $10.000 en el carrito, **Cuando** el encargado le pone $0 con motivo "cortesía — plato quemado" y envía, **Entonces** el `order_item` queda `unit_price_cents = 0`, `price_original_cents = 1000000`, `price_override_reason = "cortesía — plato quemado"`, `price_override_by = <user>`, y el total de la mesa no incluye esa línea.
2. **Dado** un producto de $10.000, **Cuando** el encargado le pone $18.000 con motivo "pescado del día", **Entonces** se acepta (el override puede ser **mayor** al de lista) y el subtotal de la línea es `18000 * qty`.
3. **Dado** un override con motivo vacío o solo espacios, **Cuando** se envía, **Entonces** se rechaza: *"El cambio de precio requiere un motivo."* — y **no se inserta nada** (ni la línea a precio de lista: falla la acción entera).
4. **Dado** un **mozo** (no encargado), **Cuando** su cliente manda un `price_override_cents` (carrito manipulado o UI vieja), **Entonces** se rechaza: *"Tu rol no permite cambiar el precio de un ítem."* La UI del mozo directamente no ofrece el control.
5. **Dado** un override negativo o no entero, **Cuando** se envía, **Entonces** se rechaza por Zod antes de tocar la DB.
6. **Dado** una línea **con adicionales**, **Cuando** se le pone override, **Entonces** el override reemplaza **solo el precio base**: `subtotal = (override + Σ mods) * qty`. Los adicionales conservan su precio (son líneas de catálogo aparte). Se documenta en la UI.
7. **Dado** el **checkout público** (cliente final), **Cuando** el payload trae `price_override_cents`, **Entonces** el campo se **ignora** por completo — nunca llega a `persist-order`. El comensal no puede fijar precios ni con sesión.

---

### User Story 2 — Corregir el precio de un ítem ya enviado (Priority: P2)

Como **encargado**, sobre un ítem ya enviado a cocina, abro «Editar» y ajusto el precio con motivo. El total de la mesa se recalcula. Cubre el caso frecuente de que el error se detecta recién al cobrar.

**Why this priority**: Sin esto, el error visto tarde obliga a anular el ítem y recargarlo, que reimprime en cocina un plato que ya salió.

**Independent Test**: `editarItemComanda(slug, itemId, { priceOverrideCents, priceOverrideReason })` con rol encargado → el ítem refleja el nuevo precio, `price_original_cents` **conserva el precio de catálogo original** (no se pisa) y el total de la orden se recalcula.

**Acceptance Scenarios**:

1. **Dado** un ítem enviado a $10.000, **Cuando** el encargado lo baja a $6.000 con motivo, **Entonces** `unit_price_cents = 600000`, `price_original_cents = 1000000` y `orders.total_cents` baja.
2. **Dado** un ítem **que ya tenía** un override a $6.000, **Cuando** el encargado lo vuelve a cambiar a $4.000, **Entonces** `price_original_cents` **sigue siendo el precio de catálogo** ($10.000, no $6.000): el delta reportado es siempre contra la lista, no contra el override anterior. El motivo y el actor se pisan con los últimos.
3. **Dado** un ítem con override, **Cuando** el encargado le **cambia el producto** en el mismo patch (spec 049 FR-009), **Entonces** el override **se limpia** y la línea toma el precio de lista del producto nuevo — salvo que el mismo patch traiga un override explícito con su motivo.
4. **Dado** un ítem **cancelado**, **Cuando** se intenta cambiar el precio, **Entonces** se rechaza (ya lo hace 049).
5. **Dado** una orden `lifecycle_status != "open"` (ya cerrada / cobrada), **Cuando** se intenta cambiar el precio, **Entonces** se rechaza: *"La orden ya está cerrada."* La plata cobrada no se reescribe.

---

### User Story 3 — Que quede registro y se pueda leer (Priority: P2)

Como **dueño**, quiero ver en el reporte todos los cambios de precio del período: qué ítem, precio de lista, precio cobrado, diferencia, motivo, quién y cuándo. Es control de fuga de plata, que es el punto de que exista el motivo.

**Why this priority**: Juan lo pidió explícito ("tendría que quedar registro"). Un registro que nadie puede leer no es un registro.

**Acceptance Scenarios**:

1. **Dado** el reporte de un rango, **Cuando** hubo overrides, **Entonces** aparece la sección **«Precios modificados»** con una fila por ítem: producto, mesa/pedido, precio de lista, precio cobrado, **delta**, motivo, quién, cuándo — ordenada por delta absoluto descendente.
2. **Dado** un delta negativo (se cobró de menos), **Cuando** se muestra, **Entonces** se ve como plata resignada; un delta positivo se ve como recargo. El total de la sección los suma por separado, no netea.
3. **Dado** que no hubo ningún override en el rango, **Cuando** se abre el reporte, **Entonces** la sección no se renderiza (no ensucia con un panel vacío).
4. **Dado** un rol sin acceso a reportes, **Cuando** entra, **Entonces** no ve la sección (reusa `canSee`, no se toca).

### Edge Cases

- **Combos / menú del día** (`kind: "daily_menu"`, `is_combo_component`, `parent_order_item_id`): **fuera de alcance en fase 1**, mismo criterio que la edición del spec 049 — el precio vive en el padre y los hijos van a $0; un override ahí rompe el desglose. La UI no ofrece el control en esas líneas y la action las rechaza por defensa.
- **Ítems con `track_stock`** (bebidas, vinos): el override **sí aplica**. El descuento de stock es por cantidad, no por precio — el trigger `fn_stock_descuento_on_order_item` no se toca.
- **Override + descuento de cuenta**: son ortogonales y **se acumulan**. Un ítem a mitad de precio dentro de una cuenta con 10% de descuento paga la mitad, menos 10%. No se intenta unificarlos.
- **Costeo / ingeniería de menú**: el margen del producto pasa a calcularse sobre lo efectivamente cobrado, que es lo correcto — hoy está inflado. Se anota como cambio de comportamiento esperado, no como bug.
- **Facturación ARCA**: la línea se factura al precio efectivo. Es lo fiscalmente correcto (se factura lo que se cobra) y **no requiere cambios** en `src/lib/afip` — el gateway ya lee `unit_price_cents`.
- **Carrito persistido**: el override viaja en el `CartItem` de `localStorage`. Sobrevive un reload, igual que la nota y los adicionales. Aceptado.
- **Traslado de ítems entre cuentas** (spec 056) y **traslado de mesa** (spec 048): el `order_item` se mueve entero con sus columnas de override. Nada que hacer.
- **Concurrencia**: dos overrides sobre el mismo ítem → gana el último (last-write-wins sobre la fila). No hay contador ni versionado; el caso real (dos encargados ajustando el mismo plato al mismo tiempo) no justifica optimistic locking.

## Requirements

### Datos

- **FR-001**: Migración `0030_precio_override_por_item.sql`, **aditiva**, sobre `order_items`:
  - `price_original_cents integer null` — precio de **catálogo** al momento del override. `null` = nunca se tocó el precio.
  - `price_override_at timestamptz null` — discriminador canónico de "esta línea tiene precio modificado".
  - `price_override_by uuid null references auth.users(id)`.
  - `price_override_reason text null`.
  - Índice parcial `idx_order_items_price_override on order_items (order_id) where price_override_at is not null`, para que el reporte no escanee toda la tabla.
  - `comment on column` en las cuatro, explicando que `unit_price_cents` es siempre **el precio efectivamente cobrado** y `price_original_cents` el de lista.
  - Aplicar al cloud (`tjfufswzsxfujcpoxapx`) por MCP + verificar por SQL. Regenerar `database.types.ts` por MCP (⚠️ `pnpm db:types` está roto).
- **FR-002**: Ninguna fila existente se toca. `price_override_at is null` en todo el histórico → los reportes viejos no cambian.

### Permisos

- **FR-003**: `canOverrideItemPrice(role: BusinessRole): boolean` en [`can.ts`](../../src/lib/permissions/can.ts) MUST devolver `role === "admin" || role === "encargado"`, con test en `can.test.ts` cubriendo los cuatro roles.

### Carga (US1)

- **FR-004**: `EnviarComandaItem` suma `price_override_cents?: number | null` y `price_override_reason?: string | null`. El schema Zod MUST exigir entero ≥ 0 y motivo con `trim()` no vacío **si viene el precio**; y rechazar motivo sin precio.
- **FR-005**: `enviarComanda` MUST, cuando una línea trae override: gate `canOverrideItemPrice(ctx.role)` (rechazo con mensaje explícito), y en el insert setear `unit_price_cents = override`, `price_original_cents = product.price_cents`, `price_override_at = now()`, `price_override_by = user.id`, `price_override_reason = motivo.trim()`.
- **FR-006**: El subtotal MUST ser `(override + Σ price_delta_cents de mods) * quantity`. El override reemplaza **solo la base**.
- **FR-007**: `enviarComanda` MUST rechazar override sobre líneas `kind: "daily_menu"` (fase 1).
- **FR-008**: `cargarPedidoStaff` (mostrador / delivery / take-away, specs 054/058) MUST aceptar el override con el mismo gate y la misma validación, propagándolo a `persist-order`.
- **FR-009**: `persist-order` MUST aceptar el override **solo** por el camino de staff. Los llamadores públicos (checkout del cliente, chatbot) NO pasan el campo y `persist-order` no lo lee de su input público. Un test blinda que un payload público con `price_override_cents` termina en la línea a **precio de lista**.

### Edición post-envío (US2)

- **FR-010**: `editarItemComanda` (spec 049) suma `patch.priceOverrideCents?: number | null` y `patch.priceOverrideReason?: string | null`, con gate `canOverrideItemPrice` **además** del `canModifyPostEnvio` que ya tiene.
- **FR-011**: Al aplicar el override en edición, `price_original_cents` MUST setearse **solo si es `null`** (primer override) — un segundo cambio no lo pisa. `price_override_at` / `_by` / `_reason` sí se pisan con los del cambio actual.
- **FR-012**: `patch.priceOverrideCents === null` explícito MUST **revertir** la línea al precio de catálogo actual del producto y limpiar las cuatro columnas (botón «Volver al precio de lista»). No requiere motivo.
- **FR-013**: Si el patch cambia `productId` y **no** trae override explícito, las cuatro columnas se limpian y la línea toma el precio de lista del producto nuevo.
- **FR-014**: Tras cualquiera de estos casos, `subtotal_cents` del ítem y `orders.subtotal_cents` / `total_cents` MUST recalcularse con el criterio existente.

### UI (US1, US2)

- **FR-015**: En el carrito del panel de carga ([`pedir-client.tsx`](../../src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx) y [`cargar-pedido-sheet.tsx`](../../src/components/admin/cargar-pedido-sheet.tsx)), cada línea de producto MUST mostrar un control de precio **solo si `canOverrideItemPrice(role)`**. Para el mozo el precio se ve pero no es interactivo.
- **FR-016**: El control abre un modal con: precio de lista (referencia, no editable), **precio nuevo** (teclado numérico, mobile-first, principio 2) y **motivo** (texto libre, obligatorio, `autofocus` tras el precio). El botón de confirmar MUST estar deshabilitado con motivo vacío. Botón «Volver al precio de lista» si ya hay override.
- **FR-017**: Una línea con override MUST verse **distinta de un vistazo**: precio de lista tachado + precio nuevo destacado + el motivo en chico debajo. Sin hover ni tooltip — en un salón nadie hace hover.
- **FR-018**: El modal de edición post-envío del spec 049 suma el mismo control, con **loading explícito, no optimista** (frontera de plata, spec 21).
- **FR-019**: La **cuenta** ([`cuenta-client.tsx`](../../src/app/[business_slug]/mozo/mesa/[id]/cuenta/cuenta-client.tsx)) MUST marcar las líneas con precio modificado, para que quien cobra sepa por qué ese número no coincide con la carta.

### Reporte (US3)

- **FR-020**: `getPriceOverrides(businessId, startIso, endIso)` en `src/lib/admin/` MUST devolver las líneas con `price_override_at` en el rango, scopeadas por `orders.business_id`, excluyendo órdenes canceladas: `{ product_name, quantity, price_original_cents, unit_price_cents, delta_cents, reason, actor_name, at, order_ref }`.
- **FR-021**: `PriceOverridesSection` en `/admin/reportes` MUST renderizar la tabla ordenada por `abs(delta_cents)` desc, con dos totales separados (resignado / recargado) y **no renderizar nada** si la lista está vacía.

## Key Entities

- **`order_items`**: cuatro columnas nuevas (`price_original_cents`, `price_override_at`, `price_override_by`, `price_override_reason`) — migración `0030`, aditiva. `unit_price_cents` **cambia de significado documentado**: pasa de "precio de catálogo snapshoteado" a "precio efectivamente cobrado".
- **`can.ts`**: `canOverrideItemPrice`.
- **Carrito** (`stores/cart.ts`): `CartItem` suma `price_override_cents?` y `price_override_reason?`.

## Non-Goals (fuera de alcance)

- **Lista de motivos predefinidos por negocio.** Decisión de Juan: texto libre en fase 1. Cuando haya datos reales de qué escriben, se arma la lista y se migra (fase 2).
- **Tope por porcentaje o autorización de un superior.** El control es el rol + el registro. Si aparece fuga real, el cap entra después con los datos del reporte en la mano.
- **Override en combos / menú del día.** Fase 2, junto con la edición de combos que el spec 049 también dejó afuera.
- **Cambiar el precio del catálogo desde el salón.** Esto es explícitamente *"solo por ese pedido"*. El catálogo se edita en `/admin/catalogo`.
- **Historial de N overrides sobre la misma línea.** Se guarda el estado actual + el precio de lista original. Si hace falta la traza completa, es una tabla `order_item_price_events` en fase 2 — no se justifica hoy.
- **Notificar al mozo / al dueño en el momento** del cambio de precio. El registro es el reporte; el push instantáneo es ruido.
- **Aplicar el override a futuras cargas del mismo producto en la misma mesa.** Cada línea se decide sola.

## Success Criteria

- **SC-001**: El encargado carga un producto, le cambia el precio con motivo y envía; la mesa se cobra con ese precio y el catálogo queda intacto.
- **SC-002**: Un override a $0 y uno **por encima** del precio de lista se aceptan; un override sin motivo, negativo, o hecho por un mozo, se rechazan server-side.
- **SC-003**: El encargado corrige el precio de un ítem ya enviado y puede volverlo al precio de lista; los totales de la orden se recalculan en ambos sentidos.
- **SC-004**: El reporte del período lista todos los cambios de precio con delta, motivo, quién y cuándo.
- **SC-005**: Un payload del checkout público con `price_override_cents` se ignora y la línea entra a precio de lista (test explícito).
- **SC-006**: `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes y `pnpm test` sin regresiones, con tests que blindan FR-004..FR-014 y FR-020. Verify en vivo con **rol real** (encargado): cargar con override, cobrar, y ver la fila en el reporte.
