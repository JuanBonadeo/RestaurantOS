# Tasks: Reservas flexibles — cupo real

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md) · **Estado**: 🚧 en implementación (2026-08-04)

> `[P]` = paralelizable (archivos distintos). TDD: los tests de lógica pura van **antes** que la implementación.

## Fase 0 — Arranque

- [ ] **T001** Crear la GitHub Issue (`gh issue create`, milestone Post-demo · Growth & hardening) y linkearla en `spec.md`.

## Fase 1 — P1 · Tope duro para el cliente (US1)

### Lógica pura (TDD)

- [ ] **T002** Test rojo en `flexible-availability.test.ts`: con `enforceCapacity: true`, `reservedCovers + party > soft_capacity` → `available: false`, `reason: "sin-cupo"`.
- [ ] **T003** [P] Test rojo: con `enforceCapacity: true` y cero mesas libres que entren el party → `available: false`, `reason: "sin-mesas"` (aunque sobre cupo de cubiertos).
- [ ] **T004** [P] Test rojo: `soft_capacity` nulo + mesas libres → `available: true` (sin umbral no significa infinito, pero tampoco bloquea por cubiertos).
- [ ] **T005** [P] Test rojo: sin `enforceCapacity` (encargado) el comportamiento actual no cambia — genérica siempre `available: true` con `warning: "sobre-capacidad"`.
- [ ] **T006** [P] Test rojo: mesa puntual ocupada + servicio lleno → gana `reason: "mesa-ocupada"` (más específico).
- [ ] **T007** Implementar `enforceCapacity` + razones `sin-cupo`/`sin-mesas` en `computeFlexibleAvailability` → verde.

### Server

- [ ] **T008** `queries.ts`: `getFlexibleAvailability` acepta y propaga `enforceCapacity` (default `false`).
- [ ] **T009** [P] `schema.ts`: `enforce_capacity` en `FlexibleAvailabilityQuerySchema`; `allow_overbook` en `CreateFlexibleReservationInputSchema`.
- [ ] **T010** `availability-actions.ts`: `fetchFlexibleAvailability` propaga el flag y devuelve `reason`.
- [ ] **T011** `booking-actions.ts` — `createFlexibleReservation`: computar disponibilidad tras resolver el servicio; rechazar cuando `source !== "admin"` y no hay lugar, con mensaje según el motivo.

## Fase 2 — P1 · Override del encargado (US2)

- [ ] **T012** `booking-actions.ts`: con `source: "admin"` y servicio lleno, exigir `allow_overbook: true`; ignorar el flag en canales de cliente. El rechazo por mesa puntual ocupada se mantiene siempre.
- [ ] **T013** `new-reservation-modal.tsx`: extender el aviso a "no quedan mesas libres" y pedir confirmación explícita antes de mandar `allow_overbook`.

## Fase 3 — P1 · Flujo cliente (US1, UI)

- [ ] **T014** `reservar-flow.tsx`: consultar `fetchFlexibleAvailability` (`enforce_capacity: true`) al cambiar fecha / servicio / salón / personas.
- [ ] **T015** `reservar-flow.tsx`: ocultar horarios de llegada y mostrar el motivo cuando el servicio no tiene lugar; bloquear el submit; re-consultar tras un rechazo del server.

## Fase 4 — P2 · Chatbot (US3)

- [ ] **T016** `chatbot-actions.ts`: dispatch por `settings.mode` en la tool de disponibilidad (servicios + cupo en flexible).
- [ ] **T017** `chatbot-actions.ts`: la creación por bot en flexible pasa por `createFlexibleReservation` (sin override).

## Fase 5 — Cierre

- [ ] **T018** `pnpm typecheck` + `pnpm test` + `pnpm build` en verde.
- [ ] **T019** Verify en vivo con el rol real (encargado de `golf-jcr`): servicio lleno → cliente sin cupo, encargado con override.
- [ ] **T020** Confirmar con el encargado que el cupo configurado (100 por servicio/zona) es el número real — recién ahora tiene efecto.
- [ ] **T021** Actualizar [`wiki/features/reservas.md`](../../../../wiki/features/reservas.md), tildar tasks, comentar + cerrar la issue, loggear en `wiki/log.md`.
