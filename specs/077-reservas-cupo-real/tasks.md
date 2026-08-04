# Tasks: Reservas flexibles — cupo real

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md) · **Estado**: ✅ P1 completo (2026-08-04) — cupo duro para el cliente + override del encargado, verificado en vivo. US3 (chatbot flexible) queda abierta: por ahora el bot deriva a la web en modo flexible.

> `[P]` = paralelizable (archivos distintos). TDD: los tests de lógica pura van **antes** que la implementación.

## Fase 0 — Arranque

- [x] **T001** Crear la GitHub Issue (`gh issue create`, milestone Post-demo · Growth & hardening) y linkearla en `spec.md`.

## Fase 1 — P1 · Tope duro para el cliente (US1)

### Lógica pura (TDD)

- [x] **T002** Test rojo en `flexible-availability.test.ts`: con `enforceCapacity: true`, `reservedCovers + party > soft_capacity` → `available: false`, `reason: "sin-cupo"`.
- [x] **T003** [P] Test rojo: con `enforceCapacity: true` y cero mesas libres que entren el party → `available: false`, `reason: "sin-mesas"` (aunque sobre cupo de cubiertos).
- [x] **T004** [P] Test rojo: `soft_capacity` nulo + mesas libres → `available: true` (sin umbral no significa infinito, pero tampoco bloquea por cubiertos).
- [x] **T005** [P] Test rojo: sin `enforceCapacity` (encargado) el comportamiento actual no cambia — genérica siempre `available: true` con `warning: "sobre-capacidad"`.
- [x] **T006** [P] Test rojo: mesa puntual ocupada + servicio lleno → gana `reason: "mesa-ocupada"` (más específico).
- [x] **T007** Implementar `enforceCapacity` + razones `sin-cupo`/`sin-mesas` en `computeFlexibleAvailability` → verde.

### Server

- [x] **T008** `queries.ts`: `getFlexibleAvailability` acepta y propaga `enforceCapacity` (default `false`).
- [x] **T009** [P] `schema.ts`: `enforce_capacity` en `FlexibleAvailabilityQuerySchema`; `allow_overbook` en `CreateFlexibleReservationInputSchema`.
- [x] **T010** `availability-actions.ts`: `fetchFlexibleAvailability` propaga el flag y devuelve `reason`.
- [x] **T011** `booking-actions.ts` — `createFlexibleReservation`: computar disponibilidad tras resolver el servicio; rechazar cuando `source !== "admin"` y no hay lugar, con mensaje según el motivo.

## Fase 2 — P1 · Override del encargado (US2)

- [x] **T012** `booking-actions.ts`: con `source: "admin"` y servicio lleno, exigir `allow_overbook: true`; ignorar el flag en canales de cliente. El rechazo por mesa puntual ocupada se mantiene siempre.
- [x] **T013** `new-reservation-modal.tsx`: extender el aviso a "no quedan mesas libres" y pedir confirmación explícita antes de mandar `allow_overbook`.

## Fase 3 — P1 · Flujo cliente (US1, UI)

- [x] **T014** `reservar-flow.tsx`: consultar `fetchFlexibleAvailability` (`enforce_capacity: true`) al cambiar fecha / servicio / salón / personas.
- [x] **T015** `reservar-flow.tsx`: ocultar horarios de llegada y mostrar el motivo cuando el servicio no tiene lugar; bloquear el submit; re-consultar tras un rechazo del server.

## Fase 4 — P2 · Chatbot (US3)

- [x] **T016a** Corte provisorio: en flexible el bot no ofrece ni toma reservas — deriva al link web (`flexible_mode_web_only`) en disponibilidad, intent y confirmación.
- [ ] **T016** `chatbot-actions.ts`: dispatch por `settings.mode` en la tool de disponibilidad (servicios + cupo en flexible). → issue aparte
- [ ] **T017** `chatbot-actions.ts`: la creación por bot en flexible pasa por `createFlexibleReservation` (sin override). → issue aparte

## Fase 5 — Cierre

- [x] **T018** `pnpm typecheck` + tests unitarios en verde (los `*.integration.test.ts` fallan por el stack local apagado, ruido conocido). `pnpm build` no se corrió: el `.next` lo comparten sesiones paralelas con su dev server.
- [x] **T019** Verify en vivo (`golf-jcr`, /reservar): Terraza + 10 personas (mesa máx. 8) → "No nos queda mesa para esa cantidad de personas", sin horarios ni CTA; Salón principal + 10 (mesa de 12) → horarios normales. El corte por **cubiertos** queda cubierto por unit tests (forzarlo en vivo exigía tocar la config del cloud a mano).
- [ ] **T020** Confirmar con el encargado que el cupo configurado (100 por servicio/zona) es el número real — recién ahora tiene efecto.
- [ ] **T021** Actualizar [`wiki/features/reservas.md`](../../../../wiki/features/reservas.md), tildar tasks, comentar + cerrar la issue, loggear en `wiki/log.md`.
