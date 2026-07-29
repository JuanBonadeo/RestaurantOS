# Tasks: 061 — Delivery programado + lead configurable

Leyenda: `[ ]` pendiente · `[x]` hecho. **T004–T012 van juntas**: abrir el delivery a efectivo sin el gesto de aceptar deja pedidos huérfanos.

## Datos
- [x] **T001** Migración `0027_lead_de_marcha_configurable.sql`: `scheduled_march_lead_pickup_min` (default 40) y `scheduled_march_lead_delivery_min` (default 60) en `businesses`, `not null`, check `between 0 and 240` (FR-005) + comentarios + actualizar el `COMMENT ON COLUMN orders.scheduled_at`.
- [x] **T002** Aplicar al cloud vía MCP (`apply_migration`) + `pnpm db:types` + `get_advisors` sin nuevos hallazgos.

## Dominio puro
- [x] **T003** `scheduled.ts`: renombrar `SCHEDULED_MARCH_LEAD_MIN` → `DEFAULT_MARCH_LEAD_PICKUP_MIN`, sumar `DEFAULT_MARCH_LEAD_DELIVERY_MIN = 60` y `MAX_MARCH_LEAD_MIN = 240`. Actualizar el header del archivo (ya no son "defaults fijos", D7 queda cerrado para el lead).
- [x] **T004** `validateScheduledOrder`: `deliveryType` admite `dine_in`; rechazo propio *"Los pedidos en mesa no se programan."*; el requisito de MP queda **solo para pickup** (FR-001, FR-002).
- [x] **T005** Tests de `validateScheduledOrder`: delivery+mp ok · delivery+cash ok · pickup+cash rechazado · `dine_in` rechazado con su mensaje · las tres reglas de spec 31 (anticipación / ventana / horario) siguen aplicando a delivery.

## Borde y persistencia
- [x] **T006** `schema.ts` `superRefine`: rechaza `scheduled_at` con `dine_in`; exige `mp` **solo** si `delivery_type === 'pickup'` (FR-003).
- [x] **T007** `persist-order.ts`: pasar el `delivery_type` real al validador, sacando el mapeo `dine_in → "delivery"` y su comentario (FR-004). Actualizar el comentario del bloque diferido (ya no es "retiro, MP adelantado").

## Cron
- [x] **T008** `march-scheduled.ts`: traer `delivery_type`, `scheduled_at` y los dos leads del negocio en el join; filtro `.in("delivery_type", ["pickup","delivery"])` + `.or("and(status.eq.pending,payment_status.eq.paid),status.eq.confirmed")` + `.lte("scheduled_at", now + MAX_MARCH_LEAD_MIN)` (FR-007, FR-008).
- [x] **T009** Corte fino en TS con `shouldMarchNow(scheduledAt, now, leadFor(order))` (FR-006). Devolver `considered` = los que entraron en ventana, no los traídos.
- [x] **T010** Tests del cron: delivery con lead 60 marcha a T−60 y **no** a T−61 · pickup con lead 40 en el mismo tick no marcha · `pending` impago **nunca** marcha (SC-003) · `confirmed` impago en ventana **sí** marcha (SC-004) · dos negocios con leads distintos en el mismo tick.

## Actions
- [x] **T011** `aceptarPedidoProgramado(orderId, slug)` en `confirm-order.ts`: `canConfirmOrder`, rechaza `dine_in`, exige `status = 'pending'` y `scheduled_at` futuro, `status → 'confirmed'` **sin** `routeOrderToCocina`, `revalidatePath` (FR-009).
- [x] **T012** `confirmarPedido`: la guarda de estado acepta `pending` **o** `confirmed`, para que «Marchar ahora» ande sobre un aceptado (FR-010).
- [x] **T013** Tests de guardas: encargado ok · admin ok · **mozo rechazado** · pedido de otro negocio rechazado · `dine_in` rechazado · pedido no programado rechazado · aceptar dos veces rechazado.

## Cliente — checkout
- [x] **T014** `checkout-form.tsx`: `canSchedule` deja de exigir pickup; el `useEffect` que fuerza MP corre **solo** en pickup; `paymentOptions` ofrece efectivo en delivery programado (FR-014).
- [x] **T015** El submit pasa el `deliveryType` y el `paymentMethod` reales a `validateScheduledOrder` (hoy manda los literales `"pickup"` / `"mp"`). Textos de "retiro" → neutros.

## Cliente — board del encargado
- [x] **T016** `isAgendadoPending` → `isAgendado`: futuro && (`pending` || `confirmed`), sin filtrar por pago; siguen fuera del kanban (FR-011, FR-012).
- [x] **T017** `ScheduledOrderCard`: badge de estado (*Esperando aceptación* / *Aceptado* / *Pago*) + «Aceptar» solo en el impago `pending`; «Marchar ahora» siempre. Subtítulo *"programados para retirar"* → *"programados"*.

## Cliente — configuración
- [x] **T018** `business-profile-form.tsx`: dos campos en minutos junto a «Tiempo estimado de entrega», con ayuda que explique que es cuánto antes sale la comanda (US4).
- [x] **T019** `business-actions.ts`: validar (`int`, 0–240) y persistir los dos campos (FR-013).

## Cierre
- [x] **T020** `pnpm typecheck` + `pnpm test` en verde.
- [ ] **T021** Actualizar [`wiki/features/pedidos.md`](../../../wiki/features/pedidos.md) y la página de spec 31 con el comportamiento nuevo; log en `wiki/log.md`.
- [ ] **T022** Verify en vivo con rol real (encargado) + print-agent: programar delivery en efectivo → «Esperando aceptación» → Aceptar → no imprime → forzar el cron → sale la comanda.
