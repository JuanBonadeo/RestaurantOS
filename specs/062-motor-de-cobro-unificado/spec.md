# Feature Specification: Un solo motor de cobro — el formulario recibe por parámetro qué tiene que cobrar

**Feature Branch**: `062-motor-de-cobro-unificado`

**Created**: 2026-07-28

**Status**: 📝 Spec — pendiente de aprobación. Milestone: Post-demo · Growth & hardening.

**Input**: Juan, 2026-07-28 — *"yo creo que habría que unificar todos los tipos de cobros, en una misma UI, que reciba con parámetros lo que tiene que cobrar, así va a ser más fácil me parece"*. Alcance decidido con Juan (misma fecha): **las cuatro UIs de una**, incluido el cobro del mozo.

**Reemplaza la mitad A de [spec 060](../060-cobro-pedido-unificado-y-editar-pago/)** (que proponía reusar `CobrarDesktopClient` sólo para el pedido sin mesa). 060 queda con su mitad B: corregir un pago ya registrado.

## Contexto y problema

Cobrar es siempre el mismo gesto: **elegir método, confirmar un monto, registrar el pago**. Hoy está escrito cuatro veces.

| UI | Líneas | Recargo por método | Tarjeta + últimos 4 | MP link/QR | Propina | Efectivo ≥ lo que falta |
|---|---|---|---|---|---|---|
| [`cobrar-client.tsx`](../../src/app/[business_slug]/mozo/mesa/[id]/cobrar/cobrar-client.tsx) — mozo, mobile | 1357 | ✅ | ✅ | ✅ | ✅ | ✅ |
| [`cobrar-desktop-client.tsx`](../../src/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.tsx) — encargado, desktop | 1022 | ✅ | ✅ | ✅ | ✅ | ✅ |
| [`cobrar-pedido-sheet.tsx`](../../src/components/admin/cobrar-pedido-sheet.tsx) — pedido del board | 293 | ❌ | ❌ | ❌ | ❌ | ❌ |
| [`venta-rapida-panel.tsx`](../../src/components/admin/local/venta-rapida-panel.tsx) — mostrador | 601 | ✅ | parcial | ❌ | ✅ | ❌ |

**3273 líneas para el mismo gesto**, y las columnas de la derecha son el costo real: cada regla de dinero nueva hay que escribirla N veces y nace incompleta.

No es una hipótesis. El 2026-07-28, al agregar *"en efectivo no se cobra de menos"* ([#93](https://github.com/gachetponzellini/RestaurantOS-app/issues/93)), la regla **se escribió dos veces** (mozo y desktop) y **quedó fuera de las otras dos** — sin que nada lo señalara. Lo mismo pasó antes con el recargo por método: el pedido del board cobra la misma tarjeta a distinto precio que la mesa, y esa divergencia sobrevivió desde spec 054 hasta hoy porque nadie tenía por qué mirar los cuatro archivos.

La lógica de dinero **pura** ya está bien: `calculateAdjustment`, `isCashShortPayment`, `registrar_pago_tx`, la idempotencia por `request_id`. Lo que está cuadruplicado es **el formulario que la orquesta**.

### Lo que ya existe y se reusa

- **Motor server:** `registrarPago` (RPC transaccional idempotente, migración 0007), `iniciarPagoMp` + webhook, `closeOrderIfFullyPaid`, `venderMostrador`.
- **Reglas puras:** `isCashShortPayment`, `expectedByAmounts`, `calculateAdjustment` (hoy duplicada como helper local en dos archivos — se unifica de paso).
- **Idempotencia:** `requestId` estable entre taps (spec 42), ya implementada en los dos clientes grandes.
- **Desacople de la mesa:** `CobrarDesktopClient` ya ignora `tableId` (`void _tableId`) — el cobro no necesita mesa hace rato, sólo lo aparenta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Una regla de dinero se escribe una sola vez (Priority: P1)

Como **desarrollador**, agrego una regla de cobro (una guarda, un método nuevo, un recargo) **en un solo lugar** y aplica a los cuatro puntos donde el negocio cobra.

**Why this priority**: Es la feature. Todo lo demás se deriva.

**Independent Test**: Agregar una guarda al componente y verificar por test que mesa, pedido y mostrador la respetan sin tocar sus archivos.

**Acceptance Scenarios**:

1. **Dado** el motor unificado, **Cuando** se cobra un **pedido del board** con tarjeta y el método tiene +10%, **Entonces** se registra el mismo `amount_cents` que la misma cuenta cobrada en una mesa (hoy difieren).
2. **Dado** una **venta de mostrador** en efectivo, **Cuando** se intenta confirmar por menos de lo que se debe, **Entonces** se rechaza igual que en la mesa (hoy se acepta).
3. **Dado** cualquiera de los cuatro puntos, **Cuando** se toca Confirmar dos veces, **Entonces** se registra **un** solo pago (mismo `requestId`).

---

### User Story 2 — El mozo no pierde su ergonomía (Priority: P1)

Como **mozo**, sigo cobrando con una mano en el celular: botones grandes, modal a pantalla completa, el mismo flujo de siempre. Que por debajo sea el mismo componente que usa el encargado no cambia nada de lo que veo.

**Why this priority**: Es la superficie en producción con más uso y la que más fácil se rompe. "Mobile-first para operación" es principio del producto, no un detalle.

**Acceptance Scenarios**:

1. **Dado** el cobro del mozo migrado, **Cuando** el mozo cobra una mesa, **Entonces** el flujo, los tamaños de toque y la cantidad de taps son los de hoy.
2. **Dado** el cobro del encargado, **Cuando** cobra desde el panel del salón, **Entonces** sigue siendo un panel al lado del plano, no un modal.
3. **Dado** cualquiera de los dos, **Cuando** se cobra con MP, **Entonces** el link/QR y el polling cada 4s funcionan como hoy.

---

### User Story 3 — Cobrar algo que todavía no existe (Priority: P2)

Como **encargado**, en la venta de mostrador la orden **nace al cobrar**. El formulario tiene que servir igual, aunque no haya `orderId`.

**Acceptance Scenarios**:

1. **Dado** el panel de mostrador, **Cuando** se confirma el cobro, **Entonces** se llama a `venderMostrador` (crea + cobra + cierra) y no a `registrarPago`.
2. **Dado** el mismo panel, **Cuando** el negocio tiene un descuento por efectivo, **Entonces** se muestra y se aplica igual que en la mesa.

---

### Edge cases

- **MP no es un submit más.** `mp_link`/`mp_qr` no registran el pago: crean una preference y esperan al webhook. El componente lo modela como una capacidad opcional (`mp`), no como un método más del submit — y quien no la pasa (mostrador) simplemente no ofrece MP.
- **Split implícito.** Cuando no hay división, el "split" es virtual y el pago va con `splitId: null`. Eso lo resuelve el caller, no el formulario: el formulario sólo sabe **cuánto falta**.
- **Propina.** La mesa la atribuye al mozo (`attributed_mozo_id` derivado server-side); el pedido del board no tiene mozo. La capacidad es opcional (`allowTip`), la atribución sigue siendo server-side.
- **Vuelto.** Sólo en efectivo, y sólo informativo: nunca se registra como parte del pago.
- **Ajuste con monto editado.** Hoy el ajuste se calcula sobre lo que falta y **no** se recalcula si el usuario edita el monto — inconsistencia existente en los dos clientes grandes. Al unificar hay que **decidirlo una vez** y documentarlo (propuesta: el ajuste siempre se calcula sobre lo que falta; si el monto editado es mayor, la diferencia es vuelto).

## Hallazgos del diff previo (T002) — las diferencias que NO son accidentales

Antes de fusionar nada se diffeó el comportamiento real de los dos clientes grandes. Los `METHODS` y sus helpers resultaron **idénticos**, pero aparecieron cuatro divergencias que hay que decidir explícitamente — si se resuelven "sola" en el merge, se pierde comportamiento en silencio.

1. **`onPaid` tiene dos contratos distintos.** El mozo devuelve el `RegistrarPagoResult` completo para **mergear la fila que el server ya persistió** (spec 41, cobro instantáneo: sin `router.refresh()`); el desktop devuelve sólo `{ orderClosed }`. **No es una inconsistencia a limpiar: es perf percibida deliberada.** El contrato unificado devuelve el resultado completo y cada caller usa lo que necesita.

2. **La propina sale de lugares distintos.** El mozo la toma de la orden (`orderTipCents`, cargada en el paso Cuenta y no editable al cobrar); el encargado la edita **dentro del cobro** (`useState(0)`). Son dos semánticas del mismo campo, no un descuido. → `allowTip: boolean` **no alcanza**; ver contrato corregido en `plan.md`.

3. **Facturar está en 3 de 4, y el que falta es el del encargado.** `emitInvoice` vive en el cobro del mozo, en el pedido del board y en la venta de mostrador; **el cobro de mesa del encargado es el único que no puede facturar**. La spec original asumía lo contrario (que el bloque de comprobante era exclusivo del sheet del pedido). Corregido: el comprobante es una **capacidad del caller**, y que el encargado no la tenga hoy es una asimetría a resolver con Juan, no algo a replicar.

4. **Etiquetas de sub-cuenta.** El mozo distingue `split_index === 0` (split implícito) con un texto propio; el desktop no. Cosmético pero visible: va al `subject`.

## Requirements *(mandatory)*

### El componente

- **FR-001**: DEBE existir un único componente de formulario de cobro que reciba **cuánto hay que cobrar** y **qué hacer al confirmar**, sin conocer mesas, pedidos ni órdenes.
- **FR-002**: Contrato de entrada mínimo: `subject` (para los textos), `amountDueCents`, `cajas`, `methodConfigs`, `allowedMethods`, `tip` (fija desde la orden o editable — hallazgo 2), `onSubmit`, y `mp` opcional.
- **FR-003**: `onSubmit` DEBE recibir todo lo necesario para registrar el pago (`method`, `amountCents` con ajuste, `tipCents`, `cajaId`, `lastFour`, `cardBrand`, `notes`, `adjustmentPercent`, `adjustmentCents`, `requestId`) y devolver un `ActionResult`. **El componente no importa server actions**: el caller decide si es `registrarPago`, `venderMostrador` o lo que venga.
- **FR-004**: Las reglas de dinero DEBEN vivir dentro del componente una sola vez: ajuste por método, guarda de efectivo (`isCashShortPayment`), vuelto, últimos 4 dígitos, nota obligatoria en `transfer`/`other`, bloqueo mientras el cobro está en vuelo, `requestId` estable entre taps y regenerado tras un cobro OK.
- **FR-005**: DEBE soportar dos ergonomías sin duplicar lógica: **touch** (mozo, botones grandes) y **compacta** (paneles del admin). Vía prop, no vía copia.
- **FR-006**: MP DEBE ser una capacidad opcional que encapsule la preference, la sub-vista de link/QR y el polling. Quien no la pasa, no ofrece MP.
- **FR-007**: `calculateAdjustment`, hoy duplicada como helper local en dos archivos, DEBE quedar en `lib/billing` con test propio.

### Las cuatro migraciones

- **FR-008**: El **pedido del board** pasa al motor y gana recargo, propina, mixto, MP y anular. Se borra `cobrar-pedido-sheet.tsx`, extrayendo el bloque de comprobante (Factura A/B, spec 053) a un componente propio — que hoy **también** usan el mozo y el mostrador (hallazgo 3), así que la extracción los unifica a los tres.
- **FR-009**: El **cobro del encargado** (página + panel embebido del salón) pasa al motor sin cambiar su layout ni sus props externas.
- **FR-010**: El **cobro del mozo** pasa al motor **dentro de su modal actual**, sin cambios visibles de flujo ni de ergonomía.
- **FR-011**: La **venta de mostrador** pasa al motor para su bloque de pago, conservando el picker de productos.
- **FR-012**: Al terminar NO DEBE quedar ningún formulario de cobro paralelo.

### Textos

- **FR-013**: Los textos DEBEN salir del `subject`: nada de "mesa" cuando se cobra un delivery (hoy `CobrarDesktopClient` dice *"Cobrar mesa"* y *"La mesa se va a marcar para limpiar"* aunque no haya mesa).

## Success Criteria *(mandatory)*

- **SC-001**: Las cuatro superficies aplican **las mismas** reglas: recargo, guarda de efectivo, últimos 4, idempotencia. Verificable por test, no por lectura.
- **SC-002**: Una regla de dinero nueva se agrega tocando **un** archivo.
- **SC-003**: El total de líneas de UI de cobro baja sustancialmente respecto de las 3273 actuales (referencia, no meta: lo que importa es que no haya lógica repetida).
- **SC-004**: Cero cambios visibles para el mozo: mismo flujo, mismos taps, mismos tamaños.
- **SC-005**: Un pedido del board cobrado con tarjeta registra lo mismo que la misma cuenta en una mesa.

## Non-Goals

- Cambiar el motor server (`registrarPago`, la RPC, el webhook).
- Unificar las **pantallas** en una sola: el mozo sigue en modal mobile y el encargado en panel desktop. Se unifica el motor, no el envoltorio.
- Corregir un pago ya registrado — eso es [spec 060](../060-cobro-pedido-unificado-y-editar-pago/), independiente.
- Rediseñar el cobro. Es un refactor de estructura: si algo se ve distinto, es un bug de esta spec.
