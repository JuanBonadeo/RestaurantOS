# Implementation Plan: 058 — Venta rápida de mostrador (kiosko / bar)

## Enfoque

**Cero motor nuevo.** Todas las piezas existen y están testeadas: `persistOrder` crea órdenes sin mesa, `registrarPago` acepta `splitId: null`, `closeOrderIfFullyPaid` saltea la liberación de mesa cuando no hay mesa, `routeOrderToCocina` saltea los ítems sin sector, `emitInvoice` es order-scoped. Lo que falta es **un action que las encadene** y **una pantalla que las junte**.

Las dos decisiones de diseño que hacen o rompen la feature:

1. **`delivery_type = 'dine_in'` sin `table_id`** (patrón del pedido flash). Es lo que mantiene la venta fuera del board (`getTodayOrders` filtra `dine_in`) y fuera del plano (que lista por `table_id`). La alternativa — `pickup` — ensuciaría la columna "Nuevos" con cada coca vendida.
2. **Un solo action, plata primero.** `venderMostrador` crea + cobra + cierra en una llamada. Si el pago falla, cancela la orden (FR-007). El ruteo a cocina va **después** del cobro y no puede revertirlo.

## Capas

### Datos
**Sin migración.** No hay tabla ni columna nueva. La orden de mostrador se distingue por `delivery_type='dine_in' AND table_id IS NULL` — igual que el pedido flash, que ya convive así desde spec 09.

### Server (dominio)
- `src/lib/orders/schema.ts` — `VentaMostradorInput` (Zod): `business_slug`, `items` (reusa `OrderItemInput`, min 1), `method`, `caja_id` (uuid), `tip_cents` (default 0). Sin datos de cliente.
- `src/lib/orders/persist-order.ts` — el contrato interno acepta hoy `delivery_type ∈ {delivery, pickup}`. Se suma el camino `'dine_in'`: saltea validación de dirección/teléfono/fee de delivery y no toca MP. **El checkout público no cambia** (su `CreateOrderInput` sigue con el enum de dos valores; el tercer valor entra sólo por el tipo interno que usa el staff).
- `src/lib/orders/venta-mostrador.ts` — action `venderMostrador(input)`:
  1. `getBusiness` + `requireMozoActionContext` + `canCargarPedido` (admin/encargado).
  2. `persistOrder({ …, delivery_type: 'dine_in', customer_name: 'Mostrador', customer_phone: '-' }, userId, { mozoId })`.
  3. `registrarPago({ orderId, splitId: null, method, cajaId, amount_cents: total, tip_cents })` → si falla: cancelar la orden (`cancelled_at` + `cancelled_reason`) y devolver el error (FR-007).
  4. `routeOrderToCocina(orderId, businessId)` — en `try/catch`, **no** revierte la venta (FR-008). Devuelve `comandasCreadas` / `itemsSinSector` para el toast.
  5. Devuelve `{ orderId, orderNumber, totalCents, comandasCreadas }`.
- `queries.ts` — `getCajasParaVenta(businessId)`: cajas + `payment_method_configs`. Reusa lo que ya arma `iniciarCobro`; se extrae el pedazo que no necesita una orden previa (hoy `iniciarCobro` exige `orderId`, y acá la orden todavía no existe).

### Cliente
- `src/components/admin/local/venta-rapida-panel.tsx` — panel del sidebar: buscador enfocado + resultados ↓/↑/Enter + carrito + total, y al pie el bloque de cobro (chips de método con su ajuste, select de caja, botón «Cobrar $X»). Reusa `ProductModal` y la lógica de índice de `product-search.ts`, igual que `cargar-pedido-sheet` fase 2. Tras cobrar: toast + reset del carrito + foco al buscador (FR-009), y un botón «Facturar» sobre la última venta (FR-010).
- `src/components/admin/local/salon-desktop.tsx`:
  - Estado `ventaOpen` + entrada en la cadena de modos del `<aside>` ([`:934`](../../src/components/admin/local/salon-desktop.tsx)), con prioridad `paint > cobro > pedir > venta > detalle > lista`.
  - Botón **«Venta rápida»** en el header de `ActiveTablesList` ([`:1476`](../../src/components/admin/local/salon-desktop.tsx)), junto a «Distribuir mozos», gateado por el mismo flag de rol.
  - El panel de venta ensancha el sidebar (`lg:grid-cols-[1fr_440px]`, mismo ancho que `pedir`).
- `src/components/admin/local/local-shell.tsx` — pasar cajas/`methodConfigs` al tab Salón si no llegan ya (el tab Caja ya los carga vía `loadCaja`; evaluar reusar esa promesa antes de sumar una query).

## Orden (TDD)
1. `VentaMostradorInput` + camino `dine_in` en `persistOrder` + test (crea orden sin mesa, sin exigir dirección; el path `pickup`/`delivery` no regresiona).
2. `venderMostrador` + tests: encargado ok / **mozo rechazado** / carrito vacío / cross-tenant / **pago falla → orden cancelada, no queda abierta** / ruteo falla → la venta igual queda cobrada.
3. Test de integración: tras vender, la orden **no** está en `getTodayOrders` y **sí** suma en `getCajaLiveStats`; ninguna mesa cambió de estado.
4. Test de ruteo: ítem con sector → 1 comanda; ítem sin sector → 0 comandas.
5. UI: panel + botón + cadena de modos.
6. `pnpm typecheck` + `pnpm test` + `pnpm build`.
7. Verify en vivo con **rol real** (encargado, no service_role): vender efectivo → aparece en caja; vender con tostado → sale la comanda; board y plano limpios.

## Riesgos

- **Orden huérfana si el pago falla** (el grande): una `dine_in` sin mesa y sin cerrar no se ve en ninguna UI — quedaría plata fantasma. Mitigación: FR-007 (cancelar en el catch) + test explícito. Alternativa evaluada y descartada por ahora: una RPC transaccional tipo `registrar_pago_tx` que cree orden+pago juntos (más correcto, bastante más caro; si el catch resulta frágil en vivo, es el paso siguiente).
- **Doble submit** = doble venta cobrada. Aplica la lección del bug de cobro (spec 41 / #58): botón deshabilitado durante el `transition` **y** guard en el server. Está en el checklist de qa-brain.
- **Tocar `persistOrder`** es tocar el checkout público: es el camino más caliente del producto. Mitigación: el enum público (`CreateOrderInput`) **no cambia**; el tercer valor entra sólo por el tipo interno del staff, y los tests del checkout tienen que quedar verdes sin editarlos.
- **Analítica**: las ventas de mostrador se mezclan con las de salón bajo `dine_in`. Si más adelante hay que separarlas, el discriminador es `table_id IS NULL` — igual que el pedido flash, que ya tiene esa ambigüedad. No se resuelve acá.
- **Cajas sin configurar**: si el negocio no tiene ninguna caja, el panel no puede cobrar. Se avisa al abrir (US1 §4), no al confirmar.
