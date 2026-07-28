# Feature Specification: Venta rápida de mostrador (kiosko / bar) — cargar y cobrar sin abrir mesa

**Feature Branch**: `058-venta-rapida-mostrador`

**Created**: 2026-07-28

**Status**: 📝 Spec — pendiente de aprobación. Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-28 — "habría que hacer un botón para cargar un pedido de kiosko/bar, donde no hace falta abrir una mesa… es para el encargado más que nada". Decidido con Juan (misma fecha): (1) **se carga y se cobra en un solo paso**; (2) el botón vive **en el salón** (tab «Salón» de operación), no en Pedidos ni en Caja; (3) **manda comanda sólo si el producto tiene sector** (regla que ya sale del modelado, [spec 08](../../../wiki/specs/08-caja-bar-venta-directa/)).

Extiende el motor de carga sin mesa de [spec 054](../054-cargar-pedido-para-llevar/) y el de cobro de [features/cobros.md](../../../wiki/features/cobros.md).

## Contexto y problema

Alguien se acerca a la barra, compra **un alfajor y una coca**, paga y se va. Hoy el encargado tiene tres caminos y **ninguno sirve**:

1. **Abrir una mesa de barra** (`tables.is_bar`, [spec 08](../../../wiki/specs/08-caja-bar-venta-directa/), implementado 2026-06-08): hay que seleccionar la mesa en el plano → «Pedir» → cargar → «Cuenta» → «Cobrar» → la mesa se libera. Son 5 pantallas y deja la mesa ocupada mientras dura la venta — si dos personas compran a la vez, se pisan.
2. **«Cargar pedido»** del board ([`orders-realtime-board.tsx:339`](../../src/components/admin/orders-realtime-board.tsx), spec 054): está pensado para **para llevar / delivery**. Obliga a pasar por la vista "datos" (tipo de entrega + cliente + teléfono/dirección, [`cargar-pedido-sheet.tsx:226`](../../src/components/admin/cargar-pedido-sheet.tsx)), el pedido cae en la columna "Nuevos" del board a esperar triage, y el cobro es un segundo gesto en otra card. Para una venta que ya se pagó, el board se ensucia con ruido.
3. **Pedido flash** ([`billing/pedido-flash.ts:29`](../../src/lib/billing/pedido-flash.ts)): es un renglón por **monto libre**, sin productos reales. No descuenta stock, no rutea a sector, no sirve para vender catálogo.

Resultado: la venta de kiosko/barra o se hace por fuera del sistema (plata suelta en la caja, sin registro) o cuesta cinco veces más de lo que debería en hora pico.

### Lo que ya existe y se reusa

- **Carga sin mesa (motor):** `persistOrder` ([`orders/persist-order.ts:36`](../../src/lib/orders/persist-order.ts)) crea la orden **sin `table_id`** con `order_items` reales, combos, modificadores, precios resueltos **en el server** y `mozoId` de auditoría. Hoy sólo acepta `delivery_type ∈ {delivery, pickup}`.
- **Gate del staff:** `cargarPedidoStaff` ([`orders/staff-order.ts:26`](../../src/lib/orders/staff-order.ts)) + `canCargarPedido` ([`permissions/can.ts:217`](../../src/lib/permissions/can.ts)) = admin/encargado. Es el gate exacto que pidió Juan.
- **Picker keyboard-first:** el sidebar de carga de spec 055 y su gemelo del board (`CargarPedidoSheet` fase 2): buscador con foco, ↓/↑/Enter, `ProductModal` para modificadores. Se reusa entero.
- **Cobro sin mesa (motor):** `iniciarCobro(orderId, slug)` ([`billing/cobro-actions.ts:263`](../../src/lib/billing/cobro-actions.ts)) devuelve cajas + `methodConfigs`; `registrarPago` ([`:347`](../../src/lib/billing/cobro-actions.ts)) acepta `splitId: null` (paga la orden entera); `closeOrderIfFullyPaid` ([`:137`](../../src/lib/billing/cobro-actions.ts)) cierra la orden y **saltea la liberación de mesa** cuando no hay mesa.
- **Ruteo por sector:** `routeOrderToCocina` ([`orders/route-to-cocina.ts:23`](../../src/lib/orders/route-to-cocina.ts)) resuelve el sector por ítem, **saltea los ítems sin sector** (`items_without_station`) y es idempotente. Alfajor/coca (sin sector) no imprimen; un tostado con sector sí sale a sanguchería — la regla que pidió Juan **sale sola**, sin código nuevo.
- **Facturación sin mesa:** `emitInvoice(orderId, …)` ([`afip/emit-invoice.ts:139`](../../src/lib/afip/emit-invoice.ts)) es 100% order-scoped.
- **El salón:** `salon-desktop.tsx` es un split plano + sidebar con **modos por prioridad** (paint > cobro > pedir > detalle > lista, [`:934`](../../src/components/admin/local/salon-desktop.tsx)). El header de la lista ya hospeda CTAs de encargado («Distribuir mozos», «Editar plano», [`:1476`](../../src/components/admin/local/salon-desktop.tsx)).

### Lo que falta (objeto de esta spec)

1. Un **botón «Venta rápida»** en el salón, visible sin seleccionar ninguna mesa.
2. Un **modo de sidebar** que combine picker + cobro en **una sola pantalla**.
3. Un **server action** que cree la orden de mostrador y la cobre **en un gesto**, dejándola cerrada.
4. Que esa orden **no ensucie** el board de pedidos ni el plano del salón.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Vender y cobrar en un gesto (Priority: P1)

Como **encargado**, desde la tab «Salón» toco **«Venta rápida»**. Se abre el panel lateral con el buscador enfocado: tipeo "alfa", Enter, tipeo "coca", Enter. Veo el total. Elijo **método de pago** y **caja**, toco **«Cobrar $X»** y listo — la venta queda registrada y cobrada, la caja la refleja, y el panel vuelve a quedar vacío listo para el siguiente cliente.

**Why this priority**: Es la feature. Sin esto la venta de barra sigue por fuera del sistema.

**Independent Test**: Llamar `venderMostrador(slug, { items, method, cajaId })` con rol encargado → se crea una `orders` con `table_id = null`, un `payments` `paid` por el total, y la orden queda `lifecycle_status = 'closed'`.

**Acceptance Scenarios**:

1. **Dado** el encargado en el salón, **Cuando** toca «Venta rápida», agrega 2 productos, elige efectivo + caja principal y confirma, **Entonces** se crea una orden sin mesa con 2 `order_items`, un `payments` paid por el total, y la orden queda cerrada.
2. **Dado** el mismo flujo, **Cuando** la venta se confirma, **Entonces** **ninguna mesa** cambia de `operational_status` (el plano queda igual).
3. **Dado** un carrito vacío, **Cuando** el encargado toca «Cobrar», **Entonces** se rechaza ("agregá al menos un producto").
4. **Dado** un negocio **sin cajas** cargadas, **Cuando** se abre el panel, **Entonces** se avisa que hay que crear una caja antes de vender (mismo criterio que `iniciarCobro`).
5. **Dado** un **mozo** o **personal**, **Cuando** intenta `venderMostrador`, **Entonces** se rechaza (gate `canCargarPedido` = admin/encargado).
6. **Dado** un producto de **otro negocio** en el payload, **Cuando** se intenta vender con el slug propio, **Entonces** se rechaza (scope `business_id`).
7. **Dado** que el cliente paga con tarjeta y el método tiene recargo configurado (`payment_method_configs`), **Cuando** se elige ese método, **Entonces** el ajuste se aplica y se persiste igual que en el cobro de mesa.

---

### User Story 2 — Que la venta no ensucie la operación (Priority: P1)

Como **encargado**, la venta de kiosko **no me aparece** en el board de pedidos esperando confirmación, ni ocupa una mesa en el plano. Ya está cobrada: sólo quiero verla en la **caja** y en la analítica del día.

**Why this priority**: Si cada coca vendida cae en "Nuevos" a esperar triage, el board deja de ser usable en hora pico — el problema que esta spec vino a resolver.

**Independent Test**: Tras `venderMostrador`, la orden **no** aparece en `getTodayOrders` ([`admin/orders-query.ts:49`](../../src/lib/admin/orders-query.ts), filtra `.neq("delivery_type","dine_in")`) ni en las queries del salón (que listan por `table_id`), pero **sí** suma en `getCajaLiveStats` del período.

**Acceptance Scenarios**:

1. **Dado** una venta rápida cobrada, **Cuando** se mira la tab «Pedidos», **Entonces** la orden **no** aparece en ninguna columna del board.
2. **Dado** una venta rápida cobrada, **Cuando** se mira el plano del salón, **Entonces** no hay ninguna mesa nueva ocupada.
3. **Dado** una venta rápida en efectivo, **Cuando** se mira la caja elegida, **Entonces** el `expected_cash` y las ventas del período la incluyen.

---

### User Story 3 — Los productos que se cocinan salen a su sector (Priority: P2)

Como **encargado**, si en la venta rápida cargo un **tostado**, la comanda sale sola a sanguchería. Si cargo un **alfajor y una coca**, no imprime nada.

**Why this priority**: Es la regla de negocio de la barra (§6 · §7.13 de la reunión, ya asentada en [spec 08](../../../wiki/specs/08-caja-bar-venta-directa/)). Sale del modelado del producto, no hay que inventar nada — pero hay que **invocar** el ruteo, que hoy no se invoca en este camino.

**Independent Test**: `venderMostrador` con un ítem de sector "sanguchería" + uno sin sector → `routeOrderToCocina` crea **1** comanda (la de sanguchería) y reporta `items_without_station = 1`.

**Acceptance Scenarios**:

1. **Dado** una venta de alfajor + coca (productos sin sector), **Cuando** se cobra, **Entonces** **no** se crea ninguna comanda ni se dispara impresión.
2. **Dado** una venta con un tostado (sector sanguchería), **Cuando** se cobra, **Entonces** se crea 1 comanda para ese sector y se dispara a imprimir.
3. **Dado** una venta mixta, **Cuando** se cobra, **Entonces** el fallo de la impresión **no** hace fallar la venta (la plata ya está registrada; la comanda queda en el kanban / reimprimible por spec 35).

---

### User Story 4 — Facturar la venta si el cliente la pide (Priority: P3)

Como **encargado**, si el cliente pide factura, la emito desde el mismo panel (o desde el detalle de la venta) sin volver a cargar nada.

**Why this priority**: `emitInvoice` ya es order-scoped y funciona sin mesa — es un botón, no un motor. Pero la mayoría de las ventas de kiosko no piden comprobante, así que no puede sumar fricción al camino feliz.

**Acceptance Scenarios**:

1. **Dado** una venta cobrada, **Cuando** el encargado toca «Facturar», **Entonces** se emite Factura B consumidor final por el total (sin propina), reusando `emitInvoice`.
2. **Dado** el camino feliz sin factura, **Cuando** se cobra, **Entonces** **no** se emite ni se pide ningún dato fiscal.

---

## Requisitos funcionales

- **FR-001** — Un botón **«Venta rápida»** en el header del sidebar del salón (`/admin/operacion?tab=salon`), visible sólo si el rol pasa `canCargarPedido` (admin/encargado).
- **FR-002** — El botón abre un **modo de sidebar** nuevo (`venta`) con picker de carta + carrito + selector de método/caja + botón «Cobrar $X», **todo en una pantalla**. Prioridad de modos: `paint > cobro > pedir > venta > detalle > lista` (no puede abrirse mientras se cobra o pide sobre una mesa).
- **FR-003** — El picker reusa el motor keyboard-first existente (buscador con foco, ↓/↑/Enter, `ProductModal` para modificadores). Sin paso de "datos del cliente".
- **FR-004** — Server action `venderMostrador({ slug, items, method, cajaId, tipCents? })`: gate `requireMozoActionContext` + `canCargarPedido`; **precios resueltos en el server** (nunca del payload); scope `business_id`.
- **FR-005** — La orden se crea con `delivery_type = 'dine_in'`, `table_id = null`, `customer_name = 'Mostrador'`, `mozo_id = <quien vendió>` (auditoría). Con `dine_in` queda **fuera** del board (que filtra `.neq('delivery_type','dine_in')`) y **fuera** del plano (que lista por `table_id`) — FR de la US2.
- **FR-006** — El cobro se registra con `registrarPago({ orderId, splitId: null, … })` y la orden se cierra vía `closeOrderIfFullyPaid`. Se respetan los `payment_method_configs` (recargo/descuento por método) igual que en el cobro de mesa.
- **FR-007** — **Atomicidad de la plata**: si el pago falla, la orden **no queda abierta y huérfana** — se cancela (`cancelled_at` + `cancelled_reason = 'venta rápida no cobrada'`). Una orden `dine_in` sin mesa y sin cerrar sería invisible en toda la UI: es el riesgo principal de esta spec.
- **FR-008** — Tras cobrar, se invoca `routeOrderToCocina`: crea comandas **sólo** para los ítems con sector resuelto. Un fallo del ruteo/impresión **no revierte** la venta (se loguea y se avisa por toast).
- **FR-009** — Tras cobrar, el panel se **resetea** (carrito vacío, buscador enfocado) y queda listo para la siguiente venta, sin cerrarse. En una barra las ventas vienen en fila.
- **FR-010** — Botón **«Facturar»** opcional sobre la venta recién cobrada, que llama `emitInvoice` con los defaults del negocio. Nunca bloqueante.

## Non-goals

- **Mesa de barra (`is_bar`)**: sigue existiendo tal cual para quien quiera abrir una cuenta en la barra. Esta spec **no la toca ni la reemplaza** — es el camino "abro cuenta y pago después"; venta rápida es "pago ya".
- **Cobro con splits / propina repartida**: la venta de mostrador es un pago único. Splits siguen siendo de la mesa (spec 06).
- **Rendición de mozos**: la venta de mostrador no se atribuye a un mozo (`attributed_mozo_id` queda null) — no entra en la rendición (spec 07).
- **Stock**: se comporta como `persistOrder` hoy; esta spec no cambia el descuento de stock (spec 10).
- **App del mozo**: el botón es de operación (encargado). Si más adelante el mozo lo necesita, es cambiar el gate.
