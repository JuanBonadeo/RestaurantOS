# Tasks — 067 · El plano puede mostrar el nombre del cliente + buscador de cliente al sentar

- [x] **T001** Migración `0029_floor_plan_mostrar_nombre_cliente.sql`: `floor_plans.show_customer_name boolean not null default false` + comment. **Aplicada al cloud** (`tjfufswzsxfujcpoxapx`) por MCP y verificada por SQL contra `information_schema`.
- [x] **T002** `FloorPlan.show_customer_name` en `types.ts` y `SaveFloorPlanInputSchema`; `saveFloorPlan` lo persiste en los tres caminos (update por id, update legacy, insert).
- [x] **T003** Tests de [`table-display-name.test.ts`](../../src/lib/mozo/table-display-name.test.ts): la reserva manda sobre la orden, los placeholders (`Mesa`, `Walk-in`, `-`) no son nombres, walk-in anónimo → `null`, y el recorte para que entre en la mesa.
- [x] **T004** `src/lib/mozo/table-display-name.ts`: `tableDisplayName`, `isPlaceholderName`, `fitNameToTable` (puros).
- [x] **T005** `use-floor-plan-store.ts` + `floor-plan-editor.tsx`: estado `showCustomerName`, interruptor «En vivo → mostrar el nombre del cliente en las mesas ocupadas», init desde el plano y envío en `onSave`.
- [x] **T006** `floor-plan-viewer.tsx`: `TableExtra.customerName`, prop `show_customer_name` del plano, y render — mesa ocupada con nombre conocido muestra **sólo** el nombre; sin nombre o libre, el rótulo de siempre.
- [x] **T007** `salon-desktop.tsx`: `customerName` en los extras y el sidebar reusa `tableDisplayName` (se elimina la resolución inline duplicada).
- [x] **T008** `customer-search-field.tsx` (nuevo): buscador de clientes con debounce, ↓/↑/Enter/Escape, texto libre permitido; sólo llama a `buscarClientes`.
- [x] **T009** `walk-in-modal.tsx`: el campo «Nombre» pasa a ser «Cliente» con el buscador; elegir un cliente prellena nombre + teléfono.
- [x] **T010** `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes; `pnpm test` 894 pass / 140 skip (los 16 `*.integration.test.ts` fallan por falta del stack Supabase local — preexistente).
- [x] **T011** Wiki: [`features/mesas-qr.md`](../../../wiki/features/mesas-qr.md) / [`features/admin.md`](../../../wiki/features/admin.md) y [`features/mozo.md`](../../../wiki/features/mozo.md).
- [ ] **T012** Verify en vivo con rol real: activar la opción en un salón de golf-jcr, sentar a alguien y chequear que el plano muestre el nombre; y que el buscador del walk-in traiga clientes (nunca productos).

## Notas

- **Solapamiento con la spec 066** (#103): esa sesión commiteó y pusheó (`89df67f`) antes de que esta tocara `walk-in-modal.tsx` / `salon-desktop.tsx`, así que no hubo conflicto real.
- El hook de diseño marca `layout-transition` en `floor-plan-editor.tsx` (`transition: width 80ms` del zoom). Es **preexistente** y ajeno a esta spec: no se toca.
