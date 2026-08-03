# Tasks: 057 — Avisos libres a la comandera de un sector

Leyenda: `[ ]` pendiente · `[x]` hecho. **Requiere el spec 051 mergeado** (relay + `src/lib/print/ticket.ts`) — 057 no toca el `.exe`.

## Datos
- [ ] **T001** Migración `0021_station_messages.sql` (aditiva): tabla `station_messages` + índice parcial `(business_id) where printed_at is null` + RLS members select/insert. Aplicar al cloud (MCP) + `pnpm db:types` (FR-006).

## Server — enviar
- [ ] **T002** `src/lib/avisos/schema.ts` — `AvisoInput` (Zod: `target` uuid|`"todos"`, `body` trim/min1/max200) (FR-002).
- [ ] **T003** Helper `canEnviarAvisoComandera(role) = admin || encargado` en `src/lib/permissions/can.ts` + `enviarAvisoComandera(slug, target, body)` en `src/lib/avisos/actions.ts` (FR-001, FR-003, FR-004, FR-005): gate, resuelve stations destino (`printer_enabled=true`), inserta filas, scope `business_id`.
- [ ] **T004** Test de `enviarAvisoComandera`: admin y encargado ok; **mozo rechazado**; body vacío/>200 rechazado; un sector → 1 fila; «todos» → N filas (solo activas); cross-tenant rechazado.

## Render (server, vía 051)
- [ ] **T005** `buildAvisoContent(message) → { escpos_b64, plain }` en `src/lib/print/ticket.ts` (banner AVISO + sector + body grande + hora/autor) + test. **No se toca `agent.mjs`** — el relay imprime cualquier `content_escpos_b64`.

## API / print-agent
- [ ] **T006** `getPendingStationMessages(businessId)` en `src/lib/avisos/queries.ts`: avisos `printed_at IS NULL` con sector de comandera activa (FR-007).
- [ ] **T007** `GET /api/print-agent`: sumar `messages[]` con `body` saneado por `sanitizeTicketText` **antes** de `buildAvisoContent`, incluyendo `content_escpos_b64`/`content_plain` + test del payload y del saneo (FR-007).
- [ ] **T008** `POST /api/print-agent`: rama `message_id` → `printed_at` (ok) / `print_failed_at` (failed) + ownership `business_id`; el path de `comanda_id` queda intacto. Test ok/failed + cross-tenant (FR-008).

## Cliente
- [ ] **T009** `comandas-kanban.tsx`: botón **«Enviar aviso»** (solo si `canEnviarAvisoComandera`) + `EnviarAvisoModal` (select sector + «Todos» + textarea máx 200 con contador + Enviar). Loading explícito + toast (FR-010). Exponer `printer_enabled` de stations en `local-query.ts` si falta.

## Cierre
- [ ] **T010** `pnpm typecheck` + `pnpm test` verdes.
- [ ] **T011** Verify en vivo con **rol real** (admin o encargado): aviso a un sector → ticket AVISO en su comandera; aviso a «Todos» → copia por sector. **Sin `.exe` nuevo** (relay de 051). Actualizar `wiki/features/comandas.md` + `wiki/specs/README.md` + `wiki/log.md`. Comentar + cerrar la issue.
