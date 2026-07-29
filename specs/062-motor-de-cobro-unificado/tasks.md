# Tasks: 062 — Motor de cobro unificado

Leyenda: `[ ]` pendiente · `[x]` hecho. **Sin migración.** Cada bloque de migración (T005–T008) es un commit que deja el árbol verde y la app usable.

## Preparación
- [x] **T001** Mover `calculateAdjustment` a `src/lib/billing/adjustment.ts` + test (redondeo, porcentaje negativo, base 0). Las dos copias locales (`cobrar-client.tsx`, `cobrar-desktop-client.tsx`) pasan a importarla. Nada más cambia (FR-007).
- [x] **T002** Diffear el comportamiento real de los dos clientes grandes. **Resultado:** `METHODS` y helpers idénticos; **4 divergencias reales** documentadas en `spec.md` §Hallazgos — contrato de `onPaid` (perf percibida del mozo), origen de la propina, facturación presente en 3 de 4 (falta justo en el del encargado) y etiqueta del split implícito. Las dos primeras cambiaron el contrato en `plan.md`.

## El componente
- [x] **T003** `src/components/billing/cobro-form.tsx` con el contrato de `plan.md` (FR-001, FR-002, FR-003). Sin `Dialog`/`Sheet`/`PageShell`: sólo el cuerpo. **No importa server actions.**
- [x] **T004** Reglas adentro, una sola vez (FR-004): ajuste por método · `isCashShortPayment` · vuelto sólo en efectivo e informativo · últimos 4 (4 dígitos o vacío) · nota obligatoria en `transfer`/`other` · botón bloqueado en vuelo · `requestId` estable entre taps y regenerado tras un OK.
- [x] **T005** Tests de comportamiento del componente, sin tocar callers: recargo aplicado al `amountCents` · efectivo de menos rechazado · de más = vuelto, no se registra · doble tap = un solo `requestId` · `allowedMethods` filtra los chips · `allowTip: false` oculta la propina · `size="touch"` vs `"compact"` no cambia la lógica (SC-001, SC-002).
- [x] **T006** MP como capacidad opcional (FR-006): preference, sub-vista de link/QR, polling cada 4s. Sin `mp`, no se ofrece.

## Migración de los cuatro callers
- [x] **T007** **Pedido del board**: `CobrarPedidoSheet` monta `CobroForm` + `ComprobanteFields` (bloque Factura A/B extraído antes de borrar, FR-008). Test de integración: un pedido cobrado con tarjeta con recargo registra el **mismo** `amount_cents` que la misma cuenta en una mesa (SC-005).
- [ ] **T008** **Cobro del encargado**: página `/admin/mesa/[id]/cobrar` + panel embebido del salón. Sin cambios de layout ni de props externas; los tests de cobro existentes quedan verdes **sin editarlos** (FR-009).
- [ ] **T009** **Venta de mostrador**: el bloque de pago del panel pasa al form; el picker de productos no se toca. `onSubmit` llama a `venderMostrador`, no a `registrarPago` (FR-011, US3).
- [ ] **T010** **Cobro del mozo**: `CobroForm` con `size="touch"` dentro del `CobrarSplitDialog` actual. Mismo flujo, mismos taps, mismos tamaños (FR-010, SC-004).
- [ ] **T011** Textos desde el `subject` (FR-013): nada de "mesa" cuando se cobra un delivery — hoy dice *"Cobrar mesa"* y *"La mesa se va a marcar para limpiar"* sin importar qué se cobre.

## Cierre
- [ ] **T012** Borrar `cobrar-pedido-sheet.tsx` y todo formulario de cobro que haya quedado sin uso. **Confirmar que no queda ninguno paralelo** (FR-012) — un quinto formulario vivo deja el problema peor que antes.
- [ ] **T013** `pnpm typecheck` + `pnpm test` + `pnpm build` verdes.
- [ ] **T014** Verify en vivo con **roles reales**, los cuatro: mozo cobrando una mesa en el celular (mixto + MP + dividir) · encargado desde el panel del salón · pedido del board con tarjeta con recargo · venta de mostrador en efectivo (que ahora no deje cobrar de menos).
- [ ] **T015** Actualizar [`wiki/features/cobros.md`](../../../wiki/features/cobros.md) (sección UI: pasa de cuatro clientes a uno + callers) y `wiki/log.md`.
