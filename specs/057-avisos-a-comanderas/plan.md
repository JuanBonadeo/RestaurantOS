# Implementation Plan: 057 — Avisos libres a la comandera de un sector

## Enfoque

Un aviso es **un ticket sin orden**. Todo se monta sobre el canal print-agent que ya existe (specs 28/33/35): mismo pull `GET /api/print-agent`, mismo `POST` de confirmación, mismo transporte TCP, mismo `sanitizeTicketText`, mismo destino `stations.printer_ip`. Lo único nuevo es **una tabla propia** (`station_messages`) — no se reusa `comandas` para no ensuciar el kanban / batch / "combina con" con filas sin orden. Sin máquina de estados: `printed_at IS NULL` = pendiente. Sin cambios de RLS más allá de la tabla nueva. **Depende del spec 051** (render en server): el ticket AVISO lo arma el server (`src/lib/print/ticket.ts`) y el agente **relay** lo imprime → 057 **no toca el `.exe`**. Se implementa **después** de 051.

## Capas

### Datos
- Migración `0021_station_messages.sql` (aditiva): tabla `station_messages` + índice parcial `(business_id) where printed_at is null` + RLS members (select/insert), coherente con `comandas`. Aplicar al cloud (MCP) + `pnpm db:types`.

### Server (dominio)
- Módulo nuevo `src/lib/avisos/` (o co-ubicado en `comandas/`): 
  - `schema.ts` — `AvisoInput` (Zod: `target` = uuid | `"todos"`, `body` trim/min1/max200).
  - `actions.ts` — `enviarAvisoComandera(slug, target, body)`: gate `canEnviarAvisoComandera` (admin/encargado, helper nuevo en `can.ts`), valida, resuelve stations destino (una o todas las `printer_enabled`), inserta filas. Service client + scope `business_id` (FR-001..FR-005).
  - `queries.ts` — `getPendingStationMessages(businessId)`: avisos `printed_at IS NULL` join `stations` con comandera activa, para el GET.

### API / print-agent
- `src/lib/print/ticket.ts` (de 051): sumar `buildAvisoContent(message) → { escpos_b64, plain }` (banner AVISO + sector + body grande + hora/autor). **El agente relay (051) imprime ese contenido sin cambios** — 057 **no toca `agent.mjs`**.
- `GET /api/print-agent` ([`route.ts`](../../src/app/api/print-agent/route.ts)): tras armar `comandas`, sumar `messages` vía `getPendingStationMessages`, con `body` saneado por `sanitizeTicketText` **antes** de `buildAvisoContent`; cada `message` lleva `content_escpos_b64`/`content_plain` (FR-007).
- `POST /api/print-agent`: rama nueva cuando el body trae `message_id` en vez de `comanda_id` → `printed_at`/`print_failed_at` con ownership por `business_id` (FR-008). Refactor menor: extraer el discriminador al inicio del handler. El relay ya postea el `id` que le llega.

### Cliente
- `local-query.ts`: `getStationsForLocal` ya trae las stations; exponer `printer_enabled` para poblar el selector (si no está ya).
- `comandas-kanban.tsx`: botón **«Enviar aviso»** en el header del tab (junto a la pill de salud del agente), visible si el rol pasa `canEnviarAvisoComandera` (admin/encargado); modal `EnviarAvisoModal` (select sector + «Todos» + textarea con contador + Enviar). Loading explícito, toast de éxito (FR-010).

## Orden (TDD)
**Requiere 051 mergeado** (relay + `src/lib/print/ticket.ts`).
1. Migración `0021` + aplicar al cloud + `db:types`.
2. `schema.ts` + `enviarAvisoComandera` + test (gate admin/encargado, rechazo mozo, validación body, un-sector vs todos, scope cross-tenant).
3. `buildAvisoContent` en `src/lib/print/ticket.ts` (+ test) → `getPendingStationMessages` → GET expone `messages` con contenido (test del payload + saneo) → POST rama `message_id` (test ok/failed + ownership).
4. **No se toca `agent.mjs`** (el relay ya imprime cualquier `content_escpos_b64`).
5. UI: botón + `EnviarAvisoModal`.
6. `pnpm typecheck` + `pnpm test`.
7. Verify en vivo (admin/encargado real + relay: ticket AVISO a un sector y a todos). **Sin `.exe` nuevo** (el relay de 051 ya está en golf).

## Riesgos
- **Inyección ESC/POS por el body**: mitigado con `sanitizeTicketText` en el GET (mismo choke point que las comandas) + `max(200)` en la action. **No** confiar solo en el cliente.
- **Sector sin comandera**: la action solo acepta/ofrece `printer_enabled=true`; «Todos» filtra igual → ningún aviso queda colgado.
- **Depende de 051**: 057 se implementa **después** del relay. Si golf siguiera con el agente pre-051, no imprime avisos hasta migrar al relay (degradación documentada, FR-009) — pero **no hay `.exe` nuevo por 057**.
- **POST con dos discriminadores** (`comanda_id` vs `message_id`): mantener el path de comandas intacto; el `message_id` es una rama temprana y aislada. Tests de ambos.
- **"Todos" con muchos sectores**: es un `insert` múltiple acotado (≤ nº de stations) — sin problema de escala.
