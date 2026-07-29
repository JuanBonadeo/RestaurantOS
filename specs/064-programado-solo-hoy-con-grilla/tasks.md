# Tasks — 064 · Programado solo hoy, con la grilla de reservas

- [x] **T001** Tests rojos en [`scheduled.test.ts`](../../src/lib/orders/scheduled.test.ts): solo-hoy (incluye el borde de TZ 23:00 AR = mañana en UTC), hora fuera de grilla, sin grilla, día cerrado, anticipación.
- [x] **T002** `scheduled.ts`: `localYmd`, `orderSlotsForDay` (dedup + orden), `filterSlotsByLead`; `validateScheduledOrder` recibe `daySlots` y valida tipo → día → anticipación → chip.
- [x] **T003** `scheduled.ts`: borrar `SCHEDULED_MAX_WINDOW_DAYS`, `isWithinBusinessHours` y `effectiveClose` (dead code tras T002).
- [x] **T004** `persist-order.ts`: leer `reservation_settings` (mode + schedule) y `reservation_services`, resolver los chips de hoy y pasarlos al validador.
- [x] **T005** `checkout/page.tsx`: `getReservationSettings` + `getReservationServices` + `orderSlotsForDay(now)` → prop `todaySlots`.
- [x] **T006** `checkout-form.tsx`: estado `schedSlot`, chips 3-col, «Programar» deshabilitado sin grilla, vacío "ya no quedan horarios", guarda de anticipación al enviar.
- [x] **T007** `pnpm typecheck` + `pnpm test` en verde (969 pass / 6 skip).
- [x] **T008** Wiki: [`features/pedidos.md`](../../../wiki/features/pedidos.md) · reglas nuevas + nota de granularidad en golf-jcr.
- [x] **T010** Fix: `orderSlotsForDay` despacha por `mode` — flexible usa `arrivalSlots` sobre `reservation_services` (cada 15 min, dedup por salón), estricto sigue con `schedule`. El primer intento leía sólo `schedule` y en golf-jcr ofrecía 13:00/21:00, residuos del modo estricto. Tests de los dos modos.
- [ ] **T009** Verify en vivo con rol real: programar un retiro y un delivery en golf-jcr, chequear que solo ofrezca los chips del día y que el pedido caiga en «Próximos».
