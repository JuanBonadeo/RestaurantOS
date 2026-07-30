# Feature Specification: Cobro unificado del pedido sin mesa + corregir un pago ya registrado

**Feature Branch**: `060-cobro-pedido-unificado-y-editar-pago`

**Created**: 2026-07-28

**Status**: 📝 Spec — pendiente de aprobación. Issue [#91](https://github.com/gachetponzellini/RestaurantOS-app/issues/91). Milestone: Post-demo · Growth & hardening.

> ⚠️ **La mitad A (cobro unificado) quedó reemplazada por [spec 062](../062-motor-de-cobro-unificado/)** (2026-07-28, [#96](https://github.com/gachetponzellini/RestaurantOS-app/issues/96)). Acá se proponía reusar `CobrarDesktopClient` para el pedido sin mesa; Juan pidió ir más lejos — **un solo motor de cobro para las cuatro UIs**, parametrizado por lo que hay que cobrar. Todo lo de la mitad A (FR-001 a FR-006, US1) se cumple allá y **no se implementa desde acá**.
>
> **Esta spec queda con la mitad B: corregir un pago ya registrado** (US2, US3, FR-007 a FR-018) — independiente del refactor y todavía vigente.
>
> ⚠️ **La mitad B también quedó reemplazada, por [spec 070](../070-caja-correccion-de-lineas-y-libro/)** (2026-07-30, [#106](https://github.com/gachetponzellini/RestaurantOS-app/issues/106)). Nunca se implementó (`corregirPago` y `payments_audit_log` no existen en el código), y Juan pidió además **el monto y el mozo atribuido** + un **libro de movimientos** como puerta de entrada. La 070 absorbe todo lo de acá. **Esta spec queda cerrada — no se implementa nada desde ella.**

**Input**: Pedido de Juan 2026-07-28 — *"hay un gran problema de los pedidos que crea el encargado, la forma del pago es inmanejable, yo reutilizaría el cobro de las mesas, y también se tendría que poder editar el pago, que a veces ponen efectivo y después pagan con otra cosa"*. Decidido con Juan (misma fecha): (1) **editar = corregir el pago in-place** con auditoría, no anular y rehacer; (2) el alcance del editar es **cualquier pago de una caja con el período abierto**, no sólo los pedidos del board.

Cierra la divergencia que dejó [spec 054](../054-cargar-pedido-para-llevar/) y extiende el motor de cobro de [features/cobros.md](../../../wiki/features/cobros.md).

## Contexto y problema

### Problema 1 — el pedido del encargado se cobra distinto que todo lo demás

El encargado carga un pedido para llevar / delivery desde el board (spec 054) y lo cobra desde el detalle con **un sheet propio**, [`cobrar-pedido-sheet.tsx`](../../src/components/admin/cobrar-pedido-sheet.tsx). Ese sheet es un mínimo deliberado que ya no alcanza:

| | Cobro de mesa | Venta de mostrador (058) | **Pedido del board (054)** |
|---|---|---|---|
| Pago mixto / splits | ✅ | — (1 gesto) | ❌ un solo pago por el total |
| Propina | ✅ | ✅ | ❌ fija en 0 |
| MP link / QR | ✅ | ❌ | ❌ |
| Recargo/descuento por método (`payment_method_configs`) | ✅ | ✅ | ❌ **no se aplica** |
| Elegir monto (pago parcial) | ✅ | — | ❌ |
| Anular el cobro | ✅ | — | ❌ no expuesto |

La fila que más duele es la del **recargo**: el mismo negocio, el mismo método, cobra un precio en la mesa y otro en el pedido. Las otras convierten en "inmanejable" cualquier caso que no sea *una persona paga todo junto en efectivo*: dos personas que se dividen un delivery, el que deja propina, el que quiere pagar con link de MP.

El sheet se escribió aparte con una razón que **ya no es cierta**: su comentario dice que el cobro de mesa "está acoplado a `table_id`". El cobro de mesa **desktop** recibe `tableId` y lo descarta — [`cobrar-desktop-client.tsx:93`](../../src/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.tsx) es literalmente `void _tableId`; lo único que usa de la mesa es `tableLabel`, para el título. El motor debajo tampoco necesita mesa: `registrarPago` acepta `splitId: null` y `closeOrderIfFullyPaid` ([`cobro-actions.ts:137`](../../src/lib/billing/cobro-actions.ts)) saltea la liberación de mesa cuando no hay mesa. **La unificación es cambiar quién se renderiza, no reescribir el cobro.**

### Problema 2 — un pago mal cargado no se puede corregir

Caso real de Juan: *"a veces ponen efectivo y después pagan con otra cosa"*. El pago ya está registrado como `cash` y el cliente termina pagando con tarjeta.

Hoy no hay forma de corregirlo. Lo único que existe es `anularCobro` ([`cobro-actions.ts:723`](../../src/lib/billing/cobro-actions.ts)): marca **todos** los pagos de la orden como `refunded`, resetea los splits, reabre la orden y devuelve la mesa a `pidio_cuenta`. Para arreglar un método equivocado eso es: pedir motivo, deshacer el cobro entero, volver a cobrar todo, y si ya se emitió factura queda un comprobante contra una orden que se reabrió. Además **no está expuesto** en el sheet del pedido, así que ahí ni siquiera es una salida.

La consecuencia no es cosmética: **el método define el arqueo**. [`expected-cash.ts:11`](../../src/lib/caja/expected-cash.ts) suma únicamente `method === 'cash'`, y [`getCajaLiveStats`](../../src/lib/caja/queries.ts) reparte las ventas por método. Un efectivo que en realidad fue tarjeta hace que el efectivo esperado del corte esté inflado por ese monto: la caja cierra con una diferencia que nadie puede explicar, y el encargado termina "acomodando" el conteo. Un sistema cuyo principio es *"todo peso que entra se registra y se puede auditar"* no puede obligar a eso.

### Lo que ya existe y se reusa

- **Cobro completo desacoplado de la mesa:** `CobrarDesktopClient` (`embedded`) — splits, pago mixto, propina, MP link/QR con polling, recargos por método, anular cobro, botón deshabilitado mientras el cobro está en vuelo (spec 41). Se usa hoy en el panel del salón (spec 23).
- **Motor sin mesa:** `iniciarCobro` / `registrarPago(splitId: null)` / `closeOrderIfFullyPaid` / RPC `registrar_pago_tx` (migración 0007, idempotente por `request_id`).
- **Guarda del período de caja:** `getUltimoCorte(cajaId, businessId)` + `periodo_desde` ([`caja/queries.ts:250`](../../src/lib/caja/queries.ts)) — ya define qué pagos entran en el arqueo vigente. Es el mismo corte que decide qué se puede corregir.
- **Patrón de auditoría:** `tables_audit_log` ([baseline `0001`](../../supabase/migrations/0001_baseline.sql)) — `from_value` / `to_value` / `by_user_id` / `reason`.
- **Gate de encargado:** `canCancelItem(role)` (admin/encargado), el mismo que ya protege `anularCobro` y `cancelarSplit`.
- **Listado de cobros del período:** el board de caja ya trae los `payments` del período para la rendición ([`caja-admin-board.tsx:803`](../../src/components/admin/local/caja-admin-board.tsx)).

### Lo que falta (objeto de esta spec)

1. Que el pedido sin mesa se cobre con **el mismo cobro que una mesa**, sin perder el bloque de comprobante que hoy vive sólo en su sheet.
2. Un action **`corregirPago`** que cambie el método (y sus datos) de un pago ya registrado, con guardas y auditoría.
3. Una **tabla de auditoría de pagos** — hoy `payments` no tiene ni `updated_at`.
4. La **entrada de UI** para corregir, en los dos lugares donde el encargado se da cuenta del error: el cobro de la orden y el board de caja.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Cobrar un pedido sin mesa como se cobra una mesa (Priority: P1)

Como **encargado**, abro un pedido para llevar del board y toco «Cobrar». Veo **el mismo cobro que en una mesa**: puedo dividir, cobrar en dos métodos, cargar la propina, mandar un link de MP, y el recargo de tarjeta se aplica igual que en el salón.

**Why this priority**: Es la mitad del pedido de Juan y la que hoy cobra mal (recargo no aplicado = plata).

**Independent Test**: Renderizar el cobro sobre una orden con `table_id = null` → se listan cajas, métodos con su ajuste, y `registrarPago` cierra la orden sin tocar ninguna mesa.

**Acceptance Scenarios**:

1. **Dado** un pedido sin mesa con total $10.000 y `card_manual` configurado con +10%, **Cuando** el encargado cobra con tarjeta, **Entonces** se registra `amount_cents = 11.000`, `adjustment_percent = 10` y `adjustment_cents = 1.000` — **igual que en la mesa** (hoy se registran $10.000 y ajuste 0).
2. **Dado** el mismo pedido, **Cuando** el encargado divide en 2 y cobra uno en efectivo y otro con tarjeta, **Entonces** quedan 2 `payments` contra la orden y la orden cierra recién con el segundo.
3. **Dado** un cobro parcial, **Cuando** se registra el primer pago, **Entonces** la orden sigue `open` y el panel muestra el saldo — no se cierra a la fuerza.
4. **Dado** un pedido ya cobrado, **Cuando** el encargado toca «Anular cobro» con motivo, **Entonces** los pagos pasan a `refunded` y la orden reabre (hoy esa acción no existe en el pedido).
5. **Dado** un pedido sin mesa, **Cuando** se cobra, **Entonces** **ninguna** mesa cambia de `operational_status` y no se rompe ningún flujo del salón.
6. **Dado** el encargado que necesita Factura A, **Cuando** cobra el pedido, **Entonces** puede cargar CUIT + condición IVA y emitir el comprobante — **no se pierde** lo que hoy da `CobrarPedidoSheet` (spec 053).
7. **Dado** un pago con MP link/QR sobre un pedido sin mesa, **Cuando** el cliente paga, **Entonces** el webhook lo acredita y cierra la orden por el camino ya existente.

---

### User Story 2 — Corregir el método de un pago mal cargado (Priority: P1)

Como **encargado**, veo que un cobro quedó cargado como efectivo pero el cliente pagó con tarjeta. Abro el pago, toco **«Corregir»**, elijo *Tarjeta*, cargo los últimos 4 dígitos y confirmo. El arqueo se acomoda solo y queda registrado quién lo cambió y de qué a qué.

**Why this priority**: Es la otra mitad del pedido, y sin esto el arqueo miente todos los días.

**Independent Test**: `corregirPago({ paymentId, method: 'card_manual', last_four, motivo })` con rol encargado → la fila cambia de método, se inserta un renglón de auditoría, y `getCajaLiveStats` mueve el monto de `cash` a `card_manual` sin cambiar el total de ventas.

**Acceptance Scenarios**:

1. **Dado** un pago `cash` de $8.000 en una caja con el período abierto, **Cuando** el encargado lo corrige a `card_manual`, **Entonces** `expected_cash_cents` baja $8.000, `ventas_por_metodo` mueve el monto, y `total_ventas_cents` **no cambia**.
2. **Dado** ese mismo cambio, **Cuando** se confirma, **Entonces** queda un renglón en `payments_audit_log` con `from_value = 'cash'`, `to_value = 'card_manual'`, el usuario y el timestamp.
3. **Dado** un pago cuya caja **ya se arqueó** (su `created_at` es anterior al último corte), **Cuando** se intenta corregir, **Entonces** se rechaza: *"Ese cobro ya entró en un arqueo cerrado. Anulá el cobro y volvé a registrarlo."*
4. **Dado** un **mozo** o personal, **Cuando** intenta corregir un pago, **Entonces** se rechaza (gate encargado/admin).
5. **Dado** un pago de **otro negocio**, **Cuando** se pasa su id con el slug propio, **Entonces** se rechaza (scope `business_id`).
6. **Dado** un pago `mp_link` acreditado por el webhook, **Cuando** se intenta cambiarle el método, **Entonces** se rechaza: la plata la confirmó Mercado Pago y `mp_payment_id` la ata a esa acreditación. Tampoco se puede convertir un pago manual **a** `mp_link`/`mp_qr`.
7. **Dado** un pago `pending` (MP en curso) o `refunded`, **Cuando** se intenta corregir, **Entonces** se rechaza — sólo se corrige lo que está `paid`.
8. **Dado** un cambio a `card_manual`, **Cuando** se confirma sin últimos 4 dígitos, **Entonces** se acepta igual (los 4 dígitos son opcionales, como en el cobro) pero si se cargan deben ser 4 dígitos.
9. **Dado** un negocio con dos cajas, **Cuando** el encargado corrige la **caja** del pago (se cobró en barra y se cargó en principal), **Entonces** el monto se mueve de un arqueo al otro y **ambas** cajas deben tener el período abierto.

---

### User Story 3 — Ver qué se corrigió (Priority: P2)

Como **admin**, quiero ver en el detalle del pago (y en el corte de caja) que hubo una corrección, quién la hizo y por qué, para que "el arqueo dio bien" no dependa de la memoria de nadie.

**Acceptance Scenarios**:

1. **Dado** un pago corregido, **Cuando** el admin lo abre, **Entonces** ve el historial: *cash → card_manual, por Fulano, 21:14, motivo*.
2. **Dado** un pago nunca corregido, **Cuando** se abre, **Entonces** no se muestra ninguna sección de historial (sin ruido).

---

### Edge cases

- **Corregir hacia un método con otro recargo.** Cambiar de efectivo (0%) a tarjeta (+10%) cambiaría lo que debería haber pagado el cliente. **Decisión: el monto no se toca.** Lo que entró en la caja es lo que entró; se corrige *cómo* entró, no *cuánto*. Si además cambió el monto → anular y volver a cobrar. La UI avisa cuando el método destino tiene un ajuste configurado distinto al del pago (FR-014).
- **Monto y propina.** Fuera del alcance de P1: cambiarlos obliga a recalcular `order_splits.paid_amount_cents`, `orders.total_paid_cents` y el cierre/reapertura de la orden, además de la liquidación del mozo. Queda anotado como P2 con su propio diseño.
- **Orden ya facturada.** Corregir el método **no** toca la factura: el comprobante AR no discrimina forma de pago en lo que se emite hoy. Se documenta explícitamente para que nadie asuma que hay que re-facturar.
- **Rendición del mozo ya cerrada.** El pago tiene `attributed_mozo_id`; corregir el método no cambia la propina, así que la liquidación no se mueve. Si en P2 se permite editar propina, esa guarda hay que agregarla.
- **Dos encargados corrigen el mismo pago a la vez.** Última escritura gana, pero **ambas** quedan en la auditoría — el rastro no se pierde.

## Requirements *(mandatory)*

### Cobro unificado (US1)

- **FR-001**: El pedido sin mesa DEBE cobrarse con el mismo componente y el mismo motor que una mesa (`CobrarDesktopClient` embebido), incluyendo splits, pago mixto, propina, MP link/QR y anular cobro.
- **FR-002**: El recargo/descuento de `payment_method_configs` DEBE aplicarse en el pedido sin mesa exactamente como en la mesa y en la venta de mostrador.
- **FR-003**: El bloque de comprobante (Factura B por defecto, A con CUIT + condición IVA, spec 053) DEBE seguir disponible al cobrar el pedido. Extenderlo al cobro de mesa queda fuera de alcance.
- **FR-004**: El título y los textos del panel NO DEBEN hablar de "mesa" cuando la orden no tiene mesa (hoy el componente dice *"Cobrar mesa"* y *"La mesa se va a marcar para limpiar"*).
- **FR-005**: El cobro de mesa y el del salón embebido NO DEBEN regresionar: mismos props, mismo comportamiento, mismos tests verdes sin editarlos.
- **FR-006**: `CobrarPedidoSheet` DEBE eliminarse una vez migrado (no queda un segundo camino de cobro conviviendo).

### Corregir un pago (US2)

- **FR-007**: DEBE existir `corregirPago({ paymentId, slug, method?, last_four?, card_brand?, caja_id?, notes?, motivo })` que actualice un pago ya registrado sin tocar montos.
- **FR-008**: SÓLO admin/encargado (mismo gate que `anularCobro`).
- **FR-009**: SÓLO pagos con `payment_status = 'paid'`.
- **FR-010**: SÓLO métodos manuales: origen y destino en `{cash, card_manual, transfer, other}`. Cualquier pago con `mp_payment_id` o método `mp_link`/`mp_qr` se rechaza, y no se puede convertir un pago manual a MP.
- **FR-011**: SÓLO pagos cuyo `created_at` sea posterior al último corte de su caja (período abierto). Si se cambia de caja, la condición aplica a **ambas**.
- **FR-012**: Todo cambio DEBE quedar en `payments_audit_log` (un renglón por campo cambiado) con `by_user_id`, `reason` y timestamp. La auditoría y el update DEBEN ser atómicos.
- **FR-013**: `motivo` es obligatorio y no vacío (mismo criterio que `anularCobro`).
- **FR-014**: Si el método destino tiene un `adjustment_percent` distinto al `adjustment_percent` del pago, la UI DEBE avisarlo antes de confirmar, aclarando que el monto no se modifica.
- **FR-015**: El scope `business_id` DEBE validarse server-side sobre el pago, la caja destino y la orden.
- **FR-016**: La UI de corrección DEBE estar disponible (a) sobre los pagos de la orden en el panel de cobro y (b) sobre los cobros del período en el board de caja.
- **FR-017**: Editar **monto** o **propina** está explícitamente FUERA de alcance en esta spec (P2). El mensaje de la UI DEBE ofrecer «Anular cobro» para esos casos.

### Datos

- **FR-018**: Migración nueva con `payments_audit_log` (`payment_id`, `business_id`, `order_id`, `field`, `from_value`, `to_value`, `by_user_id`, `reason`, `created_at`) + índice por `payment_id` y por `business_id, created_at`, + RLS coherente con el resto (lectura scopeada por negocio, escritura sólo service role).

### Key entities

- **`payments`** — no cambia de forma. Cambian los valores de `method` / `last_four` / `card_brand` / `caja_id` / `notes` de una fila ya existente.
- **`payments_audit_log`** *(nueva)* — el rastro de cada corrección. Es lo que hace que "corregir" sea auditable y no un borrado silencioso.

## Success Criteria *(mandatory)*

- **SC-001**: Un pedido sin mesa cobrado con tarjeta registra el mismo `amount_cents` que la misma cuenta cobrada en una mesa (hoy difieren por el recargo).
- **SC-002**: El encargado puede cobrar un pedido sin mesa en dos métodos distintos, cosa que hoy es imposible.
- **SC-003**: Corregir un método mal cargado toma ≤ 3 taps desde el board de caja y no requiere anular nada.
- **SC-004**: Tras una corrección, `expected_cash_cents` de la caja refleja el cambio inmediatamente y `total_ventas_cents` queda igual.
- **SC-005**: El 100% de las correcciones queda en `payments_audit_log`: no hay forma de cambiar un método sin dejar rastro.
- **SC-006**: Existe **un solo** camino de cobro de órdenes en el admin (el de mesa), sin sheet paralelo.

## Non-Goals

- Editar monto o propina de un pago (P2, requiere recalcular saldos y cierre de orden).
- Corregir pagos de arqueos ya cerrados (se resuelve anulando).
- Re-emitir o corregir facturas ARCA a partir de un cambio de método.
- Cambiar el motor de `registrarPago` / la RPC `registrar_pago_tx`.
- Llevar el bloque de comprobante al cobro de mesa (posible P3).
