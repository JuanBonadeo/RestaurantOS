# Feature Specification: Programar un pedido = solo hoy, y solo en la grilla de horarios de reservas

**Feature Branch**: `064-programado-solo-hoy-con-grilla`

**Created**: 2026-07-29

**Status**: ✅ Implementado (2026-07-29) — `pnpm typecheck` verde, `pnpm test` 969 pass / 6 skip, sin migración (no toca datos). **Pendiente:** verify en vivo con rol real. Milestone: Post-demo · Growth & hardening.

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

### FR-002 — La hora sale de los chips de reservas, según el modo del negocio

`scheduled_at` tiene que coincidir **exactamente** con uno de los `HH:MM` que reservas ofrece ese día. De dónde salen depende del `mode` de [spec 059](../059-reservas-modo-flexible/), igual que en el flujo de reservar:

| Modo | Fuente | Ejemplo |
|---|---|---|
| **flexible** (golf-house) | `reservation_services` del día → `arrivalSlots(opens_at, closes_at, 15)` | Almuerzo 12:00–14:30 → 12:00, 12:15 … 14:15 |
| **estricto** (demo) | `reservation_settings.schedule[dow].slots` | 12:00, 13:00, 13:30, 20:30 … |

Cualquier otra hora se rechaza con *"Elegí uno de los horarios disponibles del local."*.

En flexible, el mismo servicio suele estar cargado una vez por salón: a un retiro/delivery no le importa la zona, así que los horarios se **unen y deduplican**. `day_of_week: null` (servicio de todos los días) también entra.

Esto **reemplaza** al chequeo contra `business_hours`: es config explícita del negocio, más estricta, y es la que el cliente ya ve al reservar. `isWithinBusinessHours` deja de usarse y se borra.

### FR-003 — La anticipación mínima sigue

Se conservan los 60 min de `SCHEDULED_MIN_LEAD_MIN`. Un chip de hoy que ya no los cumple no se ofrece, y si el cliente lo manda igual (pestaña vieja) el server lo rechaza con el mensaje de anticipación.

### FR-004 — El checkout muestra chips, no inputs

El selector «Programar» deja de mostrar día + hora libres y muestra la **misma grilla de chips que reservas**: los horarios de hoy que todavía cumplen la anticipación mínima, en grilla de 3 columnas.

- Sin grilla cargada para hoy (o día cerrado) → el botón «Programar» queda **deshabilitado** con el subtítulo *"No disponible hoy"*. No se deja pedir para fallar después en el server.
- Con grilla pero sin chips que cumplan la anticipación (ya es tarde) → *"Ya no quedan horarios para hoy. Pedí «Lo antes posible»."*.

### FR-005 — Nada más cambia

`dine_in` sigue sin programarse (spec 061). El motor de marcha (cron, lead por negocio, «Aceptar» del encargado, sección «Próximos») no se toca: esto es solo la puerta de entrada.

## Decisiones

**D1 — Los chips de reservas, no una grilla propia de pedidos.** Es literal lo que pidió Juan ("los mismos chips") y evita una segunda config que se desincroniza. Costo asumido: la granularidad de los programados pasa a ser la de las reservas — en golf-jcr, cada 15 min dentro de Almuerzo (12:00–14:30) y Cena (20:00–22:30).

**D1b — Hay que respetar el modo, no leer `schedule` siempre.** Primer intento de esta spec leía sólo `reservation_settings.schedule`. En golf-jcr eso devuelve `13:00` y `21:00`: residuos del modo estricto que **nadie ve** desde que el negocio pasó a flexible (spec 059). Un pedido programado habría ofrecido dos horarios que no existen en el flujo de reservar. Por eso `orderSlotsForDay` despacha por `mode`.

**D2 — Sin nada configurado no se programa.** Un negocio del SaaS sin servicios (flexible) ni `schedule` (estricto) pierde la opción de programar. Es coherente con "más estricto" y falla visible (botón deshabilitado) en vez de silencioso.

**D3 — La disponibilidad de mesas NO entra.** Un pedido para llevar no ocupa mesa: se usan sólo los horarios (grilla o ventana de servicio), no `computeAvailableSlots` / `computeFlexibleAvailability` (que filtran por mesa libre, zona y tamaño de grupo).

**D4 — "Hoy" se resuelve en el server, el filtro por anticipación en el cliente.** La página pasa los slots del día ya resueltos en el TZ del local (estable entre SSR e hidratación); el cliente descarta los que ya no cumplen el lead, y el server revalida todo en `persistOrder`.

## Alcance

**Toca:**
- [`src/lib/orders/scheduled.ts`](../../src/lib/orders/scheduled.ts) — validador + helpers puros (`localYmd`, `orderSlotsForDay`, `filterSlotsByLead`); se van `SCHEDULED_MAX_WINDOW_DAYS` e `isWithinBusinessHours`.
- [`src/lib/orders/persist-order.ts`](../../src/lib/orders/persist-order.ts) — lee `reservation_settings` (mode + schedule) y `reservation_services` en vez de `business_hours`.
- [`src/app/[business_slug]/(public)/checkout/page.tsx`](../../src/app/[business_slug]/(public)/checkout/page.tsx) — pasa `todaySlots`.
- [`src/components/checkout/checkout-form.tsx`](../../src/components/checkout/checkout-form.tsx) — chips.

**No toca:** migraciones (no hay cambio de datos), cron de marcha, board del encargado, reservas.
