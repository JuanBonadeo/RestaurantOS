# Feature Specification: Programar un pedido = solo hoy, y solo en la grilla de horarios de reservas

**Feature Branch**: `064-programado-solo-hoy-con-grilla`

**Created**: 2026-07-29

**Status**: ✅ Implementado (2026-07-29) — `pnpm typecheck` verde, `pnpm test` 965 pass / 6 skip, sin migración (no toca datos). **Pendiente:** verify en vivo con rol real. Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-29 — *"quiero quitar libertad a los pedidos por anticipación, que solo se pueda pedir para el mismo día, y que agarre los mismos chips que lo de las reservas con los mismos horarios, así quitamos libertad al usuario y está todo más estricto"*.

Endurece [spec 31 · pedidos diferidos](../../../wiki/specs/31-pedidos-diferidos/) y [spec 061 · delivery programado](../061-delivery-programado-y-lead-configurable/).

## Contexto y problema

Programar un pedido hoy es demasiado libre. En el checkout, «¿Para cuándo? → Programar» abre un `<input type="date">` + un `<input type="time">`, y el validador acepta cualquier instante que cumpla tres reglas anchas ([`scheduled.ts`](../../src/lib/orders/scheduled.ts)):

- ≥ 60 min de anticipación,
- ≤ **7 días** hacia adelante,
- dentro de alguna franja de `business_hours`.

O sea: el cliente puede pedir un delivery para el jueves que viene a las 20:37. Para el local eso es una promesa a una semana sobre una operación que se planifica por servicio, con un minuto arbitrario que no se corresponde con ningún turno de cocina. Y es **incoherente con reservas**, que para el mismo local ya resuelve "¿a qué hora venís?" con una grilla de chips explícita (`reservation_settings.schedule`, por día de la semana).

El pedido de Juan es alinear las dos superficies: que programar un pedido se elija como se elige una reserva, y solo para hoy.

## Requisitos

### FR-001 — Solo el mismo día

`scheduled_at` tiene que caer en el **mismo día calendario que "ahora", en el TZ del negocio**. Un instante de mañana o de ayer se rechaza con *"Los pedidos programados son solo para hoy."*.

La ventana de `SCHEDULED_MAX_WINDOW_DAYS = 7` se elimina (queda subsumida: mismo día es más estricto).

### FR-002 — La hora sale de la grilla de reservas

`scheduled_at` tiene que coincidir **exactamente** con uno de los `HH:MM` que `reservation_settings.schedule` abre ese día de la semana (`open: true`). Cualquier otra hora se rechaza con *"Elegí uno de los horarios disponibles del local."*.

La grilla **reemplaza** al chequeo contra `business_hours`: es config explícita del negocio, más estricta, y es la que ya ve el cliente que reserva. `isWithinBusinessHours` deja de usarse y se borra.

### FR-003 — La anticipación mínima sigue

Se conservan los 60 min de `SCHEDULED_MIN_LEAD_MIN`. Un chip de hoy que ya no los cumple no se ofrece, y si el cliente lo manda igual (pestaña vieja) el server lo rechaza con el mensaje de anticipación.

### FR-004 — El checkout muestra chips, no inputs

El selector «Programar» deja de mostrar día + hora libres y muestra la **misma grilla de chips que reservas**: los horarios de hoy que todavía cumplen la anticipación mínima, en grilla de 3 columnas.

- Sin grilla cargada para hoy (o día cerrado) → el botón «Programar» queda **deshabilitado** con el subtítulo *"No disponible hoy"*. No se deja pedir para fallar después en el server.
- Con grilla pero sin chips que cumplan la anticipación (ya es tarde) → *"Ya no quedan horarios para hoy. Pedí «Lo antes posible»."*.

### FR-005 — Nada más cambia

`dine_in` sigue sin programarse (spec 061). El motor de marcha (cron, lead por negocio, «Aceptar» del encargado, sección «Próximos») no se toca: esto es solo la puerta de entrada.

## Decisiones

**D1 — La grilla de reservas, no una grilla propia de pedidos.** Es literal lo que pidió Juan ("los mismos chips") y evita una segunda config que se desincroniza. Costo asumido: la granularidad de los programados pasa a ser la de las reservas. En golf-jcr eso hoy son **dos horarios por día (13:00 y 21:00)**; si el local quiere retiros cada media hora, se agregan slots en Configuración → Reservas y aparecen en los dos lados.

**D2 — Sin grilla no se programa.** El default de `reservation_settings.schedule` es `{}`, así que un negocio del SaaS que nunca configuró reservas pierde la opción de programar. Es coherente con "más estricto" y falla visible (botón deshabilitado) en vez de silencioso.

**D3 — La disponibilidad de mesas NO entra.** Un pedido para llevar no ocupa mesa: se usa la grilla horaria (`schedule`), no `computeAvailableSlots` (que filtra por mesa libre y tamaño de grupo).

**D4 — "Hoy" se resuelve en el server, el filtro por anticipación en el cliente.** La página pasa los slots del día ya resueltos en el TZ del local (estable entre SSR e hidratación); el cliente descarta los que ya no cumplen el lead, y el server revalida todo en `persistOrder`.

## Alcance

**Toca:**
- [`src/lib/orders/scheduled.ts`](../../src/lib/orders/scheduled.ts) — validador + helpers puros (`localYmd`, `scheduleSlotsForDay`, `filterSlotsByLead`); se van `SCHEDULED_MAX_WINDOW_DAYS` e `isWithinBusinessHours`.
- [`src/lib/orders/persist-order.ts`](../../src/lib/orders/persist-order.ts) — lee `reservation_settings.schedule` en vez de `business_hours`.
- [`src/app/[business_slug]/(public)/checkout/page.tsx`](../../src/app/[business_slug]/(public)/checkout/page.tsx) — pasa `todaySlots`.
- [`src/components/checkout/checkout-form.tsx`](../../src/components/checkout/checkout-form.tsx) — chips.

**No toca:** migraciones (no hay cambio de datos), cron de marcha, board del encargado, reservas.
