# Feature Specification: Corregir las líneas de la caja con motivo + libro de movimientos

**Feature Branch**: `070-caja-correccion-de-lineas-y-libro`

**Created**: 2026-07-30

**Status**: ✅ Implementada (2026-07-30) — todo el alcance (US1 a US6, incluidos los P2). `pnpm typecheck`, `pnpm lint` y `pnpm build` verdes; `pnpm test` 995 pass / 140 skip (los 16 `*.integration.test.ts` fallan por falta del stack Supabase local — preexistente, no hay Docker en esta máquina). Migraciones `0031` + `0032` aplicadas al cloud y **verificadas ejecutando las RPC contra la base real** dentro de una transacción que se revierte. **Pendiente: verify en vivo con rol real** (T024). Issue [#106](https://github.com/gachetponzellini/RestaurantOS-app/issues/106). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"hay que hacer una spec, para que las líneas de la caja sean editables, indicando un motivo, y que lo pueda hacer solo el encargado/admin, que puedan mover el monto, el método, y el mozo, creo que para esto también debería haber una lista de todos los movimientos"*.

> **Absorbe la mitad B de la [spec 060](../060-cobro-pedido-unificado-y-editar-pago/)** («corregir un pago ya registrado», FR-007 a FR-018), que quedó especificada pero **nunca implementada** — no existe `corregirPago` ni `payments_audit_log` en el código. Aquella spec dejaba el **monto** explícitamente fuera (FR-017, P2) y no contemplaba el **mozo**; Juan ahora pide las tres cosas. Se implementa una sola vez, acá. La 060 queda cerrada como reemplazada (la mitad A ya la había absorbido la [spec 062](../062-motor-de-cobro-unificado/)).

## Contexto y problema

### Una línea mal cargada no se puede corregir

Un cobro se registra una vez y queda escrito en piedra. Lo único que existe hoy es `anularCobro` ([`cobro-actions.ts:748`](../../src/lib/billing/cobro-actions.ts)): marca **todos** los pagos de la orden como `refunded`, resetea los splits, reabre la orden y devuelve la mesa a `pidio_cuenta`. Para arreglar un dato de una línea eso es: pedir motivo, deshacer el cobro entero, volver a cobrar todo, y si ya se emitió factura queda un comprobante contra una orden reabierta.

Los tres campos que se cargan mal en hora pico son exactamente los tres que pidió Juan:

- **El método.** *"A veces ponen efectivo y después pagan con otra cosa"* (Juan, 2026-07-28). El método define el arqueo: [`calculateExpectedCash`](../../src/lib/caja/expected-cash.ts) suma únicamente `method === 'cash'`. Un efectivo que en realidad fue tarjeta infla el efectivo esperado del corte por ese monto: la caja cierra con una diferencia que nadie puede explicar y el encargado termina "acomodando" el conteo.
- **El monto.** Un dedo de más al tipear ($15.000 en vez de $1.500) mete plata que no entró. El arqueo miente igual, con la diferencia de que además miente el total de ventas del turno y el mail de cierre que reciben los dueños ([spec 034](../034-mail-cierre-de-turno/)).
- **El mozo.** `payments.attributed_mozo_id` no lo elige nadie: lo **deriva** el server (`deriveAttributedMozo`) del último ítem cargado, con fallback al `mozo_id` de la mesa. Cuando un mozo carga algo en la mesa de otro, o cuando la mesa cambió de mozo a mitad de servicio, la atribución sale mal — y de ahí salen la **rendición por empleado** del board, `calcularRendicionMozo` y el "por mozo" del mail de cierre. Nadie puede corregirla hoy, ni siquiera anulando: al recobrar, el server la vuelve a derivar igual de mal.

El principio del producto es *"todo peso que entra se registra y se puede auditar"*. Un sistema que obliga a elegir entre **dejar el dato mal** o **deshacer un cobro entero** no lo cumple: en la práctica gana lo primero, porque en hora pico nadie deshace un cobro para arreglar una letra.

### No hay dónde ver las líneas

El board de caja ([`caja-admin-board.tsx`](../../src/components/admin/local/caja-admin-board.tsx)) ya tiene un panel **«Movimientos del período»** que mezcla cobros (`CobroRow`) y sangrías/ingresos (`MovimientoRow`) ordenados por hora. Es lo correcto conceptualmente, pero como registro tiene cuatro límites duros:

1. **Sólo el período abierto** de **una** caja: apenas se hace el corte, todo lo anterior desaparece de la pantalla. No hay ninguna vista en el panel que muestre los movimientos de ayer.
2. **Sólo lo que salió bien**: `getPaymentsPeriodoActual` filtra `payment_status = 'paid'`, así que un cobro **anulado** no aparece en ningún lado. La anulación es justamente lo que hay que poder auditar.
3. **No se puede filtrar ni buscar** (por método, por mozo, por caja, por monto).
4. **Las líneas no son accionables**: son `<li>` de lectura. No hay dónde colgar «Corregir».

Sin esa lista, la corrección no tiene puerta de entrada: el encargado se da cuenta del error **mirando la caja**, no mirando la orden.

### Lo que ya existe y se reusa

- **La lista unificada** cobros + movimientos ya está resuelta y ordenada por hora en el board (`entries`); el libro es la misma idea con rango, filtros y línea accionable.
- **La ventana del período**: `getUltimoCorte(cajaId, businessId)` ([`caja/queries.ts:250`](../../src/lib/caja/queries.ts)) ya define qué entra en el arqueo vigente. Es el mismo corte que decide qué se puede corregir.
- **El patrón "acción sensible + motivo obligatorio + quién + cuándo"**: `anularCobro`, `cancelarItem`, `cancelarComanda` ([spec 049](../049-comandas-encargado-anular-editar/)), `anularMesa`. Esta spec copia esa forma.
- **La atomicidad sobre plata**: `registrar_pago_tx` (migración [`0007`](../../supabase/migrations/0007_cobro_idempotente_transaccional.sql)) ya fijó el criterio — lo que toca pagos + splits + orden va en **una RPC transaccional**, no en tres updates sueltos desde TS.
- **Los gates por rol** viven en [`can.ts`](../../src/lib/permissions/can.ts): `canCancelItem` y `canHacerCorte` ya devuelven `admin || encargado`.
- **El recálculo de cierre**: `closeOrderIfFullyPaid` ([`cobro-actions.ts:137`](../../src/lib/billing/cobro-actions.ts)) ya sabe decidir si una orden quedó saldada y hacer la transición de mesa. Una corrección hacia arriba lo reusa tal cual.
- **La frontera "plata nunca optimista"** ([spec 021](../21-ui-optimista-operacion/)): la corrección se confirma con loading explícito, no con `useOptimistic`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — El libro de movimientos (Priority: P1)

Como **encargado**, entro a «Movimientos» desde el board de caja y veo **todas las líneas** — cobros, sangrías e ingresos — de un rango de fechas, de todas las cajas o de una, con lo anulado y lo corregido a la vista. Puedo filtrar por método, por mozo y por caja, y buscar.

**Why this priority**: Es donde se detecta el error y es la única puerta a la corrección. Sin esto, US2–US4 no tienen UI.

**Independent Test**: Entrar al libro con rango «hoy» → aparecen los mismos cobros que el board **más** los anulados, con su motivo y quién los anuló.

**Acceptance Scenarios**:

1. **Dado** un rango con cobros y sangrías, **Cuando** abro el libro, **Entonces** veo una sola lista cronológica con tipo, hora, origen (mesa / cliente / #orden), método, mozo, monto y propina, y un total por método al pie.
2. **Dado** un cobro **anulado**, **Cuando** abro el libro, **Entonces** aparece marcado como anulado, tachado, con su motivo y su responsable — y **no** suma en los totales.
3. **Dado** un cobro **corregido**, **Cuando** lo abro, **Entonces** veo el historial: *efectivo → tarjeta, por Fulano, 21:14, «lo pagó con débito»*.
4. **Dado** un negocio con dos cajas, **Cuando** filtro por caja, **Entonces** veo sólo esa; sin filtro veo las dos con su etiqueta.
5. **Dado** un **mozo** o **personal**, **Cuando** intenta entrar por URL, **Entonces** se lo redirige (el libro es de admin/encargado).
6. **Dado** un rango sin movimientos, **Cuando** abro el libro, **Entonces** veo un vacío explícito, no una tabla con ceros.

---

### User Story 2 — Corregir el método de un cobro (Priority: P1)

Como **encargado**, veo que un cobro quedó cargado como efectivo pero el cliente pagó con tarjeta. Toco la línea, «Corregir», elijo *Tarjeta*, escribo el motivo y confirmo. El arqueo se acomoda solo y queda registrado quién lo cambió y de qué a qué.

**Independent Test**: `corregirCobro({ paymentId, method: 'card_manual', motivo })` con rol encargado → la fila cambia de método, se inserta la auditoría, y `getCajaLiveStats` mueve el monto de `cash` a `card_manual` sin cambiar el total de ventas.

**Acceptance Scenarios**:

1. **Dado** un pago `cash` de $8.000 en una caja con el período abierto, **Cuando** lo corrijo a `card_manual`, **Entonces** `expected_cash_cents` baja $8.000, `ventas_por_metodo` mueve el monto y `total_ventas_cents` **no cambia**.
2. **Dado** ese cambio, **Cuando** confirmo, **Entonces** queda un renglón de auditoría con `from_value = 'cash'`, `to_value = 'card_manual'`, el usuario, el motivo y el timestamp.
3. **Dado** un pago cuya caja **ya se arqueó** (anterior al último corte), **Cuando** intento corregirlo, **Entonces** se rechaza: *"Ese cobro ya entró en un arqueo cerrado. Anulá el cobro y volvé a registrarlo."*
4. **Dado** un **mozo**, **Cuando** intenta corregir, **Entonces** se rechaza (gate encargado/admin).
5. **Dado** un pago de **otro negocio**, **Cuando** se pasa su id con el slug propio, **Entonces** se rechaza.
6. **Dado** un pago `mp_link` acreditado por el webhook, **Cuando** se intenta cambiarle el método, **Entonces** se rechaza: la plata la confirmó Mercado Pago. Tampoco se puede convertir un pago manual **a** `mp_link`/`mp_qr`.
7. **Dado** un pago `pending` o `refunded`, **Cuando** se intenta corregir, **Entonces** se rechaza — sólo se corrige lo que está `paid`.
8. **Dado** un cambio a `transfer` u `other`, **Cuando** confirmo sin nota, **Entonces** se rechaza con el mismo criterio que el cobro (alias/referencia obligatoria).

---

### User Story 3 — Corregir el monto (y la propina) de un cobro (Priority: P1)

Como **encargado**, veo un cobro de $15.000 que en realidad fue de $1.500. Toco «Corregir», cambio el monto, escribo el motivo y confirmo. La caja deja de decir que entraron $13.500 que no están.

**Independent Test**: Corregir un pago de $15.000 a $1.500 sobre una orden de $1.500 → `expected_cash` baja $13.500, la orden sigue cerrada, `orders.total_paid_cents` queda en $1.500.

**Acceptance Scenarios**:

1. **Dado** un cobro en efectivo de $15.000 sobre una cuenta de $1.500 (sobrepago por error de tipeo), **Cuando** lo corrijo a $1.500, **Entonces** la orden **sigue cerrada**, `total_paid_cents` = $1.500 y el efectivo esperado baja $13.500.
2. **Dado** un cobro de $1.500 sobre una cuenta de $15.000 que quedó **abierta** (pago parcial), **Cuando** lo corrijo a $15.000, **Entonces** la orden se cierra por el camino de siempre (`closeOrderIfFullyPaid`), con su transición de mesa.
3. **Dado** un cobro que cubre exacto una orden **cerrada**, **Cuando** intento bajarle el monto por debajo del total de la cuenta, **Entonces** se rechaza: *"El monto corregido no alcanza a cubrir la cuenta ($X). Si el cliente pagó menos, anulá el cobro y volvé a cobrar."* (D5).
4. **Dado** un pago con `tip_cents = $1.000` y `amount_cents = $11.000`, **Cuando** corrijo el monto a $500, **Entonces** se rechaza salvo que también corrija la propina: la propina nunca puede ser mayor que el monto.
5. **Dado** un pago con propina mal cargada, **Cuando** corrijo sólo `tip_cents`, **Entonces** el monto no cambia, la rendición del mozo se mueve y el total de ventas queda igual.
6. **Dado** un monto corregido a $0, **Cuando** confirmo, **Entonces** se rechaza: un cobro de $0 es una anulación y se hace con «Anular cobro».
7. **Dado** un pago con `adjustment_cents > 0` (recargo por método), **Cuando** corrijo el monto, **Entonces** la UI avisa que el recargo registrado **no se recalcula** y queda tal cual (D6).
8. **Dado** un pago con **factura emitida** contra su orden, **Cuando** intento corregir el monto, **Entonces** se rechaza: el comprobante fijó el importe (anular factura → anular cobro). Método y mozo **sí** se pueden corregir con factura emitida.

---

### User Story 4 — Corregir el mozo atribuido (Priority: P1)

Como **encargado**, veo que un cobro quedó atribuido a Ana cuando la mesa la atendió Bruno. Toco «Corregir», elijo a Bruno, escribo el motivo y confirmo. La rendición de los dos se acomoda sola.

**Independent Test**: `corregirCobro({ paymentId, attributedMozoId: brunoId, motivo })` → la rendición por empleado del board mueve monto y propina de Ana a Bruno; el total del turno no cambia.

**Acceptance Scenarios**:

1. **Dado** un cobro atribuido a Ana, **Cuando** lo paso a Bruno, **Entonces** la rendición por empleado y el "por mozo" del mail de cierre mueven monto **y propina** de una a otro, sin cambiar el total.
2. **Dado** que Ana **ya rindió** (existe una `mozo_rendiciones` posterior al `created_at` del pago), **Cuando** intento cambiar la atribución, **Entonces** se rechaza: *"Ese cobro ya entró en la rendición de Ana."* (D7). Lo mismo si el destino ya rindió.
3. **Dado** un usuario que no es del negocio, o que no tiene rol `mozo`/`encargado`, **Cuando** se lo intenta atribuir, **Entonces** se rechaza.
4. **Dado** un cobro sin mozo atribuido (venta de mostrador), **Cuando** le asigno uno, **Entonces** se acepta — asignar donde no había es el mismo caso.
5. **Dado** un cobro atribuido, **Cuando** lo dejo **sin** mozo, **Entonces** se acepta con motivo (venta de caja que se había atribuido mal).

---

### User Story 5 — Corregir una sangría o un ingreso (Priority: P2)

Como **encargado**, cargué una sangría de $50.000 y en realidad fueron $5.000. La corrijo con motivo, o la anulo si nunca existió.

**Acceptance Scenarios**:

1. **Dado** una sangría del período abierto, **Cuando** corrijo su monto con motivo, **Entonces** el efectivo esperado se recalcula y queda la auditoría.
2. **Dado** una sangría de un período ya arqueado, **Cuando** intento corregirla, **Entonces** se rechaza (misma ventana que los cobros).
3. **Dado** una sangría que nunca existió, **Cuando** la anulo con motivo, **Entonces** deja de sumar al arqueo pero **sigue visible** en el libro, marcada como anulada. Nunca se borra una fila.

---

### User Story 6 — Que la corrección no se pierda (Priority: P2)

Como **admin**, quiero ver las correcciones del turno sin tener que ir a buscarlas: en el mail de cierre, al lado de las anulaciones.

**Acceptance Scenarios**:

1. **Dado** un turno con correcciones, **Cuando** llega el mail de cierre ([spec 034](../034-mail-cierre-de-turno/)), **Entonces** lista qué se corrigió, de qué a qué, quién y por qué.
2. **Dado** un turno sin correcciones, **Cuando** llega el mail, **Entonces** no aparece la sección (sin ruido).

---

### Edge cases

- **Dos encargados corrigen la misma línea a la vez.** La RPC toma `FOR UPDATE` sobre el pago: la segunda ve el estado ya corregido. Ambas quedan en la auditoría.
- **Corregir dos veces.** Permitido. Cada corrección es un renglón nuevo; `from_value` siempre es el valor vigente al momento de corregir, no el original.
- **Corregir un pago cuya orden fue anulada después.** El pago está `refunded` → no se corrige (US2, escenario 7).
- **Mover el pago de caja** (se cobró en la barra y se cargó en la principal). Permitido, con la condición de que **ambas** cajas tengan el período abierto: mover plata hacia o desde un arqueo firmado lo invalidaría.
- **Corregir el método hacia uno con otro recargo configurado.** El monto **no** se toca (D6): lo que entró es lo que entró. Si además cambió el monto, se corrigen los dos campos juntos en la misma operación.
- **Órdenes con splits.** La corrección de monto recalcula `order_splits.paid_amount_cents` del split del pago; si dejara el split por debajo de su `expected_amount_cents` estando la orden cerrada, se rechaza (mismo criterio que D5).

## Requirements *(mandatory)*

### Permisos y alcance de la corrección

- **FR-001**: DEBE existir `canCorregirCobro(role)` en `can.ts` → `admin || encargado`. Mozo y personal, nunca. El gate se aplica **server-side** en la action, no sólo escondiendo el botón.
- **FR-002**: DEBE existir una server action `corregirCobro({ paymentId, slug, motivo, method?, last_four?, card_brand?, notes?, amount_cents?, tip_cents?, attributed_mozo_id?, caja_id? })` que actualice un pago ya registrado. Los campos ausentes no se tocan.
- **FR-003**: `motivo` es **obligatorio** y no vacío (mismo criterio que `anularCobro`). Sin motivo no hay corrección.
- **FR-004**: SÓLO pagos con `payment_status = 'paid'`.
- **FR-005**: SÓLO pagos cuyo `created_at` sea posterior al último corte de su caja. Si se cambia de caja, la condición aplica a **ambas**.
- **FR-006**: SÓLO métodos manuales: origen y destino en `{cash, card_manual, transfer, other}`. Un pago con `mp_payment_id` o método `mp_link`/`mp_qr` se rechaza, y no se puede convertir un pago manual a MP.
- **FR-007**: El scope `business_id` DEBE validarse server-side sobre el pago, la caja destino, el mozo destino y la orden.

### Monto y propina

- **FR-008**: El monto corregido DEBE ser `> 0` y entero en centavos. Para dejarlo en cero está «Anular cobro».
- **FR-009**: DEBE valer siempre `tip_cents <= amount_cents` (la propina viaja **dentro** del monto: `calcularRendicionMozo` hace `neto = amount - tip`).
- **FR-010**: Tras corregir el monto, `orders.total_paid_cents` y `order_splits.paid_amount_cents` DEBEN recalcularse desde los pagos `paid` de la orden — no incrementalmente.
- **FR-011**: Si tras el recálculo la orden queda **cubierta** y estaba `open`, DEBE cerrarse por el camino existente (`closeOrderIfFullyPaid`, con su transición de mesa).
- **FR-012**: Si tras el recálculo una orden **cerrada** quedaría sin cubrir, la corrección DEBE rechazarse con un mensaje que ofrezca «Anular cobro» (D5). Una orden cerrada nunca se reabre desde acá.
- **FR-013**: Si la orden tiene una **factura emitida** (`invoices` con CAE contra esa orden o ese pago), el **monto** y la **propina** NO se corrigen. Método, mozo y caja sí.
- **FR-014**: `adjustment_percent` / `adjustment_cents` NO se recalculan al corregir el monto; la UI DEBE avisarlo cuando el pago tiene un ajuste distinto de cero.

### Mozo atribuido

- **FR-015**: El mozo destino DEBE ser un `business_users` activo del negocio con rol `mozo` o `encargado`; también se acepta `null` (desatribuir).
- **FR-016**: La atribución NO se corrige si el pago ya entró en una rendición cerrada — existe una `mozo_rendiciones` del mozo **origen** o **destino** con `created_at` posterior al del pago.

### Auditoría

- **FR-017**: Toda corrección DEBE dejar rastro en una tabla de auditoría, **un renglón por campo cambiado**, con `field`, `from_value`, `to_value`, `by_user_id`, `reason` y `created_at`.
- **FR-018**: La auditoría y el update DEBEN ser **atómicos**: van en una RPC transaccional (`corregir_pago_tx`), con `FOR UPDATE` sobre el pago y su orden — mismo criterio que `registrar_pago_tx` (migración 0007).
- **FR-019**: Ninguna fila se borra nunca. Anular es un estado, no un `DELETE`.

### El libro de movimientos

- **FR-020**: DEBE existir una vista «Movimientos» accesible para **admin y encargado**, enlazada desde el board de caja, con: rango de fechas (default hoy, timezone AR explícita), filtro por caja (default todas), por tipo (cobro / sangría / ingreso), por método y por mozo, y búsqueda por mesa/cliente/#orden.
- **FR-021**: La lista DEBE incluir los cobros **anulados** y las líneas **corregidas**, visualmente distinguidos, y los anulados NO DEBEN sumar en los totales.
- **FR-022**: Cada línea DEBE poder abrirse a un detalle con su historial de correcciones y, si el rol y las guardas lo permiten, el botón «Corregir».
- **FR-023**: Cuando una línea no es corregible, el detalle DEBE decir **por qué** (arqueo cerrado, pago de MP, factura emitida, mozo que ya rindió) en lugar de esconder el botón sin explicación.
- **FR-024**: El panel «Movimientos del período» del board sigue existiendo tal cual (hot path del turno) y suma el enlace al libro + la línea accionable.
- **FR-025**: La confirmación de una corrección DEBE ser **explícita y no optimista** (frontera de plata, spec 021), con el botón bloqueado mientras está en vuelo.

### Sangrías e ingresos (P2)

- **FR-026**: `caja_movimientos` DEBE poder corregirse en monto y motivo, y anularse, con las mismas guardas de período abierto, gate y auditoría. Requiere una columna de anulación en la tabla (`cancelled_at` / `cancelled_reason` / `cancelled_by`) y que `calculateExpectedCash` ignore los anulados.

### Key entities

- **`payments`** — no cambia de forma. Cambian los valores de `method` / `last_four` / `card_brand` / `amount_cents` / `tip_cents` / `attributed_mozo_id` / `caja_id` / `notes` de una fila existente.
- **`caja_audit_log`** *(nueva)* — el rastro de cada corrección, sobre pagos **y** movimientos: `entity_type ('payment'|'movimiento')`, `entity_id`, `business_id`, `caja_id`, `field`, `from_value`, `to_value`, `by_user_id`, `reason`, `created_at`. Índices por `(entity_type, entity_id)` y `(business_id, created_at desc)`. RLS: lectura scopeada por negocio para admin/encargado, escritura sólo service role.
- **`caja_movimientos`** — suma `cancelled_at` / `cancelled_reason` / `cancelled_by` (P2).

## Decisiones

**D1 — Corregir, no anular y rehacer.** La corrección es in-place con auditoría. Anular-y-rehacer arrastra la orden entera, la mesa y la factura para arreglar un dato de una línea, y por eso en la práctica nadie lo hace: el dato queda mal.

**D2 — La ventana es el período abierto de la caja.** Un movimiento anterior al último corte ya entró en un arqueo que alguien firmó; corregirlo hacia atrás cambiaría una diferencia ya aceptada. Ahí la salida es anular y volver a registrar, que deja el rastro en el período vigente.

**D3 — Mercado Pago no se corrige.** La plata la confirmó MP y `mp_payment_id` la ata a esa acreditación. Ni el método ni el monto de un pago MP son nuestros para cambiar.

**D4 — Una sola tabla de auditoría de caja.** `caja_audit_log` cubre pagos y movimientos con `entity_type`. Dos tablas idénticas (una por entidad) obligarían a unir en cada lectura del libro para mostrar lo mismo.

**D5 — Corregir el monto nunca reabre una orden cerrada.** Si el monto corregido dejara la cuenta sin cubrir, se rechaza. La razón es concreta: la mesa de esa orden **ya se liberó** y puede estar ocupada por otra cuenta; reabrir la orden vieja dejaría dos órdenes abiertas sobre la misma mesa. El caso "el cliente pagó menos de lo que debía" no es una corrección de tipeo, es un cobro distinto: se anula y se cobra bien.

**D6 — Corregir el monto no re-deriva el recargo.** `adjustment_cents` describe cómo se compuso el cobro original. Recalcularlo obligaría a re-decidir si el recargo del método se aplicaba a la cuenta corregida — una decisión de negocio, no una corrección. Se conserva y la UI lo avisa.

**D7 — La rendición cerrada es una frontera.** Cambiar la atribución de un pago que ya entró en una `mozo_rendiciones` movería plata de una liquidación que ya se firmó con el mozo delante. Se rechaza, con el nombre del mozo en el mensaje.

**D8 — El libro vive en Operación, no en Reportes.** `reportes` es `none` para el encargado ([`sections.ts`](../../src/lib/permissions/sections.ts)) y el encargado es el que corrige. El libro cuelga de Operación (que ya tiene `full` para encargado), no de la sección Cajas (que es config admin-only).

**D9 — La propina se corrige junto con el monto.** No es scope creep: `amount_cents` **incluye** la propina, así que permitir bajar el monto sin tocar `tip_cents` habilita el estado imposible `tip > amount`, que rompe `calcularRendicionMozo` en silencio.

## Success Criteria *(mandatory)*

- **SC-001**: Corregir el método de un cobro toma ≤ 3 taps desde el board de caja y no requiere anular nada.
- **SC-002**: Tras cualquier corrección, `expected_cash_cents` y la rendición por empleado reflejan el cambio en el siguiente refresh del board, sin intervención manual.
- **SC-003**: El 100% de las correcciones queda en `caja_audit_log`: no existe ningún camino que cambie método, monto, propina, mozo o caja de un pago sin dejar rastro con motivo y responsable.
- **SC-004**: Corregir el método o el mozo **nunca** cambia el total de ventas del período; corregir el monto lo cambia exactamente en el delta.
- **SC-005**: Un cobro anulado sigue siendo visible en el libro con su motivo — hoy desaparece de toda pantalla.
- **SC-006**: Ningún rol distinto de admin/encargado puede corregir, ni por UI ni llamando la action directo.
- **SC-007**: No hay forma de que una corrección deje una orden cerrada con menos plata de la que debía cobrar (FR-012).

## Non-Goals

- Corregir pagos de **Mercado Pago** (D3).
- Corregir movimientos de **arqueos ya cerrados** — se resuelve anulando y registrando de nuevo en el período vigente.
- **Reabrir** una orden cerrada desde la caja (D5).
- Re-emitir o corregir **facturas ARCA** a partir de una corrección.
- Editar un **corte de caja** ya firmado o una **rendición** ya cerrada.
- Cambiar el motor de `registrarPago` / `registrar_pago_tx` / `anularCobro`.
- Cambiar cómo el server **deriva** el mozo atribuido al cobrar (`deriveAttributedMozo`): esta spec corrige el resultado, no la heurística.
- Exportar el libro a Excel/CSV (candidato obvio a fast-follow).

## Alcance

**Toca:**
- `supabase/migrations/00NN_caja_correcciones.sql` **(nueva)** — `caja_audit_log` + RPC `corregir_pago_tx` + (P2) columnas de anulación en `caja_movimientos`. ⚠️ Numerar al implementar: la [spec 069](../069-precio-por-item-con-motivo/) reclama la `0030`.
- `src/lib/permissions/can.ts` + `can.test.ts` — `canCorregirCobro`.
- `src/lib/caja/correcciones.ts` **(nuevo, puro)** + test — qué campos cambian, invariantes (`tip <= amount`, `amount > 0`) y el veredicto de cobertura de la orden (FR-010 a FR-012).
- `src/lib/caja/correccion-actions.ts` **(nuevo)** — `corregirCobro`, `corregirMovimiento`, `anularMovimiento` (P2).
- `src/lib/caja/queries.ts` — `getLibroDeMovimientos(range, filtros)` + `getCorreccionesDeLinea`.
- `src/app/[business_slug]/admin/(authed)/operacion/movimientos/page.tsx` **(nueva)** + su client.
- `src/components/admin/local/caja-admin-board.tsx` — línea accionable + enlace al libro.
- `src/components/admin/local/corregir-cobro-modal.tsx` **(nuevo)**.
- `src/lib/caja/expected-cash.ts` — ignorar movimientos anulados (P2).
- `src/lib/reports/shift-summary-loader.ts` + plantilla del mail — correcciones del turno (P2).

**No toca:** `registrar_pago_tx`, `registrarPago`, `anularCobro`, `deriveAttributedMozo`, el motor de cobro ([spec 062](../062-motor-de-cobro-unificado/)), el flujo de corte, ARCA.
