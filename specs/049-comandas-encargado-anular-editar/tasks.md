# Tasks: 049 — Anular y editar comandas (encargado)

> **Nota (2026-08-03):** tildado retroactivamente. Estas tasks se implementaron y shippearon pero el archivo nunca se actualizó; el estado se reconstruyó desde el código y la issue cerrada. Lo que sigue sin tildar es lo que realmente falta (verify en vivo con rol real).


Leyenda: `[ ]` pendiente · `[x]` hecho.

## Datos
- [x] **T001** Migración `0016_comanda_anulacion.sql` (aditiva: `comandas.cancelled_at/reason/by`). Aplicar al cloud (MCP) + `pnpm db:types`.

## Server — anular
- [x] **T002** `cancelarComanda(slug, comandaId, motivo)` en `comandas/actions.ts` (FR-001..FR-006).
- [x] **T003** Test `cancelarComanda`: gate mozo rechazado, scope cross-tenant, cancela ítems + comanda, setea `reprint_requested_at`, rechaza entregada/ya-anulada, recalcula total.

## Server — editar
- [x] **T004** `editarItemComanda(slug, orderItemId, patch)` (FR-007..FR-010).
- [x] **T005** Test `editarItemComanda`: gate, scope, cambio de cantidad/nota/producto (re-snapshot + recalculo), rechazo de combo/cancelado.
- [x] **T006** `getSwappableProducts(slug, stationId)` — productos que rutean al sector (FR-012) + test de routing/scope.

## API / print-agent
- [x] **T007** `GET /api/print-agent`: `cancelled` + `cancelled_reason` en el payload (FR-013) + test.
- [x] **T008** `agent.mjs`: ticket **ANULADA** cuando `cancelled` (FR-014).

## Cliente
- [x] **T009** `local-query.ts`: `LocalComandaItem.product_id` + `is_combo`; `LocalComanda.cancelled_at`.
- [x] **T010** `comandas-kanban.tsx`: botones + `AnularComandaModal` (motivo) + `EditarComandaModal` (ítems + picker). Loading explícito (FR-011, FR-015).

## Cierre
- [x] **T011** `pnpm typecheck` + `pnpm test` verdes.
- [ ] **T012** Verify en vivo con **rol real** (encargado): anular → ticket ANULADA; editar producto → ticket corregido. Actualizar `wiki/features/comandas.md` + `wiki/specs/README.md` + log. Comentar + cerrar issue #73.
