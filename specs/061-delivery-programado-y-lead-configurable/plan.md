# Implementation Plan: 061 — Delivery programado + lead configurable

## Enfoque

No hay motor nuevo. El cron, la sección «Próximos», `routeOrderToCocina` y la idempotencia ya están; el trabajo es **abrir tres guardas y agregar un gesto**.

1. **Abrir** el validador y el schema a `delivery` (y cerrarlos a `dine_in`, que hoy pasa por un mapeo tramposo).
2. **Parametrizar** el lead: dos columnas en `businesses`, resueltas por pedido en el cron.
3. **Agregar** `aceptarPedidoProgramado` — la pieza que le falta a spec 047 para que el efectivo programado no se pierda.

La secuencia importa: el paso 3 es co-requisito del 1. Abrir el delivery a efectivo **sin** el gesto de aceptar deja pedidos huérfanos, así que van en el mismo commit.

## Capas

### Datos — migración `0027_lead_de_marcha_configurable.sql`

```sql
alter table public.businesses
  add column if not exists scheduled_march_lead_pickup_min   int not null default 40,
  add column if not exists scheduled_march_lead_delivery_min int not null default 60;

alter table public.businesses
  add constraint businesses_scheduled_march_lead_pickup_check
  check (scheduled_march_lead_pickup_min between 0 and 240);
-- ídem delivery
```

Aditiva y retrocompatible: los defaults reproducen exactamente el comportamiento de hoy para el retiro (40) y estrenan el delivery con 60. Sin backfill.

**Van en `businesses`, no en `settings` (Json).** Es la misma familia que `delivery_fee_cents` / `min_order_cents` / `estimated_delivery_minutes`, que ya son columnas; `settings` está reservado a branding y al resumen de cierre. Además el cron necesita leerlas en un join, no en un blob. No hay riesgo de fuga: la migración [0018](../../supabase/migrations/0018_revoke_businesses_select_from_clients.sql) revocó el `SELECT` de `anon`/`authenticated` sobre `businesses` y **toda** lectura pasa por el service client.

Se actualiza también el `COMMENT ON COLUMN orders.scheduled_at`, que hoy dice *"fecha/hora futura de retiro… ~40 min antes"*.

### Dominio puro — `src/lib/orders/scheduled.ts`

- `SCHEDULED_MARCH_LEAD_MIN` (40) pasa a ser el **default de retiro**: `DEFAULT_MARCH_LEAD_PICKUP_MIN`. Se suma `DEFAULT_MARCH_LEAD_DELIVERY_MIN = 60` y `MAX_MARCH_LEAD_MIN = 240` (el techo del check, y la ventana del filtro SQL).
- `ScheduledOrderValidation.deliveryType` pasa a `"delivery" | "pickup" | "dine_in"`, y `paymentMethod` **desaparece del tipo**: ya no hay ninguna regla de pago que validar.
- Orden de chequeos nuevo: **`dine_in` → anticipación → ventana → horario**.

```ts
if (input.deliveryType === "dine_in") return { ok: false, error: "Los pedidos en mesa no se programan." };
```

`shouldMarchNow` **no cambia** — ya recibe `leadMin`. Solo cambia su default.

### Cron — `src/lib/orders/march-scheduled.ts`

El filtro SQL se ensancha y el corte fino se hace en TS:

```ts
const { data: due } = await service
  .from("orders")
  .select("id, business_id, delivery_type, scheduled_at, business:businesses(scheduled_march_lead_pickup_min, scheduled_march_lead_delivery_min)")
  .not("scheduled_at", "is", null)
  .in("delivery_type", ["pickup", "delivery"])
  .or("and(status.eq.pending,payment_status.eq.paid),status.eq.confirmed")
  .lte("scheduled_at", cutoff);   // now + MAX_MARCH_LEAD_MIN
```

Después, por fila: `shouldMarchNow(new Date(o.scheduled_at), now, leadFor(o))`. El índice parcial `(business_id, scheduled_at) where scheduled_at is not null` sigue sirviendo al `lte`.

El `.or(...)` es la traducción literal de FR-007: **pagado y sin tocar**, o **aceptado por el encargado**. Un `pending` impago queda afuera — es la regla de spec 047 intacta.

### Server actions — `src/lib/orders/confirm-order.ts`

Un action nuevo al lado del existente, compartiendo el gate:

- `aceptarPedidoProgramado(orderId, slug)` → `canConfirmOrder`, rechaza `dine_in`, rechaza si `status !== 'pending'`, rechaza si `scheduled_at` no es futuro (*"Este pedido no está programado — usá «Confirmar»."*), `update({ status: 'confirmed' })`, `revalidatePath`. **No** llama a `routeOrderToCocina`.
- `confirmarPedido` cambia una línea: la guarda `status !== 'pending'` pasa a aceptar también `'confirmed'`, para que «Marchar ahora» funcione sobre un programado ya aceptado.

### Cliente

**`checkout-form.tsx`** — el cambio es de condiciones, no de layout:

- `canSchedule` desaparece: la sección «¿Para cuándo?» se renderiza siempre.
- El `useEffect` que forzaba `payment = 'mp'` al programar se borra.
- `paymentOptions` vuelve a tener una sola forma — programar ya no la altera.
- En el submit, `deliveryType` pasa el modo real en vez del literal `"pickup"`.
- Los textos que dicen "retiro" ("Elegí el día y la hora del retiro") se vuelven neutros.

**`orders-realtime-board.tsx`**:

- `isAgendadoPending` → `isAgendado`: `scheduled_at` futuro && (`pending` || `confirmed`). Sigue excluyéndolos del kanban (FR-012).
- «Próximos» deja de filtrar `payment_status === 'paid'` y ordena igual por `scheduled_at`.
- `ScheduledOrderCard` recibe el estado y muestra el badge + los botones que correspondan: impago `pending` → «Aceptar» + «Marchar ahora»; `confirmed` o pago → «Marchar ahora».
- El subtítulo *"programados para retirar"* pasa a *"programados"*.

**`business-profile-form.tsx` + `business-actions.ts`** — dos campos enteros más, con el mismo patrón que `estimated_delivery_minutes` (`z.coerce.number().int().min(0).max(240)`), en el bloque de delivery.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un `pending` impago se marcha por error (viola 047) | El `.or()` lo excluye + test explícito (SC-003) |
| `dine_in` programable al abrir delivery | Rechazo propio en el validador + test (US1 ac. 5) |
| «Marchar ahora» deja de funcionar sobre un aceptado | `confirmarPedido` acepta `confirmed` + test |
| Un aceptado se cuela en el kanban | `isAgendado` cubre `confirmed` + test del board |
| El `.or()` de PostgREST mal formado devuelve de más | Test de integración del cron con las cuatro combinaciones de estado/pago |

## Verificación

`pnpm typecheck` + `pnpm test`. Verify en vivo (rol real encargado, no service_role) con el print-agent: programar un delivery en efectivo → aparece en Próximos «Esperando aceptación» → Aceptar → nada imprime → forzar el cron con `curl` → sale la comanda.
