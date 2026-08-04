# Feature Specification: El encargado programa un pedido desde operación

**Feature Branch**: `085-programar-pedido-desde-operacion`

**Created**: 2026-08-04

**Status**: 📋 Especificada

**Input**: Juan, 2026-08-04: *"faltó la posibilidad de que el encargado pueda crear un pedido en diferido, el cual se auto comandaría 40 min antes, o que mande una notificación directamente, y que él marche las comandas, creo que ya estaba hecha esa lógica"*.

**Issue**: #135

**Depende de**: [`031-pedidos-diferidos`](../../../wiki/specs/31-pedidos-diferidos/spec.md) (el motor: `orders.scheduled_at`, «Próximos», cron de marcha) · [`047-auto-march-solo-si-pagado`](../047-auto-march-solo-si-pagado/spec.md) (nada entra a cocina sin aval) · [`054-cargar-pedido-para-llevar`](../054-cargar-pedido-para-llevar/spec.md) (el sheet que se amplía; dejó `scheduled_at` explícitamente fuera de fase 1) · [`061-delivery-programado-y-lead-configurable`](../061-delivery-programado-y-lead-configurable/spec.md) (lead por negocio + «Aceptar») · [`064-programado-solo-hoy-con-grilla`](../064-programado-solo-hoy-con-grilla/spec.md) (la grilla de horarios que se reusa).

## Contexto y problema

El motor del pedido diferido **ya existe y funciona**: `orders.scheduled_at`, la sección «Próximos» en operación, el cron `orders-march-scheduled` (cada 5 min) que marcha con el lead del negocio — **40 min** en retiro, 60 en delivery, configurables 0–240 — y el escape manual «Marchar ahora». Lo que no existe es **la puerta de entrada del encargado**: hoy un diferido sólo puede nacer del checkout público o del chatbot.

El caso real es el encargue telefónico: *"mandame 20 empanadas para las 21"*. El encargado atiende el teléfono, y con lo que hay hoy tiene dos malas salidas: cargar el pedido ahora y que la comanda salga cuatro horas antes de tiempo, o anotarlo en un papel y acordarse de cargarlo a las 20:20.

El sheet «Cargar pedido» (spec 054) fue deliberado en dejarlo afuera — *"pedido diferido: fuera de fase 1"* — y el schema de staff lo blinda con un test. Esta spec cierra esa fase 2, sin motor nuevo: **una fecha en el input y el resto ya está construido**.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Para cuándo puede programar el encargado? | **Sólo hoy, con la misma grilla que el cliente** (spec 064): los chips que ofrece reservas ese día, mínimo 60 min de anticipación. Cero reglas nuevas — el encargado usa exactamente el mismo `validateScheduledOrder`. Un encargue para mañana no entra: se carga mañana. |
| ¿Qué pasa cuando llega la hora? | **Auto-marcha, como hoy.** El cron lo manda a cocina con el lead del negocio (40 min retiro / 60 delivery). No se agrega ninguna notificación nueva. |
| ¿Hace falta un «Aceptar» después de cargarlo? | **No.** El pedido nace `confirmed`: el aval humano que pide spec 047 ya ocurrió — lo cargó el encargado en persona. Dejarlo `pending` obligaría a un segundo gesto redundante y, si se lo olvida, el pedido **nunca sale**. |
| ¿Se puede marchar antes? | Sí, sin cambios: «Marchar ahora» desde «Próximos» ya acepta `confirmed`. |

**Por qué no la notificación.** El pedido de Juan ofrecía la alternativa *"o que mande una notificación directamente, y que él marche las comandas"*. Se descarta porque la auto-marcha ya resuelve el problema sin sumar un gesto en hora pico: un aviso que exige que alguien lo vea y apriete un botón es **más frágil** que el cron, no menos — si nadie lo mira, el pedido no sale. El control manual sigue disponible por el otro lado («Marchar ahora» adelanta; «Próximos» muestra siempre lo que viene). Si más adelante un local lo quiere, es un evento nuevo en el subsistema de notificaciones (`NOTIFICATION_EVENTS`), no un cambio de este motor.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cargar el encargue telefónico (Priority: P1)

Como encargado, quiero cargar ahora un pedido que se retira a las 21, para no depender de acordarme a las 20:20 ni de que la comanda salga cuatro horas antes.

**Independent Test**: A las 17:00, abrir «Cargar pedido», elegir productos, marcar «Programar» y el chip de las 21:00, confirmar. Verificar que el pedido aparece en «Próximos» y que cocina no imprimió nada.

**Acceptance Scenarios**:

1. **Dado** el sheet «Cargar pedido» con productos en el carrito, **Cuando** voy al paso de datos, **Entonces** veo «¿Para cuándo?» con **Ahora** (default) y **Programar**.
2. **Dado** que elijo «Programar», **Entonces** veo los horarios de hoy del local — los mismos chips que ve el cliente al programar — sin los que ya no cumplen la anticipación mínima.
3. **Dado** un horario elegido, **Cuando** confirmo, **Entonces** el pedido se crea con `scheduled_at`, **no** genera comandas y aparece en «Próximos» con su hora.
4. **Dado** que el negocio no tiene horarios configurados para hoy, **Entonces** «Programar» está deshabilitado y se explica por qué (no se deja pedir para fallar después en el server).

---

### User Story 2 - La comanda sale sola antes de la hora (Priority: P1)

Como encargado, quiero que el pedido que programé entre a cocina solo, con la anticipación que configuré, sin tener que acordarme de nada.

**Independent Test**: Programar un pedido para dentro de ~45 min con lead de 40 y esperar un tick del cron (≤ 5 min): la comanda tiene que imprimir sin ningún gesto.

**Acceptance Scenarios**:

1. **Dado** un pedido programado por el encargado, **Cuando** `scheduled_at - lead <= now`, **Entonces** el cron lo marcha y pasa a `preparing` (sale de «Próximos», entra al kanban).
2. **Dado** ese mismo pedido, **Cuando** toco «Marchar ahora» antes de la ventana, **Entonces** va a cocina en el acto (idempotente: si el cron ya lo marchó, no duplica comandas).
3. **Dado** un pedido programado por el encargado, **Entonces** NO requiere el gesto «Aceptar» — nace avalado.
4. **Dado** el sheet en modo «Programar», **Entonces** la UI dice cuánto antes va a salir la comanda, con el lead **real** del negocio (no un 40 hardcodeado en un texto).

---

### User Story 3 - El pedido de ahora no cambia (Priority: P1)

Como encargado, quiero que cargar un pedido para ahora funcione exactamente igual que antes.

**Independent Test**: Cargar un pedido sin tocar «¿Para cuándo?» y verificar que los dos botones de siempre («Cargar y enviar a cocina» / «Sólo cargar») se comportan igual.

**Acceptance Scenarios**:

1. **Dado** «Ahora» (default), **Entonces** el footer ofrece las dos acciones de siempre y el pedido nace `pending` como hoy.
2. **Dado** «Programar», **Entonces** el footer ofrece **una sola** acción — «Programar pedido» — porque «enviar a cocina» contradice el diferido.
3. **Dado** un pedido programado, **Cuando** lo cobro desde su card, **Entonces** el cobro funciona igual que en cualquier pedido sin mesa (spec 054/060, sin cambios).

### Edge Cases

- **El chip queda viejo**: el encargado tarda en cargar y el horario elegido deja de cumplir la anticipación mínima → el server rechaza con el mensaje de `validateScheduledOrder` y el chip se limpia. Mismo comportamiento que el checkout.
- **Horario que no está en la grilla** (payload armado a mano): rechazado en `persistOrder` — la validación server-side no cambia ni se relaja para staff.
- **Pedido de mesa / venta rápida** (`dine_in`): no se programan, ni antes ni ahora. El chequeo ya está en `validateScheduledOrder`.
- **Falla el paso a `confirmed`** después de crear la orden: el pedido queda `pending` en «Próximos» con su botón «Aceptar» — degradación segura, no un pedido perdido. Se avisa en el toast.
- **Medianoche**: "hoy" es el día calendario en la TZ del local, no la del server (ya resuelto en `localYmd`).
- **Delivery programado**: permitido (spec 061), con su propio lead. El schema de staff sigue exigiendo dirección + teléfono.

## Requirements *(mandatory)*

- **FR-001**: El sheet «Cargar pedido» DEBE ofrecer elegir entre **Ahora** (default) y **Programar** en el paso de datos.
- **FR-002**: Los horarios ofrecidos DEBEN ser los mismos que ve el cliente — `orderSlotsForDay` sobre la config de reservas del negocio — filtrados por la anticipación mínima (`filterSlotsByLead`, 60 min).
- **FR-003**: Si el negocio no ofrece horarios hoy, «Programar» DEBE estar deshabilitado con el motivo a la vista.
- **FR-004**: `StaffOrderInput` DEBE aceptar `scheduled_at` (ISO con offset) y `cargarPedidoStaff` DEBE pasarlo a `persistOrder`, que revalida con `validateScheduledOrder` — **la misma** validación del camino público.
- **FR-005**: Un pedido de staff con `scheduled_at` futuro DEBE quedar en `confirmed` al crearse, para que el cron lo marche sin gesto adicional.
- **FR-006**: Crear un pedido programado NO DEBE generar comandas ni imprimir nada en ese momento.
- **FR-007**: El pedido DEBE aparecer en «Próximos» ordenado por hora y aceptar «Marchar ahora» (cero cambios en esa sección).
- **FR-008**: En modo «Programar», el footer DEBE ofrecer una sola acción; «Cargar y enviar a cocina» NO DEBE estar disponible.
- **FR-009**: La UI DEBE informar el lead **real** del negocio (`scheduled_march_lead_{pickup,delivery}_min`), no un valor fijo.
- **FR-010**: El camino «Ahora» NO DEBE cambiar en nada.

### Non-Goals

- **Notificación «está por marchar»** — descartada arriba con su razón.
- **Programar para otros días.** El diferido sigue siendo del día (spec 064). Si el club lo pide para encargues de fin de semana, es una spec aparte que afecta también al cliente.
- **Programar pedidos de mesa** (`dine_in`) o ventas de mostrador.
- **Lead por pedido.** El lead sigue siendo del negocio; pisarlo pedido a pedido no lo pidió nadie.
- **Migración.** Cero: `orders.scheduled_at` y las columnas de lead ya existen.

## Success Criteria *(mandatory)*

- **SC-001**: El encargado carga un pedido para las 21:00 a las 17:00 y ni cocina ni la comandera reciben nada hasta la ventana.
- **SC-002**: Ese pedido aparece en «Próximos» con su hora y sin botón «Aceptar» (ya está avalado).
- **SC-003**: Al entrar en ventana, el cron lo marcha solo; «Marchar ahora» lo adelanta sin duplicar comandas.
- **SC-004**: Un horario fuera de la grilla o sin la anticipación mínima es rechazado por el server, aunque el payload venga armado a mano.
- **SC-005**: `pnpm typecheck` + unit tests (schema staff con y sin `scheduled_at`, mapeo en `cargarPedidoStaff`, paso a `confirmed`) en verde; verificado en vivo con rol encargado.
