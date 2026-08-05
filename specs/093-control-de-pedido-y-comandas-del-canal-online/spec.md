# Feature Specification: El control de pedido vuelve a salir, y el canal online deja de mentir

**Feature Branch**: `093-control-de-pedido-y-comandas-del-canal-online`

**Created**: 2026-08-05

**Status**: 🟡 Implementada · falta verificación en vivo

**Input**: Juan, 2026-08-05: *"hay que evaluar como se manejan los estados de los pedidos en todos los casos"*. La auditoría que salió de esa pregunta encontró, de arrastre, que el ticket que se lleva el repartidor **no se emite desde el 2026-08-04**.

**Issue**: #145

**Depende de**: nada — es autocontenida y puede ir primero. Toca los mismos archivos que [`090`](../090-cancelar-orden/spec.md) (#142) sólo en `route-to-cocina.ts`; si 090 va antes, este cambio se aplica arriba sin conflicto.

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-12, H-18, H-21, H-22, H-39.

## Contexto y problema

Cinco defectos del **canal online** (delivery / pickup / programados) que comparten una raíz: `routeOrderToCocina` es el único camino real que manda un pedido a cocina, y **no valida nada** — ni que la orden siga viva, ni que hayan salido comandas, ni avisa cuando avanza.

### El bloqueante: el control de pedido no se emite

`emitControlTicket` hace el upsert así:

```ts
// src/lib/print/control-ticket-emit.ts:39-45
.upsert(
  { order_id: orderId, business_id: businessId, kind: "control" },
  { onConflict: "order_id", ignoreDuplicates: true },
)
```

Pero la unicidad de `print_jobs` es un índice **parcial**:

```sql
-- 0034:49-51
create unique index if not exists "print_jobs_control_uniq"
  on "public"."print_jobs" ("order_id") where "kind" = 'control';
```

Postgres **no puede inferir un índice parcial** desde `ON CONFLICT (order_id)`. Reproducido contra el cloud (`DO` con rollback):

```
SQLSTATE=42P10 | there is no unique or exclusion constraint
                 matching the ON CONFLICT specification
```

La sentencia falla **siempre**, y el error se traga **dos veces**: primero en `control-ticket-emit.ts:47-50` (`console.error` + `return { emitted: false }`), después en el try/catch de `route-to-cocina.ts:122-126`, que es best-effort **a propósito**. Cero señal en pantalla, cero señal en el board.

**Es una regresión de la 0034.** La tabla anterior, `control_tickets`, tenía un único **total** sobre `order_id` (`0028:54`) y el mismo upsert funcionaba. En prod hay exactamente 2 filas `kind='control'`, la última con `emitted_at` 2026-08-04 15:32 UTC — **anteriores a la aplicación de la 0034** (19:16 UTC). Son las migradas desde `control_tickets`, no emitidas por el código.

golf-house todavía no operó delivery, así que el bug **está armado esperando el primer pedido a domicilio del go-live**: el repartidor sale sin dirección, sin teléfono, sin horario y sin cuánto cobrar.

El test existente no lo detectó porque su fake devuelve `{ error: upsertError }` con `upsertError = null` (`control-ticket-emit.test.ts:25-27`): valida la **forma** de la llamada, nunca la ejecuta contra Postgres.

⚠️ **El índice total sobre `(order_id, kind)` NO sirve como fix**: `kind='cuenta'` se repite por diseño (`0034:47-48`, "las cuentas quedan deliberadamente fuera del único").

### Los otros cuatro

| | Qué pasa |
|---|---|
| **H-21** | `.update({status:'preparing'}).eq('id',orderId)` **a secas** (`route-to-cocina.ts:109-112`). Todo el control de "a quién marchar" vive en el SELECT del caller, y el webhook de MP ni siquiera mira `order.status` (lo selecciona en `:231` y nunca lo usa). Su única idempotencia es «¿ya tiene comandas?». |
| **H-18** | La guarda de spec 047 (`isOnlinePendingAdvance`) sólo ataja `from === 'pending'`. Pasada la hora, un programado `confirmed` cae en «Nuevos» con botón «Preparar»; `confirmed→preparing` es FORWARD válido, `updateOrderStatus` no crea comandas, y ahí queda **irrecuperable**: `confirmarPedido` rechaza todo lo que no sea pending/confirmed y el cron ya no lo toma. `update-status.test.ts:69-71` **fija** el comportamiento. |
| **H-22** | Si ningún ítem resuelve estación, `createComandasForItems` devuelve `{ok:true, comanda_ids:[]}` y `routeOrderToCocina` **escribe `preparing` igual**. El cron mira sólo `res.ok` y descarta `items_without_station`. Un producto nuevo cargado sin sector alcanza — y `station_id` es nullable en producto **y** en categoría, sin fallback de negocio. |
| **H-39** | `notifyDeliveryStatusChange` tiene **un solo llamador** (`update-status.ts:81`), y los tres caminos reales que ponen un pedido en `preparing` pasan por `routeOrderToCocina`, que no notifica. Con la guarda de spec 047, el aviso «Estamos preparando tu pedido» es **inalcanzable en operación normal**. |

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿El control sigue siendo best-effort? | **Sí**, pero deja de ser mudo. Perder el papel no puede abortar la marcha (la comida tiene que entrar a cocina igual), pero el fallo tiene que dejar rastro. |
| ¿Cómo se arregla el 42P10 — índice nuevo o insert guardado? | **Insert guardado**, no índice nuevo. El índice parcial es correcto y expresa la regla real ("un control por orden, las cuentas no"). Se usa el mismo patrón que ya está en el repo para `client_line_key` (`comandas/actions.ts:515`): pre-chequeo + aceptar el `23505` del parcial como duplicado benigno. |
| ¿Un pedido que marcha sin ninguna comanda avanza igual? | **Sí, pero avisando** *(decisión corregida al implementar — ver Notas)*. La spec decía «no avanza», hasta que apareció que `venderMostrador` **modela** el caso: una gaseosa y un alfajor legítimamente no generan comanda (spec 08). Bloquear habría roto una venta de mostrador real. El problema de H-22 no era avanzar sino que nadie se enteraba y después no había vuelta atrás: lo primero lo arregla el aviso, lo segundo FR-008. |
| ¿Estación por defecto del negocio? | **Fuera de alcance.** Es una decisión de catálogo con su propia UI; acá alcanza con no romper. Se anota como candidato. |
| ¿Se centraliza todo cambio de `orders.status` en un helper? | **No en esta spec.** Es lo correcto, pero es el trabajo de la [`090`](#142). Acá se agrega la guarda en el write que ya existe y se notifica desde `routeOrderToCocina`. |
| ¿Se toca el test que fija el bug de H-18? | **Sí.** `update-status.test.ts:69-71` congela `confirmed→preparing` como válido para online; se reescribe para fijar el comportamiento correcto. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El repartidor sale con el papel (Priority: P1)

Como encargado, quiero que al marchar un pedido de delivery salga el control con dirección, teléfono, horario y cuánto cobrar.

**Independent Test**: crear un pedido `delivery`, marcharlo a cocina, y verificar que existe una fila `print_jobs` con `kind='control'` y `status='pendiente'` para esa orden. Hoy no se crea ninguna.

### User Story 2 - Marchar dos veces no duplica el papel (Priority: P1)

Como sistema, quiero que el reintento del cron o el doble tap de «Marchar ahora» no emitan dos controles.

**Independent Test**: llamar `emitControlTicket` dos veces sobre la misma orden. Una sola fila, sin error propagado al caller.

### User Story 3 - Un pedido cancelado no se cocina (Priority: P1)

Como cliente, quiero que si cancelo el pedido no me lo preparen igual.

**Independent Test**: pedido `pending` con pago offline de MP (efectivo/Rapipago); el cliente cancela; llega la aprobación tardía al webhook. El pedido **no** pasa a `preparing`, no se crean comandas y no se imprime nada. Hoy se cocina y se despacha.

### User Story 4 - El que marcha sin comandas no queda muerto (Priority: P2)

Como encargado, quiero enterarme cuando un pedido no pudo salir a cocina, y poder reintentarlo.

**Independent Test**: pedido cuyos productos no tienen `station_id` ni en producto ni en categoría. La marcha avanza igual (un pedido de sólo kiosco es legítimo) pero **le llega un aviso «Marchó sin comanda» al encargado** y el cron lo cuenta en `withoutComanda`. Y si el pedido quedó roto, «Marchar ahora» lo vuelve a aceptar (FR-008). Hoy queda en `preparing` sin comandas, sin aviso y sin botón que lo rescate.

### User Story 5 - El programado vencido se manda a cocina de verdad (Priority: P2)

Como encargado, quiero que el botón obvio de un programado vencido lo mande a cocina, no que lo rompa.

**Independent Test**: programado `confirmed` con `scheduled_at` pasado. El botón visible lo rutea con comandas e impresión. Si se intenta el avance por `updateOrderStatus`, se rechaza con el mismo mensaje que la spec 047 usa para `pending`.

### User Story 6 - El cliente se entera de que su pedido entró a cocina (Priority: P3)

Como cliente, quiero recibir el aviso «Estamos preparando tu pedido» cuando entra a cocina.

**Independent Test**: marchar un pedido online por cualquiera de los tres caminos (manual, cron, webhook MP). Llega un solo aviso por el canal configurado del negocio. Hoy no llega ninguno.

## Requisitos

- **FR-001** `emitControlTicket` deja de usar `upsert` con `onConflict`. Pasa a insert guardado: pre-chequeo por `(order_id, kind='control')` —que tiene índice (`print_jobs_order_kind_idx`)— y, ante `23505`, tratarlo como duplicado benigno (`{ emitted: false }` sin `console.error`). Cualquier otro error sí se loguea.
- **FR-002** El fallo del control deja de ser invisible: `routeOrderToCocina` incluye el resultado en su `actionOk` (`control_failed: boolean`). **No** aborta la marcha.
- **FR-003** Test de integración **real contra Postgres** para `emitControlTicket` (`*.integration.test.ts`), que ejercite el índice parcial. El test unitario con fake se conserva para las ramas de negocio (`dine_in` → no emite, cross-tenant → no emite), pero **deja de ser la única cobertura del upsert**.
- **FR-004** El UPDATE de `routeOrderToCocina` lleva guarda optimista de estado: `.update({status:'preparing'}).eq('id',orderId).in('status',['pending','confirmed']).select('id')`. Si no devuelve fila, se aborta **antes** de crear comandas y se devuelve error explícito (`ORDER_NOT_MARCHABLE`).
- **FR-004b** Como el orden actual crea comandas **antes** del UPDATE, el chequeo de estado se hace **al principio** de `routeOrderToCocina` (SELECT) **y** en el UPDATE (guarda optimista contra la carrera). El SELECT solo no alcanza; el UPDATE solo llegaría tarde.
- **FR-005** El webhook de MP corta temprano si `order.status === 'cancelled'`: no rutea, no crea comandas, no imprime. La columna ya se selecciona en `webhook/route.ts:231` y hoy no se usa. **El pago sí se registra** — la plata entró y tiene que estar en la caja; lo que no puede pasar es que se cocine.
- **FR-006** *(corregido en implementación — ver Notas)* Cuando `comanda_ids.length === 0 && withoutStation > 0`, `routeOrderToCocina` **avanza igual** pero **avisa al encargado** (`pedido.sin_comanda`) y el cron lo **cuenta** (`withoutComanda`) en vez de descartarlo. La recuperabilidad la aporta FR-008.
- **FR-007** `isOnlinePendingAdvance` se extiende a `from ∈ ('pending','confirmed')` para `delivery_type !== 'dine_in'`. En la UI, el botón de un `confirmed` online llama `confirmarPedido`, no `updateOrderStatus`.
- **FR-008** `confirmarPedido` acepta rescatar un `preparing` **sin comandas** (hoy tiene techo en `confirmed`), para que los pedidos ya rotos por H-18/H-22 se puedan recuperar sin tocar la DB a mano.
- **FR-009** `routeOrderToCocina` dispara `notifyDeliveryStatusChange(preparing)` best-effort al final, para los tres caminos. Se protege contra doble aviso si el pedido ya estaba en `preparing`.

## Fuera de alcance

- Estación por defecto por negocio (candidato aparte; hoy `station_id` es nullable en producto y categoría, sin fallback — `routing.ts:8-16`).
- Centralizar todo write de `orders.status` en un helper único → [`090`](#142).
- Sincronizar `lifecycle_status` en el canal online → [`091`](#143).
- Reintento durable del control desde el board (botón «Reimprimir control»): se anota, pero con FR-001 el papel sale bien de entrada.

## Riesgos → tests

| Riesgo | Test |
|---|---|
| **El 42P10 vuelve** | integration real: dos `emitControlTicket` sobre la misma orden → 1 fila, sin excepción |
| Se emite control para `dine_in` o mostrador | unit: `delivery_type='dine_in'` → `emitted:false`, cero inserts |
| Cross-tenant | unit: `business_id` de la fila ≠ el pasado → `emitted:false` |
| Un cancelado se cocina | unit: `status='cancelled'` → `routeOrderToCocina` aborta antes de `createComandasForItems` |
| Webhook MP resucita | unit: webhook con orden `cancelled` → registra el pago, **no** rutea |
| Carrera cancelar/marchar | unit: el UPDATE no matchea (`.in(status)`) → error, sin comandas creadas |
| Marcha fantasma | unit: cero estaciones resueltas + `withoutStation>0` → no escribe `preparing`, devuelve error con los productos |
| Marcha legítima parcial | unit: 1 estación resuelta + 1 ítem sin estación → **sí** avanza (hay comanda), reporta `withoutStation` |
| Programado vencido irrecuperable | unit: `confirmed` online + `updateOrderStatus('preparing')` → rechazado con el mensaje de spec 047 |
| Rescate del roto | unit: `preparing` sin comandas + `confirmarPedido` → crea comandas y emite control |
| Aviso duplicado | unit: marchar dos veces → un solo `notifyDeliveryStatusChange` |
| Aviso inexistente | unit: los tres caminos (manual/cron/webhook) disparan el aviso |

## Notas de implementación

**Qué NO hacer:**

1. **No** crear un índice único total sobre `(order_id, kind)` para que el `onConflict` funcione: `kind='cuenta'` se repite por diseño y el índice rompería la reimpresión de cuenta.
2. **No** cambiar el índice parcial por uno total sobre `order_id`: sería la misma rotura.
3. **No** confiar en el test unitario existente como prueba de que el insert anda — su fake nunca toca Postgres. Ése es exactamente el motivo por el que el bug vivió desde el 04/08.

**Migración:** ninguna. El índice `print_jobs_control_uniq` está bien; lo que está mal es el `ON CONFLICT` que no lo puede inferir. Verificado en el cloud con `pg_indexes`.

### Desviaciones de la spec, decididas al implementar

**1. FR-006 pasó de bloquear a avisar.** La spec pedía no avanzar a `preparing` cuando no salía ninguna comanda. Al implementarlo apareció el choque: `venderMostrador` **modela** ese caso a propósito —«el alfajor y la gaseosa no generan comanda, el tostado sale a sanguchería», `venta-mostrador.ts:222-224`, que cae del modelado del producto de spec 08— y `station_id` es nullable en producto **y** en categoría. O sea que "cero comandas" no distingue un producto mal configurado de un pedido de sólo kiosco, y el bloqueo habría roto una venta de mostrador legítima de una gaseosa.

Se invierte: se avanza igual, pero **el silencio se rompe** (aviso al encargado + contador del cron) y **la recuperabilidad la da FR-008**. El problema real de H-22 no era avanzar, era que nadie se enteraba y después no había vuelta atrás; las dos mitades quedan cubiertas sin romper lo modelado.

**2. `control_emitted` → `control_failed`.** Con un booleano de "se emitió" no se distingue el duplicado benigno (la re-marcha idempotente, que es el camino normal del cron) del fallo real. El board habría gritado en cada reintento. `emitControlTicket` ahora devuelve `{ emitted, failed }` y sólo `failed` viaja hacia arriba: no-aplica y duplicado son caminos esperados, no fallos.

**3. `MARCHABLE` incluye `preparing`.** Es lo que hace que el rescate de FR-008 funcione de punta a punta: `confirmarPedido` acepta un `preparing`, pero `routeOrderToCocina` lo habría rechazado con su propia guarda. Es seguro porque el chequeo de idempotencia corta antes cuando la orden ya tiene comandas: a esa línea sólo llega un `preparing` **sin una sola comanda**, que es exactamente el pedido roto que se quiere rescatar.

## Verify

**Estado: 🟡 implementada, verificación en vivo pendiente.**

- `pnpm typecheck` ✅ · `eslint` limpio en lo tocado ✅ · `pnpm test` ✅ **1452 unit tests en verde**. Los 17 archivos `*.integration` fallan por falta de stack local (Docker apagado en esta máquina), igual que antes del cambio.
- Tests nuevos: `route-to-cocina.test.ts` (14, no existía), `control-ticket-emit.integration.test.ts` (4). Reescritos: `control-ticket-emit.test.ts` (8), `update-status.test.ts` (+3 casos de `confirmed`), `march-scheduled.test.ts` (shape del resultado).
- **La semántica SQL del fix se validó contra el cloud** dentro de un `DO` con rollback, ya que el stack local no se pudo levantar: el insert pelado entra (donde el upsert daba `42P10`), el segundo insert levanta `23505` contra el índice parcial —que es lo que el código captura como duplicado benigno— y **dos `kind='cuenta'` de la misma orden siguen permitidas**, o sea que el índice parcial quedó intacto.

**Lo que NO está verificado:**

- **El test de integración no se corrió.** Está escrito y sigue el patrón del repo (`.env.test` → stack local), pero acá Docker no estaba levantado. Es el test que habría atajado este bug, así que **hay que correrlo antes de cerrar #145**.
- **FR-005 no tiene test propio**: no existe harness para el webhook de MP (firma + fetch a la API). La defensa real es FR-004, que sí está testeada — el corte del webhook es redundancia. Queda anotado como deuda.
- **Nada se probó en vivo con el rol real** ni con el print-agent del local: que el papel salga físicamente de la comandera sigue pendiente.
- **Contra el cloud**: la señal de que esto anda en producción es la primera fila `print_jobs kind='control'` con `emitted_at` posterior al deploy. Hoy las únicas 2 son anteriores a la 0034.
