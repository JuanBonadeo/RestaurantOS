---
description: "Task list — spec 45: notificaciones al cliente por email"
---

# Tasks: Notificaciones al cliente por email (puente pre-WhatsApp)

> **Nota (2026-08-03):** tildado retroactivamente. Estas tasks se implementaron y shippearon pero el archivo nunca se actualizó; el estado se reconstruyó desde el código y la issue cerrada. Lo que sigue sin tildar es lo que realmente falta (verify en vivo con rol real).


**Input**: `specs/045-notificaciones-cliente-email/` (spec.md, plan.md) · **Issue**: #62

**Tests**: incluidos (TDD) para lógica pura de canal, templates, idempotencia y ventana del recordatorio.

> **Progreso (2026-07-15):** implementado el core completo. Migraciones `0010` (canal + email + `confirm_token` + `customer_message_log`) y `0011` (cron recordatorio) **aplicadas al cloud**. Capa de canal + US2 (pedidos) + US3 (reserva **con double opt-in**, `confirm_token` + ruta `/reservar/confirmar/[token]`) + US4 (cron) + US5 (comprobante AFIP, hook en emit+poll) + UI (selector de canal). `typecheck` verde, 549 unit tests verdes. **Pendiente:** dominio verificado en Resend + flip de golf-house a `email` (espera a Resend) + verificación en vivo. **Sin commitear.**

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Crear branch `045-notificaciones-cliente-email` en el submódulo.
- [x] T002 Escribir migración `supabase/migrations/0010_customer_channel_email.sql` (columnas `businesses.customer_channel`, `orders.customer_email`, `reservations.customer_email`; tabla `customer_message_log` con UNIQUE `(business_id,event,ref_id,channel)`, service-role-only).

---

## Phase 2: Foundational (BLOQUEA todas las US) — US1 canal configurable

**⚠️ CRITICAL**: nada de US2+ arranca hasta cerrar esta fase.

- [x] T003 Aplicar `0010` a la DB cloud vía MCP (`apply_migration`) y correr `pnpm db:types`.
- [x] T004 [P] [US1] Test rojo: `customer-channel.test.ts` — `resolveCustomerChannel` (default `whatsapp`, lee `businesses.customer_channel`) y `dispatchCustomerMessage` (rutea a canales activos; `email` sin email → `skipped`; `both` independiente).
- [x] T005 [P] [US1] Test rojo: `customer-templates.test.ts` — render de subject/HTML por evento + placeholders + reuso de supresión.
- [x] T006 [US1] Implementar `src/lib/notifications/customer-channel.ts` (`resolveCustomerChannel` + `dispatchCustomerMessage`, best-effort, dedup contra `customer_message_log`).
- [x] T007 [US1] Implementar `src/lib/notifications/email-outbox.ts` (`enqueueEmail`, espejo de `whatsapp-outbox.ts`, registra en `customer_message_log`, despacha vía `sendEmail`, nunca lanza).
- [x] T008 [US1] Implementar `src/lib/email/customer-templates.ts` (render por evento con branding del negocio).
- [x] T009 [US1] Verde: T004–T005 pasan; `pnpm typecheck`.

**Checkpoint**: capa de canal lista, con email como canal despachable.

---

## Phase 3: US2 — Avisos de estado de pedido por email (Priority: P1) 🎯 MVP

**Goal**: el cliente recibe por email los cambios de estado y el agendado del pedido diferido.

- [x] T010 [US2] Poblar `orders.customer_email` en la server action de creación de pedido online (desde el cliente logueado / `customers.email`).
- [x] T011 [US2] Test rojo: `delivery-notify` despacha por email cuando el negocio está en `email` (y no encola WhatsApp); dine_in/on_the_way suprimidos igual que hoy.
- [x] T012 [US2] Refactor `delivery-notify.ts`: `notifyDeliveryStatusChange` / `notifyScheduledConfirmed` construyen payload agnóstico y delegan en `dispatchCustomerMessage` (rama WhatsApp intacta; carga `customer_email`).
- [x] T013 [US2] Templates de email para estados de pedido + agendado (reusa `renderDeliveryMessage` para el texto base).
- [x] T014 [US2] Verde: tests + `pnpm typecheck`.

**Checkpoint**: pedidos online avisan por email en negocio `email`, sin regresión en `whatsapp`.

---

## Phase 4: US3 — Confirmación de reserva por email (Priority: P1)

**Goal**: acuse de reserva por email al crear, con link de gestión.

- [x] T015 [US3] Poblar `reservations.customer_email` en `createReservationFromCustomer` (desde `auth.users.email` del `user_id`).
- [x] T016 [US3] Test rojo: crear reserva de cliente logueado → despacha `reservation_confirmed`; sin `user_id` → no envía.
- [x] T017 [US3] Implementar `notifyReservationConfirmed({reservationId})` (best-effort) y dispararlo tras crear la reserva (`booking-actions.ts` / `chatbot-confirm-action.ts`).
- [x] T018 [US3] Template de email de confirmación de reserva (fecha/hora/personas/local + link `/perfil/reservas`).
- [x] T019 [US3] Verde: tests + `pnpm typecheck`.

**Checkpoint**: reservas avisan acuse por email.

---

## Phase 5: US4 — Recordatorio de reserva (Priority: P2)

**Goal**: recordatorio informativo antes del turno, vía cron idempotente.

- [x] T020 [P] [US4] Test rojo: predicado puro de ventana de recordatorio (espejo TS, sin correr el cron; patrón `isOverdueConfirmed`).
- [x] T021 [US4] Implementar `src/lib/reservations/reminders.ts` (selección de reservas en ventana, idempotencia vía `customer_message_log`).
- [x] T022 [US4] Endpoint/cron `reservations-reminder` (patrón `sendDueShiftSummaries`) — schedule en migración o `vercel.json` según el patrón existente.
- [x] T023 [US4] Template de recordatorio + verde: tests + `pnpm typecheck`.

**Checkpoint**: recordatorio saliendo por el canal del negocio.

---

## Phase 6: US5 — Comprobante fiscal por email (Priority: P2)

**Goal**: enviar el comprobante tras emisión AFIP exitosa.

- [x] T024 [US5] Hook best-effort post-emisión en `src/lib/afip/emit-invoice.ts` → `dispatchCustomerMessage(event: invoice_issued)` (una sola vez, no bloquea el flujo fiscal).
- [x] T025 [US5] Template de email del comprobante (datos fiscales + total) + test de idempotencia + `pnpm typecheck`.

**Checkpoint**: comprobante por email tras facturar.

---

## Phase 7: UI, docs y verificación

- [x] T026 [US1] Selector de `customer_channel` en la config del negocio (`src/components/admin/settings/…`) + server action de guardado.
- [x] T027 UPDATE de datos: setear `customer_channel='email'` para los negocios de golf-house (House, Golf).
- [x] T028 `pnpm test` + `pnpm typecheck` en verde (suite completa).
- [ ] T029 Verificación en vivo con Resend (dominio verificado) usando el rol real — pedido de prueba end-to-end (bloqueado por dominio Resend).
- [x] T030 Actualizar `wiki/features/notificaciones.md` y `chatbot.md` (canal por negocio + email); loggear en `wiki/log.md`; cerrar #62.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**: la migración debe estar aplicada + types antes de la capa.
- **Phase 2 (Foundational)**: BLOQUEA US2–US5. Es el MVP fundacional (canal despachable).
- **US2, US3**: P1 — arrancan tras Phase 2, independientes entre sí.
- **US4, US5**: P2 — tras Phase 2; US4 se apoya en el contacto de reserva (US3) para datos.
- **Phase 7**: tras las US deseadas; T029 bloqueado por la verificación del dominio Resend (operativo, del cliente).

## Notes

- Best-effort en todo el canal cliente: ningún envío rompe la operación.
- Commit atómico por tarea/bloque referenciando #62; push al cerrar cada bloque.
- Verificar en vivo con el **rol real**, nunca service_role.
- Double opt-in de reserva queda fuera (ver Out of Scope del spec).
