# Implementation Plan: 060 — Cobro unificado del pedido sin mesa + corregir un pago

## Enfoque

Dos mitades independientes que se pueden mergear por separado.

**Mitad A — unificar el cobro.** No hay motor nuevo: `registrarPago(splitId: null)` y `closeOrderIfFullyPaid` ya trabajan sin mesa, y `CobrarDesktopClient` ya ignora `tableId` ([`:93`](../../src/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.tsx) — `void _tableId`). Lo único que ata el cobro a la mesa es **por dónde entran los datos**: `loadCobroForTable` arranca de un `tableId` y `getCuentaForTable` resuelve la orden abierta *de esa mesa*. Se invierte: la unidad es **la orden**; la mesa pasa a ser una forma de encontrarla.

**Mitad B — corregir el pago.** Un action nuevo y una tabla de auditoría. Deliberadamente **no toca montos**: sin tocar `amount_cents`/`tip_cents` no hay que recalcular `order_splits.paid_amount_cents`, ni `orders.total_paid_cents`, ni cierre/reapertura de la orden, ni la liquidación del mozo — el update no compite con la RPC de cobro y no necesita lock. Ese recorte es lo que hace que la mitad B sea chica y segura; editar montos (P2) sí requiere pasar por RPC.

La guarda que define "editable" es la que ya define el arqueo: `created_at > periodo_desde` de la caja ([`caja/queries.ts:250`](../../src/lib/caja/queries.ts)). Un pago que ya entró en un corte cerrado no se toca — corregirlo cambiaría un arqueo firmado.

## Capas

### Datos

**Una migración nueva** (`00NN_payments_audit_log.sql`, número al aplicar):

```sql
create table public.payments_audit_log (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  field text not null,          -- 'method' | 'last_four' | 'card_brand' | 'caja_id' | 'notes'
  from_value text,
  to_value text,
  by_user_id uuid references public.users(id),
  reason text not null,
  created_at timestamptz not null default now()
);
create index idx_payments_audit_log_payment on public.payments_audit_log(payment_id);
create index idx_payments_audit_log_business_created on public.payments_audit_log(business_id, created_at desc);
```

RLS igual que el resto de las tablas de auditoría: `select` scopeado por membresía del negocio, sin `insert`/`update`/`delete` para `anon`/`authenticated` (sólo service role escribe). Se aplica al cloud vía MCP (`apply_migration`) + `pnpm db:types`.

Función `corregir_pago_tx(...)` en la misma migración: hace el `update` de `payments` y los `insert` de auditoría **en una transacción**, y devuelve la fila actualizada. No necesita `FOR UPDATE` (no toca saldos), pero sí atomicidad — un update sin su renglón de auditoría es exactamente el agujero que la spec cierra (FR-012).

### Server (dominio)

- **`src/lib/billing/cuenta-query.ts`** — extraer `getCuentaForOrder(orderId, businessId)` con el cuerpo actual desde el paso 2 en adelante; `getCuentaForTable` queda como *resolver mesa (con la defensa cross-tenant vía `floor_plans`) → orden abierta → delegar*. Cero cambio de comportamiento para la mesa.
- **`src/lib/billing/cobro-panel-data.ts`** — extraer `loadCobroForOrder(slug, orderId)` con el grueso de `loadCobroForTable` (las dos olas de auth + ensamblado de `IniciarCobroResult`), parametrizando el "label" y la resolución de la cuenta. `loadCobroForTable` pasa a resolver el `tableId` → label + orden y delegar. Se conserva su optimización de una sola autenticación.
- **`src/lib/billing/corregir-pago.ts`** *(nuevo)* — `CorregirPagoInput` (Zod) + action `corregirPago`:
  1. `getBusiness` + `requireMozoActionContext` + `canCancelItem` (FR-008).
  2. Cargar el pago con scope `business_id` (FR-015). Rechazar si no es `paid` (FR-009), si es MP o tiene `mp_payment_id` (FR-010), o si el método destino es MP.
  3. Guarda de período: `getUltimoCorte` de la caja actual y —si cambia— de la destino; `payment.created_at` debe ser posterior a ambos `periodo_desde` (FR-011).
  4. Diff campo a campo; si no cambió nada, error explícito ("no hay cambios").
  5. `corregir_pago_tx` con el diff + `motivo` + `userId`.
  6. `revalidatePath` de operación/caja/pedidos.
- **`src/lib/billing/payments-query.ts`** *(nuevo o dentro de `cuenta-query`)* — `getPaymentsForOrder(orderId, businessId)` (los pagos de la orden con su estado, para listarlos en el panel) y `getPaymentAuditLog(paymentId, businessId)` (US3).

### Cliente

- **`cobrar-desktop-client.tsx`** — dejar de recibir `tableId`/`tableLabel` y pasar a `subject: { kind: 'mesa', label } | { kind: 'pedido', orderNumber }`. De ahí salen los textos (FR-004): título *"Cobrar mesa 12"* vs *"Cobrar pedido #48"*, y el aviso *"La mesa se va a marcar para limpiar"* sólo en `mesa`. Es un cambio de props chico y mecánico; los dos call sites actuales (página `/admin/mesa/[id]/cobrar` y panel del salón) se actualizan en el mismo commit (FR-005).
- **`order-detail-sheet.tsx`** — el botón «Cobrar / Facturar» abre un sheet que monta `CobrarDesktopClient` en modo `embedded` con los datos de `loadCobroForOrder`, en vez de `CobrarPedidoSheet`. El **bloque de comprobante** (Factura A/B + CUIT + condición IVA, FR-003) se extrae de `cobrar-pedido-sheet.tsx` a `components/billing/comprobante-fields.tsx` y se monta debajo del cobro; `emitInvoice` se dispara tras el cierre de la orden, best-effort como hoy.
- **`components/billing/editar-pago-dialog.tsx`** *(nuevo)* — dialog compartido: método (chips, sólo manuales), últimos 4 + marca si el destino es tarjeta, caja (si hay más de una), notas, **motivo obligatorio**. Aviso cuando el método destino tiene otro `adjustment_percent` (FR-014) y línea fija *"El monto no se modifica. Si cambió el monto, anulá el cobro y registralo de nuevo."* (FR-017).
- **Entradas (FR-016):** (a) lista de pagos registrados de la orden en el panel de cobro, cada uno con «Corregir»; (b) en el board de caja ([`caja-admin-board.tsx`](../../src/components/admin/local/caja-admin-board.tsx)), que ya trae los `payments` del período para la rendición, un «Corregir» por cobro. La (b) es la que cumple SC-003 (3 taps) — es donde el encargado descubre el error, cuadrando la caja.
- **`cobrar-pedido-sheet.tsx`** — se borra (FR-006).

## Orden (TDD)

**Mitad B primero**: es la que tiene motor nuevo y guardas de dinero, y no depende del refactor de la A.

1. Migración `payments_audit_log` + `corregir_pago_tx` + RLS + `pnpm db:types`.
2. `corregirPago` + tests unitarios de las guardas, con el rol real: encargado ok · **mozo rechazado** · pago de otro negocio rechazado · `pending`/`refunded` rechazados · MP rechazado (ambas direcciones) · pago anterior al último corte rechazado · sin motivo rechazado · sin cambios rechazado.
3. Test de integración del arqueo: pago `cash` → `card_manual` ⇒ `expected_cash_cents` baja el monto, `ventas_por_metodo` lo mueve, `total_ventas_cents` **no cambia**, y hay renglón en `payments_audit_log`.
4. Test de cambio de caja: el monto sale del arqueo A y entra al B; si B tiene corte posterior al pago, se rechaza.
5. `EditarPagoDialog` + entradas en panel de cobro y board de caja.
6. `getCuentaForOrder` / `loadCobroForOrder` extraídos + test de que los tests de mesa siguen verdes **sin editarlos**.
7. `subject` en `CobrarDesktopClient` + los dos call sites.
8. Sheet de cobro del pedido con `CobrarDesktopClient` + `ComprobanteFields`; borrar `CobrarPedidoSheet`.
9. Test de integración del cobro sin mesa: tarjeta con +10% ⇒ `amount_cents` con recargo (SC-001) · mixto en 2 métodos cierra recién con el segundo (SC-002) · ninguna mesa cambia de estado.
10. `pnpm typecheck` + `pnpm test` + `pnpm build`.
11. Verify en vivo con **rol encargado real** (nunca service_role): cobrar un pedido con tarjeta y ver el recargo; dividirlo en dos métodos; corregir un efectivo a tarjeta desde el board de caja y ver el efectivo esperado bajar; confirmar que un pago de un corte cerrado no ofrece corregir.

## Riesgos

- **Refactor de `getCuentaForTable` / `loadCobroForTable`.** Es el camino caliente del cobro de mesa y del panel del salón. Mitigación: extracción pura (mover el cuerpo, no reescribirlo), la defensa cross-tenant vía `floor_plans` se queda del lado de la mesa, y los tests de mesa **no se editan** — si pasan, no hubo regresión.
- **Textos de "mesa" en un cobro sin mesa.** Si `subject` se implementa a medias queda un *"La mesa se va a marcar para limpiar"* en un delivery. Chequeo explícito en el verify.
- **Corregir la caja de un pago mueve plata entre arqueos.** Con la guarda de período en ambas cajas no puede alterar un corte cerrado, pero sí cambia dos arqueos abiertos a la vez. Va con su propio test.
- **Expectativa de "editar el pago".** Esta spec corrige *cómo* entró la plata, no *cuánto*. Si el uso real es que también cambian el monto, aparece rápido en el piloto y activa el P2 — mejor descubrirlo con la auditoría ya puesta que sin ella.
