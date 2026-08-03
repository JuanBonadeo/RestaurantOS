# Tasks: 060 — Cobro unificado del pedido sin mesa + corregir un pago

**Status**: ⛔ **SUPERSEDED (2026-08-03)** — no se implementa como está escrita. La **mitad A** (cobro unificado del pedido sin mesa) la absorbió la [spec 062](../062-motor-de-cobro-unificado/) (issue #96); la **mitad B** (corregir un pago) la resolvió la [spec 070](../070-caja-correccion-de-lineas-y-libro/) (issue #106), que la mejora: acá el monto quedaba afuera (P2) y no se contemplaba reatribuir el mozo. Las tasks de abajo quedan sin tildar a propósito: se implementó otra cosa, no ésta. Issue [#91](https://github.com/gachetponzellini/RestaurantOS-app/issues/91) cerrada como no planificada.

Leyenda: `[ ]` pendiente · `[x]` hecho. Dos mitades independientes: **B** (corregir pago) se puede mergear sin **A** (cobro unificado) y viceversa.

## B · Datos
- [ ] **T001** Migración `payments_audit_log` (`payment_id`, `business_id`, `order_id`, `field`, `from_value`, `to_value`, `by_user_id`, `reason`, `created_at`) + índices (`payment_id`; `business_id, created_at desc`) + RLS: `select` scopeado por membresía, sin `insert/update/delete` para `anon`/`authenticated` (FR-018).
- [ ] **T002** Función `corregir_pago_tx(...)` en la misma migración: `update` de `payments` + `insert` de un renglón de auditoría **por campo cambiado**, atómico, devolviendo la fila actualizada (FR-012).
- [ ] **T003** Aplicar al cloud vía MCP (`apply_migration`) + `pnpm db:types` + `get_advisors` sin nuevos hallazgos.

## B · Server
- [ ] **T004** `CorregirPagoInput` (Zod) en `src/lib/billing/corregir-pago.ts`: `paymentId`, `slug`, `motivo` (min 1), opcionales `method`, `last_four` (exactamente 4 dígitos si viene), `card_brand`, `caja_id`, `notes` (FR-007, FR-013).
- [ ] **T005** Action `corregirPago`: gate `requireMozoActionContext` + `canCancelItem` (FR-008); carga del pago con scope `business_id` (FR-015); rechazo si no está `paid` (FR-009); rechazo si el pago es MP / tiene `mp_payment_id` o si el destino es MP (FR-010); diff campo a campo con error si no cambió nada; `corregir_pago_tx`; `revalidatePath` de operación / caja / pedidos.
- [ ] **T006** Guarda de período (FR-011): `payment.created_at` posterior al `periodo_desde` de la caja actual **y** de la destino si cambia. Mensaje: *"Ese cobro ya entró en un arqueo cerrado. Anulá el cobro y volvé a registrarlo."*
- [ ] **T007** Tests de guardas: admin ok · encargado ok · **mozo rechazado** · personal rechazado · pago de otro negocio rechazado · `pending` rechazado · `refunded` rechazado · `mp_link` rechazado · destino MP rechazado · sin motivo rechazado · sin cambios rechazado.
- [ ] **T008** Test de integración del arqueo (SC-004): `cash` → `card_manual` ⇒ `expected_cash_cents` baja el monto, `ventas_por_metodo` lo mueve, `total_ventas_cents` **igual**, y queda el renglón en `payments_audit_log` con `from_value`/`to_value`/`by_user_id`.
- [ ] **T009** Test de cambio de caja (US2 esc. 9): el monto sale del arqueo A y entra al B; si la caja destino tiene un corte posterior al pago, se rechaza.
- [ ] **T010** `getPaymentsForOrder(orderId, businessId)` + `getPaymentAuditLog(paymentId, businessId)` para listar pagos y su historial.

## B · Cliente
- [ ] **T011** `components/billing/editar-pago-dialog.tsx`: chips de método (sólo `cash`/`card_manual`/`transfer`/`other`), últimos 4 + marca cuando el destino es tarjeta, selector de caja si hay más de una, notas, **motivo obligatorio**, botón deshabilitado mientras está en vuelo.
- [ ] **T012** Aviso de ajuste distinto (FR-014) + línea fija *"El monto no se modifica. Si cambió el monto, anulá el cobro y registralo de nuevo."* (FR-017).
- [ ] **T013** Entrada desde el **board de caja** (`caja-admin-board.tsx`): «Corregir» por cobro del período, usando los `payments` que ya trae la rendición. Es la que cumple SC-003 (≤ 3 taps).
- [ ] **T014** Entrada desde el **panel de cobro** de la orden: lista de pagos registrados con «Corregir» por fila.
- [ ] **T015** (US3, P2) Historial de correcciones en el detalle del pago: sólo si hubo correcciones, sin sección vacía.

## A · Server (refactor)
- [ ] **T016** Extraer `getCuentaForOrder(orderId, businessId)` en `cuenta-query.ts`; `getCuentaForTable` resuelve mesa (defensa cross-tenant vía `floor_plans`) → orden abierta → delega. Los tests de cuenta existentes quedan verdes **sin editarlos**.
- [ ] **T017** Extraer `loadCobroForOrder(slug, orderId)` en `cobro-panel-data.ts` con las dos olas de auth y el ensamblado de `IniciarCobroResult`; `loadCobroForTable` delega. Conservar la optimización de una sola autenticación.

## A · Cliente
- [ ] **T018** `CobrarDesktopClient`: reemplazar `tableId`/`tableLabel` por `subject: {kind:'mesa',label} | {kind:'pedido',orderNumber}`; título y el aviso *"La mesa se va a marcar para limpiar"* salen de ahí (FR-004). Actualizar los dos call sites (página `/admin/mesa/[id]/cobrar` + panel del salón) en el mismo commit (FR-005).
- [ ] **T019** Extraer el bloque de comprobante de `cobrar-pedido-sheet.tsx` a `components/billing/comprobante-fields.tsx` (Factura B por defecto, A con CUIT + razón social + condición IVA) (FR-003).
- [ ] **T020** `order-detail-sheet.tsx`: «Cobrar / Facturar» abre `CobrarDesktopClient` (`embedded`) sobre `loadCobroForOrder` + `ComprobanteFields`; `emitInvoice` best-effort tras el cierre de la orden, como hoy (FR-001).
- [ ] **T021** Borrar `cobrar-pedido-sheet.tsx` y sus imports (FR-006, SC-006).

## A · Integración
- [ ] **T022** Test de integración del cobro sin mesa: tarjeta con recargo configurado ⇒ `amount_cents` y `adjustment_*` iguales a los de la mesa (SC-001) · mixto en 2 métodos cierra recién con el segundo (SC-002) · **ninguna** mesa cambia de `operational_status`.
- [ ] **T023** Test de que anular un cobro sobre una orden sin mesa reabre la orden sin tocar mesas (US1 esc. 4).

## Cierre
- [ ] **T024** `pnpm typecheck` + `pnpm test` + `pnpm build` verdes.
- [ ] **T025** Verify en vivo con **rol encargado real** (nunca service_role): cobrar un pedido con tarjeta y ver el recargo · dividirlo en dos métodos · corregir un efectivo a tarjeta desde el board de caja y ver bajar el efectivo esperado · confirmar que un pago de un corte cerrado no ofrece «Corregir» · confirmar que ningún texto dice "mesa" en un pedido sin mesa.
- [ ] **T026** Checklist de qa-brain (`tipos/web.md`) + actualizar [`wiki/features/cobros.md`](../../../wiki/features/cobros.md) y [`wiki/features/caja.md`](../../../wiki/features/caja.md) + `wiki/log.md`.
