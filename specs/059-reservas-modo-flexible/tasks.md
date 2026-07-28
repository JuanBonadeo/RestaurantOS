# Tasks: Reservas — modo flexible

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md) · **Estado**: 🚧 en progreso (P1 fundaciones hecho; wiring+UI+P3 pendiente)

> ⛔ **Approval gate**: no arrancar código hasta (a) OK de Juan y (b) resolver `[NEEDS CLARIFICATION]` #1 (usable-antes-de-la-hora), #3 (gracia-flexible) y #5 (servicios-config). #2 (códigos del libro) y #4 (bar-reservable) no bloquean el core.
>
> `[P]` = paralelizable (archivos distintos, sin dependencia). TDD: los tests de lógica pura van **antes** que la implementación.

## Fase 0 — Pre-requisitos (destrabar el gate)

- [ ] **T001** Confirmar con Juan `[NEEDS CLARIFICATION]` #1/#3/#5 y anotar la resolución en `spec.md`.
- [ ] **T002** Preguntar al encargado los códigos del libro (#2: "H-A"/"H-S"/"R"/"-A") y si el BAR reserva (#4). Registrar en [`wiki/analyses/reservas-rediseno-modelo-flexible.md`](../../../../wiki/analyses/reservas-rediseno-modelo-flexible.md).
- [ ] **T003** Crear la GitHub Issue de la feature (`gh issue create`, milestone Post-demo) y linkearla en `spec.md`.

## Fase 1 — Fundaciones (bloquea a todo lo demás)

- [x] **T004** Migración `0022_reservations_modo_flexible.sql`: `reservation_settings.mode` (`estricto|flexible`, default `estricto`), `reservations.service` + `reservations.floor_plan_id`, y `reservation_services` (según #5). RLS de `reservation_services` (SELECT `is_business_staff`, write manager). Ver DDL borrador en `plan.md`.
- [x] **T005** Validar el approach de integridad: confirmar que con `ends_at = cierre del servicio` el GIST `reservations_no_overlap` cubre "una por mesa/servicio" y que mediodía/cena no se solapan. Si no → plan B (unique index parcial) en la misma migración.
- [ ] **T006** Aplicar `0022` al cloud vía MCP (`apply_migration`) + `pnpm db:types`. Verificar con `list_migrations`.
- [x] **T007** [P] `types.ts`/`schema.ts`: tipos `ReservationMode`, `ReservationService`, extender `Reservation` (service, floor_plan_id) y `ReservationSettings` (mode). Zod para la reserva flexible (service requerido; mesa/hora opcionales).

## Fase 2 — P1 · Reserva flexible sin desalojo (MVP) → US1 + US2

### Lógica pura (TDD: test primero)

- [x] **T008** [P] Test rojo `availability.test.ts`: `serviceWindow(service, date, tz)` → `[apertura, cierre]` UTC TZ-aware (bordes de día, DST).
- [x] **T009** [P] Test rojo: `isTableFreeForService(reservations, tableId, service, date)` (libre / ocupada por otra viva / ignora canceladas).
- [x] **T010** [P] Test rojo: `computeFlexibleAvailability(...)` — mesa puntual (libre/ocupada este servicio) y genérica (siempre disponible; warning si sobre-umbral, nunca false por capacidad).
- [x] **T011** Implementar `serviceWindow` + `isTableFreeForService` + `computeFlexibleAvailability` en `availability.ts` → tests verdes. **No tocar** `computeAvailableSlots`.

### Dispatch + booking

- [ ] **T012** `queries.ts`: `getAvailability` lee `mode` y bifurca (`estricto`→`computeAvailableSlots`, `flexible`→`computeFlexibleAvailability`). Único punto de dispatch (mantener consolidación spec 22).
- [ ] **T013** `booking-actions.ts`: `createReservation*` mode-aware. Flexible = insert directo (mesa/hora opcionales, `service` requerido, `ends_at = cierre`), **sin** `pickTable`; captura `23P01` → "La mesa ya está reservada en ese servicio". Estricto sin cambios.
- [ ] **T014** Test integración `booking`: en flexible, dos reservas misma mesa/servicio → segunda rechazada; genérica sin mesa aceptada; cancelar (soft-delete) libera la mesa del servicio.
- [ ] **T015** `settings-actions.ts` + UI de config: exponer/editar `mode` del negocio (gate `canConfigureReservations`).

### No-regresión estricto

- [ ] **T016** Verificar `availability.test.ts` + `assign-table.test.ts` **verdes sin cambios**; smoke de reserva estricto por los 3 canales (slots + pickTable + GIST idénticos a hoy).

## Fase 3 — P2 · Zonas + capacidad blanda + sentar → US3 + US4

- [ ] **T017** [P] Test rojo: `reservedCovers(reservations, { service, floorPlanId })` (suma party_size de vivas por servicio/zona).
- [ ] **T018** Implementar `reservedCovers` + warning de sobre-capacidad (advisory) → verde.
- [ ] **T019** Booking/edit: asignar **zona** (`floor_plan_id`) a una reserva (mesa puntual deriva su zona de la mesa; genérica la elige). Zonas opcionales (zona única implícita si no hay).
- [ ] **T020** Panel admin de reservas (modo flexible): totales de cubiertos por servicio/zona + aviso al pasar umbral (sin bloquear). Reusa el panel actual, vista flexible.
- [ ] **T021** Sentar (US4): asegurar que `sentarReserva`/`openTable` acepta reservas **genéricas** (setea `table_id` al sentar) y con-mesa (abre su mesa). Permisos `can.ts`.

## Fase 4 — P3 · Confirmación + no-show relacional → US5

- [ ] **T022** [P] Test rojo: predicado de vencimiento **flexible** en `no-show.ts` (no auto-libera; señala "demorada/por-confirmar").
- [ ] **T023** Implementar el predicado flexible + ajustar `mark_overdue_reservations_no_show()` para no auto-`no_show` en flexible (según #3) → verde.
- [ ] **T024** UI: estado de confirmación (reusa `client_confirmed_at`) + señal de "demorada" para acción manual.
- [ ] **T025** Chatbot: tools de disponibilidad responden por **servicio** en flexible (o diferir a fase posterior si el alcance es grande — decidir con Juan).

## Fase 5 — Cierre

- [ ] **T026** `pnpm typecheck` + `pnpm test` + `pnpm build` en verde.
- [ ] **T027** **Verify en vivo con rol real**: encargado de golf-house en un negocio en modo flexible (crear con mesa, genérica, doble-mesa rechazada, sentar, cancelar, totales).
- [ ] **T028** Actualizar [`wiki/features/reservas.md`](../../../../wiki/features/reservas.md) (documentar los dos modos) + índice `wiki/specs/README.md` (→ estado) + `wiki/log.md`. Commit atómico (stagear **solo** archivos de 059) + push + cerrar issue + bump submódulo.

## Checklist de QA (pre-entrega, stack web)

- [ ] Verificado con el **rol real** (encargado), nunca `service_role`.
- [ ] RLS de `reservation_services` probada con JWT del rol real.
- [ ] Timezone AR explícita en `serviceWindow` y en todo cómputo de fechas.
- [ ] Negocios en `estricto` (golf-jcr) sin cambio de comportamiento (SC-001).
- [ ] Soft-delete respetado (cancelar no borra).
