# Tasks: 063 — Comanda de control para delivery y retiro

Leyenda: `[ ]` pendiente · `[x]` hecho.

## Datos
- [x] **T001** Migración `0028_comanda_de_control.sql`: tabla `control_tickets` (`order_id` único → idempotencia, `business_id`, `status`, `emitted_at`, `printed_at`, `print_failed_at`, `reprint_requested_at`) + índices + RLS (select por membresía, sin write para anon/authenticated) y las tres columnas de comandera en `businesses` (FR-001, FR-002).
- [x] **T002** Aplicar al cloud vía MCP + tipos + `get_advisors` sin hallazgos nuevos.

## Render
- [x] **T003** Exportar `toAscii` / `wrap` / `RULE` desde `ticket.ts` para reusarlos sin duplicar (hoy son privados).
- [x] **T004** `src/lib/print/control-ticket.ts`: `ControlTicketData` + `buildControlTicketLines` + `buildControlTicketContent` (FR-007). Precios formateados en ASCII, sin símbolo de moneda no-ASCII.
- [x] **T005** Tests de render: delivery impago muestra «A COBRAR» con el total · pagado muestra «PAGADO - NO COBRAR» · retiro no imprime la línea de repartidor ni la dirección · programado muestra la hora de entrega, sin programar muestra «Lo antes posible» · el texto sale 100% ASCII imprimible.

## Emisión
- [x] **T006** `emitControlTicket(orderId, businessId)` en `src/lib/print/control-ticket-emit.ts`: lee el tipo de la orden, sale si es `dine_in`, inserta con `on conflict do nothing` (FR-003).
- [x] **T007** Engancharlo en `routeOrderToCocina` después de crear las comandas, en `try/catch` que no tumbe la marcha (FR-004).
- [x] **T008** Tests: delivery → 1 ticket · retiro → 1 · `dine_in` → 0 · marchar dos veces → sigue 1 (SC-001/002) · si la emisión falla, la marcha devuelve ok igual (SC-003).

## Print-agent
- [x] **T009** `GET`: sumar los control tickets `pendiente`/con reimpresión al array `comandas`, con la comandera del negocio y `station_name: "CONTROL"` (FR-005). Saltear si `control_printer_enabled` es false o la IP está vacía.
- [x] **T010** `POST`: si el id no está en `comandas`, resolverlo contra `control_tickets` — mismo check de ownership por `business_id`, mismo manejo de `ok` / `failed` (FR-006).
- [x] **T011** Tests de la ruta: un control pendiente aparece en el GET con su IP · no aparece si la comandera está apagada · el POST `ok` lo marca impreso · el POST de otro negocio da 404 · el `failed` setea `print_failed_at` sin cambiar el estado.

## Configuración
- [x] **T012** Campo de comandera de control (IP + puerto + switch) en Ajustes → Operación del local, junto a las comanderas por sector, con su action y el gate de encargado/admin (FR-009).

## Cierre
- [x] **T013** `pnpm typecheck` + `pnpm test` en verde.
- [ ] **T014** Actualizar [`wiki/features/comandas.md`](../../../wiki/features/comandas.md) y [`wiki/features/pedidos.md`](../../../wiki/features/pedidos.md); log en `wiki/log.md`.
- [ ] **T015** Verify en vivo con el print-agent: configurar la IP, marchar un delivery, ver salir los dos tickets.
