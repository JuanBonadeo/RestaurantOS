# Feature Specification: Delivery programado + lead de marcha configurable por negocio

**Feature Branch**: `061-delivery-programado-y-lead-configurable`

**Created**: 2026-07-28

**Status**: ✅ Implementado (2026-07-28) — migración 0027 aplicada al cloud, `pnpm typecheck` en verde, `pnpm test` 882 pass (los 3 rojos son timeouts de latencia cloud en `cuenta.integration` / `traslado.integration`, **preexistentes**: fallan igual con el árbol limpio). **Pendiente:** T022, verify en vivo con rol real (encargado) + print-agent. Issue [#94](https://github.com/gachetponzellini/RestaurantOS-app/issues/94). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-28 — *"las comandas de los pedidos de delivery que son para cierta hora, en diferido, se tienen que auto imprimir, no sé 40 minutos antes de para cuando lo quiere o capaz 1hr antes, que sea configurable eso, pero que se autoimpriman, es decir va a empezar como pendiente"* + *"otra cosa es que el delivery también se tendría que poder programar"*.

Extiende [spec 31 · pedidos diferidos](../../../wiki/specs/31-pedidos-diferidos/) y respeta la política de [spec 047](../047-auto-march-solo-si-pagado/) (auto-march solo si está pagado).

## Contexto y problema

### Lo que ya existe

El motor de pedidos diferidos está construido y andando (spec 31):

- `orders.scheduled_at` guarda el instante futuro. El pedido nace `pending`, **sin comandas** — no imprime nada.
- El cron `orders-march-scheduled` corre **cada 5 min** (`pg_cron` → `pg_net` → `POST /api/cron/march-scheduled`, migración [0013](../../supabase/migrations/0013_crons_app_config.sql)) y llama a `marchDueScheduledOrders()`, que **marcha** (crea comandas → el print-agent imprime) los que ya entraron en ventana.
- La sección **«Próximos»** del board ([`orders-realtime-board.tsx:287`](../../src/components/admin/orders-realtime-board.tsx)) los muestra fuera del kanban, con un botón «Marchar ahora».

O sea: **la auto-impresión anticipada ya existe.** Lo que falta son las tres cosas que la hacen usable para el delivery de golf-house.

### Falta 1 — el lead está clavado en 40 minutos

[`scheduled.ts:16`](../../src/lib/orders/scheduled.ts):

```ts
/** Cuánto antes de `scheduled_at` se marcha el pedido a cocina (cron/manual). */
export const SCHEDULED_MARCH_LEAD_MIN = 40;
```

El header del propio archivo lo declara deuda asumida: *"Defaults **fijos** para arrancar (configurables = segundo paso, ver design D7)"*. Cuarenta minutos puede estar bien para un retiro, pero un delivery además tiene que **viajar**: si la comanda entra 40 min antes de la hora que pidió el cliente, entre cocina y cadete el pedido llega tarde. Y el número correcto depende del local — no hay un valor que sirva para House y para Golf a la vez.

### Falta 2 — el delivery no se puede programar

Dos guardas lo bloquean, en el server y en el borde:

- [`scheduled.ts:99`](../../src/lib/orders/scheduled.ts) — `if (input.deliveryType !== "pickup") return { ok: false, error: "Solo se pueden programar pedidos de retiro." }`
- [`schema.ts:74`](../../src/lib/orders/schema.ts) — mismo rechazo en el `superRefine` de `CreateOrderInput`.
- En el checkout, `canSchedule = isPickup && mpEnabled` ([`checkout-form.tsx:97`](../../src/components/checkout/checkout-form.tsx)): el selector «¿Para cuándo?» ni siquiera aparece si el cliente eligió delivery.

### Falta 3 — la trampa: un programado en efectivo no marcharía nunca

Esta es la que hace que "permitir delivery" no sea un `if` de una línea.

[Spec 047](../047-auto-march-solo-si-pagado/) fijó la regla **"imprime solo lo pagado"**: el efectivo remoto nace `pending` y espera la confirmación manual del encargado, porque *"marchar e imprimir algo todavía no cobrado ni confirmado le saca al mostrador el control de qué entra a cocina"*. Coherente con eso, el cron filtra:

```ts
.eq("payment_status", "paid")
.eq("status", "pending")
.eq("delivery_type", "pickup")   // ← además, hoy solo pickup
```

Hoy no hay conflicto porque **el programado exige MP adelantado**, así que siempre está `paid`. Al abrir el delivery programado a *efectivo al recibir* (decisión de Juan), el pedido queda `pending` + `payment_status: 'pending'` para siempre: el cron no lo toma, la sección «Próximos» tampoco lo muestra (filtra `payment_status === 'paid'`, [`:299`](../../src/components/admin/orders-realtime-board.tsx)), y el pedido **desaparece de la vista** hasta que alguien lo busque a mano. Es una pérdida silenciosa, igual en forma a la que documentó spec 047.

La salida no es romper la regla de 047 sino **darle al encargado el gesto que le falta**: aceptar el programado sin marcharlo. El local sigue mandando; lo que se automatiza es solo el *cuándo* imprime, no el *si*.

Ojo con el atajo obvio: hoy el único gesto que existe es `confirmarPedido`, y ese **marcha ya mismo** ([`confirm-order.ts:64`](../../src/lib/orders/confirm-order.ts) → `routeOrderToCocina`, que crea comandas y pasa a `preparing`). Si el encargado lo usara para aceptar un pedido de las 21:00 a las 15:00, la comanda sale a las 15:00. Aceptar y marchar tienen que ser dos cosas distintas.

### Falta 4 (latente) — `dine_in` se colaría

[`persist-order.ts:89`](../../src/lib/orders/persist-order.ts) mapea `dine_in` → `"delivery"` a propósito, *"para que caiga en el mismo rechazo que ya da el validador"*. Ese truco depende de que delivery esté prohibido. Al permitirlo, una venta de mostrador (spec 058) con `scheduled_at` pasaría a ser programable. El validador tiene que rechazar `dine_in` por sí mismo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — El cliente programa un delivery (Priority: P1)

Como **cliente**, pido delivery para las 21:00 desde la carta web. Elijo «Programar», día y hora, y pago con Mercado Pago **o** en efectivo al recibir. Recibo la confirmación de que el pedido quedó agendado para esa hora.

**Why this priority**: Es la mitad del pedido de Juan y no existe hoy en ninguna forma.

**Acceptance**:
1. Con delivery elegido, el selector «¿Para cuándo? → Ahora / Programar» **aparece**.
2. Programando delivery, las opciones de pago son **Mercado Pago** y **Efectivo al recibir**.
3. Programando **retiro**, sigue apareciendo solo Mercado Pago (sin cambio).
4. Rigen las mismas reglas de spec 31: mínimo 60 min de anticipación, máximo 7 días, dentro del horario de atención. Los tres errores se muestran con su mensaje propio.
5. Una venta de mostrador (`dine_in`) con `scheduled_at` se rechaza con *"Los pedidos en mesa no se programan."*

### User Story 2 — La comanda sale sola, con el lead del negocio (Priority: P1)

Como **cocina**, la comanda del delivery de las 21:00 sale de la impresora a las 20:00 sin que nadie la toque, porque el negocio tiene configurado 60 min de anticipación para delivery. La del retiro de las 21:00 sale a las 20:20, porque su lead es 40.

**Why this priority**: Es el "que se autoimpriman" del pedido.

**Acceptance**:
1. `marchDueScheduledOrders` usa `scheduled_march_lead_delivery_min` para los delivery y `scheduled_march_lead_pickup_min` para los retiros, **del negocio de cada pedido**.
2. Un pedido cuyo lead todavía no entró en ventana **no** se marcha, aunque otro negocio del mismo tick sí lo haga.
3. La marcha sigue siendo **idempotente**: dos ticks solapados o un reintento no duplican comandas.
4. Marchar pasa el pedido a `preparing` y lo saca de «Próximos» al kanban, como hoy.

### User Story 3 — El encargado acepta un programado en efectivo (Priority: P1)

Como **encargado**, veo en «Próximos» el delivery de las 21:00 que se paga en efectivo, con el cartel de que **está esperando que lo acepte**. Toco «Aceptar» y queda agendado: no se imprime nada todavía, y a las 20:00 la comanda sale sola.

**Why this priority**: Sin esto, US1 con efectivo produce pedidos que nunca llegan a cocina. Es co-requisito de US1, no un extra.

**Acceptance**:
1. Un programado **impago** aparece en «Próximos» marcado como *"Esperando aceptación"*.
2. «Aceptar» lo pasa a `confirmed` y **no crea comandas ni imprime**. Sigue en «Próximos», ahora marcado *"Aceptado"*.
3. Recién cuando entra en ventana, el cron lo marcha.
4. «Marchar ahora» sigue existiendo y marcha en el acto — es el escape manual, y funciona tanto sobre un `pending` como sobre un `confirmed`.
5. Un programado **pagado** (MP aprobado) no necesita aceptación: entra a «Próximos» ya listo y el cron lo marcha, como hoy.

### User Story 4 — El dueño configura los dos leads (Priority: P2)

Como **dueño**, en Configuración → Perfil del negocio pongo cuánto antes quiero que salgan las comandas de los programados: 40 min para retiro, 60 para delivery. Lo cambio cuando el delivery empieza a llegar tarde.

**Acceptance**:
1. Dos campos en minutos, junto a «Tiempo estimado de entrega».
2. Rango válido 0–240 min; fuera de rango, error de validación.
3. El cambio afecta al siguiente tick del cron — no hay que reiniciar nada.
4. Solo admin/encargado (el mismo gate que ya tiene el formulario de perfil).

## Requisitos funcionales

- **FR-001** `validateScheduledOrder` acepta `deliveryType: "pickup" | "delivery"` y rechaza `"dine_in"` con *"Los pedidos en mesa no se programan."*
- **FR-002** Un programado de **delivery** admite `payment_method` `mp` o `cash`. Un programado de **retiro** sigue exigiendo `mp`.
- **FR-003** El `superRefine` de `CreateOrderInput` refleja FR-001 y FR-002 (defensa en el borde, además del server).
- **FR-004** `persist-order` pasa el `delivery_type` **real** al validador, sin el mapeo `dine_in → delivery`.
- **FR-005** `businesses.scheduled_march_lead_pickup_min` (default 40) y `businesses.scheduled_march_lead_delivery_min` (default 60), `not null`, con check `between 0 and 240`.
- **FR-006** `shouldMarchNow` recibe el lead como parámetro (ya lo hace); `marchDueScheduledOrders` lo resuelve por pedido según `delivery_type` + config del negocio.
- **FR-007** El cron considera programados con `payment_status = 'paid' AND status = 'pending'` **o** `status = 'confirmed'`. Un `pending` impago **no** se marcha.
- **FR-008** El filtro SQL acota por `scheduled_at <= now + MAX_MARCH_LEAD_MIN` (240) para no traer la tabla entera; el corte exacto por negocio se aplica en TS.
- **FR-009** Action `aceptarPedidoProgramado(orderId, slug)`: gate `canConfirmOrder`, exige `status = 'pending'` y `scheduled_at` futuro, pasa a `confirmed` **sin** rutear a cocina.
- **FR-010** `confirmarPedido` (= «Marchar ahora») acepta también `status = 'confirmed'`, no solo `pending`.
- **FR-011** «Próximos» muestra los programados futuros con `status` `pending` **o** `confirmed`, pagos o impagos, con su estado visible (*Esperando aceptación* / *Aceptado* / *Pago*).
- **FR-012** Un programado en `confirmed` **no** aparece en las columnas del kanban.
- **FR-013** El formulario de perfil del negocio expone los dos leads; `updateBusinessProfile` los valida y persiste.
- **FR-014** El checkout ofrece «Programar» cuando el modo es `pickup` **o** `delivery`; para retiro sigue exigiendo MP habilitado, para delivery no (puede pagarse en efectivo).

## Éxito medible

- **SC-001** Un delivery programado para T se imprime en `T − scheduled_march_lead_delivery_min`, ±5 min (granularidad del cron).
- **SC-002** Cambiar el lead en Configuración cambia la hora de impresión del siguiente pedido sin deploy.
- **SC-003** Ningún programado impago llega a cocina sin que el encargado lo haya aceptado (test).
- **SC-004** Ningún programado aceptado se queda sin marchar (test: `confirmed` en ventana ⇒ marcha).
- **SC-005** `pnpm typecheck` + `pnpm test` en verde; los tests de spec 31 y 047 siguen pasando **sin editarlos**, salvo los que aserten explícitamente "solo pickup".

## Fuera de alcance

- Que el **retiro** programado acepte efectivo. Sigue exigiendo MP adelantado — decisión explícita de Juan, se puede relajar después con un `if`.
- Anticipación mínima (60 min) y ventana máxima (7 días) configurables. Siguen fijas.
- Calcular el tiempo de viaje por dirección/distancia. El lead de delivery es un número plano por negocio.
- Avisar al cliente cuando su programado entra a cocina.
