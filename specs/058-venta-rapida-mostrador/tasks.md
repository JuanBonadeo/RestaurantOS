# Tasks: 058 — Venta rápida de mostrador (kiosko / bar)

Leyenda: `[ ]` pendiente · `[x]` hecho. **Sin migración** — no hay tabla ni columna nueva.

## Server — contrato y motor
- [x] **T001** `VentaMostradorInput` en `src/lib/orders/schema.ts` (Zod: `business_slug`, `items` min 1 reusando `OrderItemInput`, `method`, `caja_id` uuid, `tip_cents` default 0). Sin datos de cliente (FR-004).
- [x] **T002** Camino `dine_in` en `persistOrder` (`src/lib/orders/persist-order.ts`): saltea dirección/teléfono/fee de delivery y MP. **El enum público `CreateOrderInput` no cambia** — el tercer valor entra sólo por el tipo interno del staff (FR-005).
- [x] **T003** Test de `persistOrder`: `dine_in` sin mesa crea la orden sin exigir dirección; los tests existentes de `pickup`/`delivery` quedan verdes **sin editarlos** (no-regresión del checkout público).

## Server — el action
- [x] **T004** `venderMostrador` en `src/lib/orders/venta-mostrador.ts`: gate (`requireMozoActionContext` + `canCargarPedido`) → `persistOrder` (`dine_in`, `customer_name: 'Mostrador'`, `mozoId`) → `registrarPago(splitId: null)` → `closeOrderIfFullyPaid` → `routeOrderToCocina` en `try/catch`. Devuelve `{ orderId, orderNumber, totalCents, comandasCreadas, itemsSinSector }` (FR-004, FR-006, FR-008).
- [x] **T005** **Rollback de plata** (FR-007): si `registrarPago` falla, cancelar la orden (`cancelled_at` + `cancelled_reason = 'venta rápida no cobrada'`) antes de devolver el error. Test explícito: tras el fallo **no** queda ninguna orden `open` sin mesa.
- [x] **T006** Tests del gate y del scope: admin ok · encargado ok · **mozo rechazado** · personal rechazado · carrito vacío rechazado · producto de otro negocio rechazado (scope `business_id`).
- [x] **T007** Guard anti doble-submit en el server (lección spec 41 / #58): dos llamadas idénticas concurrentes no pueden dejar dos ventas cobradas.
- [x] **T008** Cajas + `payment_method_configs` **sin** exigir una orden previa (hoy `iniciarCobro` la exige). Quedó como `iniciarVentaMostrador(slug)` en `venta-mostrador.ts` — mismo gate que la venta, y avisa si el negocio no tiene ninguna caja. `iniciarCobro` no se tocó.

## Server — integración
- [ ] **T009** Test de integración "no ensucia la operación" (US2): tras vender, la orden **no** aparece en `getTodayOrders`, **no** cambia el `operational_status` de ninguna mesa, y **sí** suma en `getCajaLiveStats` del período. **Pendiente**: los unit tests ya fijan la causa (`dine_in` + `table_id` null + sin notificación) y el filtro del board está verificado por lectura ([`orders-query.ts:69`](../../src/lib/admin/orders-query.ts) y `:120`), pero falta el test que lo pruebe punta a punta contra la DB.
- [x] **T010** Test de ruteo (US3): ítem con sector → 1 comanda para ese sector; ítems sin sector → 0 comandas; fallo del ruteo → la venta **igual** queda cobrada y cerrada.

## Cliente
- [x] **T011** `src/components/admin/local/venta-rapida-panel.tsx`: buscador enfocado + resultados ↓/↑/Enter + `ProductModal` para modificadores + carrito con total, y al pie chips de método (con su ajuste) + select de caja + botón «Cobrar $X». Botón deshabilitado durante el `transition` (FR-002, FR-003).
- [x] **T012** Reset post-venta (FR-009): toast con el número de venta, carrito vacío, foco de vuelta en el buscador, panel abierto para la siguiente.
- [x] **T013** Botón «Facturar» sobre la última venta cobrada → `emitInvoice` con los defaults del negocio. Nunca bloqueante (FR-010).
- [x] **T014** `salon-desktop.tsx`: estado `ventaOpen` + modo `venta` en la cadena del `<aside>` con prioridad `paint > cobro > pedir > venta > detalle > lista`; sidebar a `440px` en ese modo.
- [x] **T015** Botón **«Venta rápida»** en el header de `ActiveTablesList`, junto a «Distribuir mozos», gateado por el mismo flag de rol (FR-001).
- [x] **T016** Cajas/`methodConfigs` en el panel. Se evaluó reusar la promesa `loadCaja` de `operacion/data.ts` y se descartó: obligaría a atravesar `LocalShell` → `SalonDesktop` → `ActiveTablesList` con datos que sólo usa este panel, y a pagarlos en cada carga del tab Salón. El panel los pide al abrirse (`iniciarVentaMostrador`), que es cuando hacen falta.

## Cierre
- [x] **T017** `pnpm typecheck` + `pnpm test` + `pnpm build` verdes.
- [ ] **T018** Verify en vivo con **rol real** (encargado, nunca service_role): vender efectivo → aparece en la caja elegida · vender con un producto de sector → sale la comanda · vender alfajor+coca → no imprime nada · board de Pedidos y plano del salón limpios · doble tap en «Cobrar» → una sola venta. **Bloqueado por dos cosas:** (a) la preview exige login y el agente no ingresa credenciales — lo corre Juan; (b) **`golf-jcr` no tiene ninguna caja activa** (verificado por SQL contra el cloud), así que el panel hoy abre en el aviso "creá una caja". Hay que crear la caja antes del verify — y afecta igual al cobro de mesa, no sólo a esto.
- [ ] **T019** Checklist de qa-brain (`tipos/web.md`) antes de dar por cerrado.
- [ ] **T020** Cerrar el loop: `wiki/features/caja.md` (sección venta rápida) + `wiki/features/mozo.md` si aplica + `wiki/specs/README.md` + `wiki/log.md`. Comentar + cerrar la issue.
