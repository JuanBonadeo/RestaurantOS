# Tasks — 070 · Corregir las líneas de la caja + libro de movimientos

Orden pensado para que **US1 (el libro) salga primero y sola** — es la puerta de entrada y ya tiene valor sin ninguna corrección. Después las tres correcciones (US2–US4) comparten action y modal, así que van juntas. US5 (sangrías) y US6 (mail) se pueden cortar a otro bloque sin dejar nada roto.

## Datos y permisos

- [x] **T001** Migración `00NN_caja_correcciones.sql`: tabla `caja_audit_log` (`entity_type`, `entity_id`, `business_id`, `caja_id`, `field`, `from_value`, `to_value`, `by_user_id`, `reason`, `created_at`) + índices `(entity_type, entity_id)` y `(business_id, created_at desc)` + RLS (lectura scopeada por negocio para admin/encargado, escritura sólo service role) + `comment on table`. **Aplicar al cloud** (`tjfufswzsxfujcpoxapx`) por MCP y verificar contra `information_schema`. ⚠️ Numerar según la última aplicada: la spec 069 reclama la `0030`. (FR-017, FR-019)
- [x] **T002** En la misma migración: RPC `corregir_pago_tx(...)` — `FOR UPDATE` sobre el pago y su orden, aplica el patch, recalcula `order_splits.paid_amount_cents` y `orders.total_paid_cents` desde los pagos `paid`, inserta un renglón de auditoría **por campo cambiado**, y devuelve `{payment, order_fully_paid, order_was_closed}` para que el caller decida el cierre en TS (mismo reparto que `registrar_pago_tx`). `revoke ... from public, anon, authenticated` + `grant execute to service_role`. (FR-018)
- [x] **T003** `src/lib/supabase/database.types.ts` con `caja_audit_log`, las columnas nuevas de `caja_movimientos` y las dos RPC. **Hecho a mano, no por MCP**: el archivo ya venía desactualizado (`cajas.is_default` de la 0025 falta) y todas las lecturas de caja pasan por el cast `AnyClient`, así que regenerarlo entero era más ruido que señal. Queda pendiente una regeneración completa cuando se limpie esa deuda.
- [x] **T004** Test rojo en `can.test.ts` para `canCorregirCobro` (admin ✅, encargado ✅, mozo ❌, personal ❌) → implementar en `can.ts`. (FR-001)

## US1 · El libro de movimientos (P1)

- [ ] **T005** ⚠️ **NO HECHO** — Tests de `getLibroDeMovimientos`: scope por `business_id`, rango con **timezone AR explícita**, incluye `refunded` y movimientos anulados, filtros (caja / tipo / método / mozo), orden cronológico, totales que **excluyen** lo anulado. (FR-020, FR-021) · *Requiere stack Supabase local (no hay Docker en esta máquina). La lógica que sí es pura —el efectivo esperado ignorando anulados— quedó testeada en `expected-cash.test.ts`.*
- [x] **T006** `getLibroDeMovimientos` + `getCorreccionesDeLinea` en `src/lib/caja/queries.ts`, reusando el shape `CajaPayment` / `CajaMovimiento` ya existente para no duplicar el mapeo del board.
- [x] **T007** Página `(authed)/operacion/movimientos/page.tsx` + client: gate `canSee("operacion") === "full"` (admin/encargado; mozo tiene `limited` → redirect), rango default hoy, filtros persistidos como en spec 065, vacío explícito. (FR-020, FR-023, US1-5/6)
- [x] **T008** Detalle de línea: historial de correcciones, marca de anulado con motivo y responsable, y el **por qué no se puede corregir** cuando corresponde. (FR-022, FR-023)
- [x] **T009** `caja-admin-board.tsx`: `CobroRow`/`MovimientoRow` clicables al detalle + enlace «Ver todos los movimientos». El panel del período **no cambia de forma**. (FR-024)

## US2–US4 · Corregir método, monto/propina y mozo (P1)

- [x] **T010** Tests del módulo puro `correcciones.ts`: qué campos cambiaron (diff), `amount > 0`, `tip <= amount`, veredicto de cobertura (queda cubierta / cerraría la orden / dejaría descubierta), método destino válido, nota obligatoria en `transfer`/`other`. (FR-008 a FR-012)
- [x] **T011** `correcciones.ts` — las funciones puras del T010, sin I/O.
- [x] **T012** Tests de las **guardas de contexto** (`evaluarGuardas`, puro) en vez de integración: gate de rol, scope de negocio, `payment_status` distinto de `paid` → error, pago anterior al último corte → error, cambio de caja con la otra caja arqueada → error, pago MP → error, conversión a MP → error, motivo vacío → error. (FR-002 a FR-007) · *Las guardas se extrajeron a una función pura que recibe los hechos ya resueltos (último corte, factura, rendiciones); la action sólo los busca. Se testean sin base — que acá no hay.*
- [x] **T013** Monto — mitad en tests puros (`correcciones.test.ts`: `estaCubierta`, `veredictoDeMonto`, invariantes) y mitad **probado contra la base real** en una transacción que se revierte (ver Notas): sobrepago corregido hacia abajo sobre orden cerrada (OK, sigue cerrada), corrección hacia arriba que cierra una orden abierta (llama `closeOrderIfFullyPaid`, transiciona la mesa), corrección que dejaría una orden cerrada descubierta → **error**, monto $0 → error, `tip > amount` → error, orden con factura emitida → error de monto pero OK de método/mozo, orden con splits. (FR-008 a FR-014)
- [x] **T014** Mozo — guardas en `correcciones.test.ts` (rendición cerrada de origen/destino con nombre, desatribuir, atribuir donde no había) + validación de negocio/rol dentro de la RPC: mozo de otro negocio → error, rol inválido → error, rendición cerrada del origen o del destino → error, `null` (desatribuir) → OK, atribuir donde no había → OK. (FR-015, FR-016)
- [x] **T015** `corregirCobro` en `src/lib/caja/correccion-actions.ts`: validación Zod en el borde, gate, todas las guardas, llamada a `corregir_pago_tx`, y `closeOrderIfFullyPaid` cuando el veredicto lo pide. Mapeo de errores de la RPC a mensajes en castellano (mismo patrón que `mapRegistrarPagoError`).
- [x] **T016** Auditoría completa, verificada contra la base real (una corrección de 2 campos → 2 renglones, `changed_fields = {method,amount_cents}`): una corrección de tres campos deja **tres** renglones con `from`/`to`/`by`/`reason`; corregir dos veces encadena. (FR-017, SC-003)
- [x] **T017** `corregir-cobro-modal.tsx`: campos método / monto / propina / mozo / caja + motivo obligatorio (confirmar deshabilitado si está vacío), aviso de recargo no recalculado (FR-014), aviso de a qué arqueo afecta, **loading explícito, no optimista** (FR-025).
- [x] **T018** Enganchar el modal en el detalle del libro y en la línea del board; refresh de stats tras confirmar (el poll de `/api/caja/stats` ya trae lo recalculado).

## US5 · Sangrías e ingresos (P2)

- [x] **T019** Columnas `cancelled_at` / `cancelled_reason` / `cancelled_by` en `caja_movimientos` + `calculateExpectedCash` ignora los anulados (test primero: un movimiento anulado no mueve el efectivo esperado). (FR-026)
- [x] **T020** `corregirMovimiento` / `anularMovimiento` con las mismas guardas (período abierto, gate, motivo, auditoría en `caja_audit_log` con `entity_type = 'movimiento'`) + tests.

## US6 · Que la corrección no se pierda (P2)

- [x] **T021** `shift-summary-loader.ts`: sección de correcciones del turno (qué, de qué a qué, quién, por qué) al lado de las anulaciones; la sección no se renderiza si está vacía. Test del loader.

## Cierre

- [x] **T022** `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes; `pnpm test` sin regresiones nuevas (los `*.integration.test.ts` fallan sin stack Supabase local — preexistente).
- [x] **T023** Wiki: [`features/caja.md`](../../../wiki/features/caja.md), [`features/cobros.md`](../../../wiki/features/cobros.md) y [`dominio/schema.md`](../../../wiki/dominio/schema.md) (`caja_audit_log` + columnas de anulación). Marcar la [spec 060](../060-cobro-pedido-unificado-y-editar-pago/) como reemplazada por ésta en su header y en el índice. Log en `wiki/log.md`.
- [ ] **T024** ⚠️ **PENDIENTE (Juan)** — Verify en vivo con **rol real** (encargado, nunca service_role) en golf-jcr: cobrar una mesa, corregirle el método, corregirle el monto hacia abajo, reatribuir el mozo, y confirmar contra el arqueo y la rendición por empleado que los números se movieron donde debían. Confirmar que el **mozo no ve** el libro ni el botón.
- [x] **T025** Comentado en la issue [#106](https://github.com/gachetponzellini/RestaurantOS-app/issues/106). **Queda abierta** hasta el verify en vivo del T024.

## Notas

- **Riesgo de solapamiento**: `caja-admin-board.tsx` es archivo grande y muy tocado. Chequear `git log` del submódulo antes de empezar (ver memoria *sesiones paralelas*).
- **Orden de entrega sugerido**: T001–T009 (libro solo, ya sirve para auditar a mano) → T010–T018 (las tres correcciones) → P2.
- El **monto** es la parte riesgosa: toca `orders`/`order_splits`. Todo lo que decide se prueba primero en `correcciones.ts` (puro) y recién después en la action.
- **Cómo se probó la RPC sin stack local**: un bloque `do $$ ... $$` contra la DB cloud que crea negocio/caja/orden/pago, corre los casos y termina con un `raise exception` que **revierte todo** (verificado después: 0 filas de prueba). Encontró un bug real que ni el typecheck ni los tests de TS podían ver — `v_changed := v_changed || 'method'` explotaba con *malformed array literal*, así que **toda** corrección fallaba. De ahí sale la migración `0032`.
- **Numeración final**: `0031_caja_correcciones.sql` (la 069 se llevó la `0030`) + `0032_caja_correcciones_fix_array.sql`. Las dos aplicadas al cloud y verificadas.
