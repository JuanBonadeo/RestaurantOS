# Tasks — 069 · Precio por ítem editable con motivo

Orden pensado para que **US1 sea entregable sola** (T001–T012). US2 (T013–T016) y US3 (T017–T019) se pueden cortar a otro bloque sin dejar nada roto.

## Datos y permisos

- [x] **T001** Migración `0030_precio_override_por_item.sql`: las 4 columnas en `order_items` (`price_original_cents`, `price_override_at`, `price_override_by`, `price_override_reason`) + índice parcial + `comment on column` en las 4 y en `unit_price_cents` (pasa a significar "precio efectivamente cobrado"). **Aplicar al cloud** (`tjfufswzsxfujcpoxapx`) por MCP y verificar contra `information_schema`. (FR-001, FR-002)
- [x] **T002** Regenerar `src/lib/supabase/database.types.ts` **por MCP** (`generate_typescript_types`). ⚠️ NO usar `pnpm db:types` — está roto y trunca el archivo.
- [x] **T003** Test rojo en `can.test.ts` para `canOverrideItemPrice` (admin ✅, encargado ✅, mozo ❌, personal ❌) → implementar en `can.ts`. (FR-003)

## US1 · Cambiar el precio al cargar (P1)

- [x] **T004** Tests de `enviarComanda` con override: override a $0, override mayor al de lista, motivo vacío → error, override de un mozo → error, override negativo/no entero → Zod, override + adicionales (subtotal `(override + mods) * qty`), override sobre `daily_menu` → error. (FR-004..FR-007)
- [x] **T005** `EnviarComandaItem` + schema Zod: `price_override_cents` / `price_override_reason`, con la regla cruzada (motivo obligatorio si hay precio; motivo suelto sin precio → error).
- [x] **T006** `enviarComanda`: gate `canOverrideItemPrice`, insert con las 4 columnas, subtotal con la base overrideada, rechazo de combos. (FR-005..FR-007)
- [x] **T007** Test que blinda que el **checkout público** con `price_override_cents` en el payload inserta la línea a **precio de lista**. (FR-009, SC-005)
- [x] **T008** `persist-order`: aceptar el override únicamente por el camino de staff; el input público no lee el campo. (FR-009)
- [x] **T009** `cargarPedidoStaff`: mismo gate + misma validación, propagado a `persist-order`. (FR-008)
- [x] **T010** ~~`stores/cart.ts`~~ **No aplica.** El spec asumía que la carga de staff usaba el store zustand; no es así: `stores/cart.ts` es el carrito **público** (checkout del comensal, persistido en localStorage) y los dos carritos de staff (`pedir-client.tsx`, `cargar-pedido-sheet.tsx`) son `useState` local. Los campos se agregaron a esos dos tipos locales. Tocar el store público habría sido justo lo contrario de la spec.
- [x] **T011** Modal de override (componente nuevo compartido): precio de lista de referencia, teclado numérico para el precio nuevo, motivo obligatorio con confirmar deshabilitado si está vacío, «Volver al precio de lista» si ya hay uno. (FR-016)
- [x] **T012** Enganchar el modal en `pedir-client.tsx` y `cargar-pedido-sheet.tsx`, solo con `canOverrideItemPrice(role)`; línea con override = precio de lista tachado + precio nuevo destacado + motivo abajo. (FR-015, FR-017)

## US2 · Corregir el precio de un ítem ya enviado (P2)

- [x] **T013** Tests de `editarItemComanda` con precio: primer override, **segundo** override (que `price_original_cents` NO se pise), revertir con `null`, cambio de producto que limpia el override, ítem cancelado → error, orden cerrada → error. (FR-010..FR-014)
- [x] **T014** `editarItemComanda`: `priceOverrideCents` / `priceOverrideReason` en el patch, doble gate (`canModifyPostEnvio` + `canOverrideItemPrice`), la regla de "seteá `price_original_cents` solo si es null", el revert y el recálculo de totales.
- [x] **T015** El modal de edición del spec 049 suma el control de precio, con **loading explícito, no optimista** (frontera de plata, spec 21). (FR-018)
- [x] **T016** `cuenta-client.tsx`: marcar las líneas con precio modificado para quien cobra. (FR-019)

## US3 · Registro legible (P2)

- [x] **T017** Tests de `getPriceOverrides`: scope por `business_id`, rango de fechas con timezone AR explícita, exclusión de órdenes canceladas, cálculo del delta.
- [x] **T018** `getPriceOverrides` en `src/lib/admin/` + `PriceOverridesSection` en `/admin/reportes`: tabla ordenada por `abs(delta)` desc, totales resignado/recargado **separados** (no netean), y no renderiza nada si está vacía. (FR-020, FR-021)
- [x] **T019** Auditoría del cambio de significado de `unit_price_cents`. **Encontró un bug real, no sólo confirmó lo esperado:** `profit-query.ts` mezclaba ingreso real (de `order_items`) con margen de catálogo (de `getCosteoOverview` sobre `products.price_cents`) — un plato regalado tres veces mostraba «$0 facturado · 70% de margen» en la misma tarjeta y `classify()` lo mandaba al cuadrante **estrella**. Corregido con [`effective-margin.ts`](../../src/lib/admin/effective-margin.ts) (7 tests). Verificados correctos y sin cambios: `top-products.ts`, `reports-query.ts`, `dashboard-query.ts`, `customers-query.ts`, `getCosteoOverview` (su uso propio en `/admin/catalogo` SÍ quiere el precio de lista), el trigger de `ingredient_consumptions`, `staff-query.ts`, `cuenta-query.ts` y todo `src/lib/afip` (se factura lo que se cobra).

## Cierre

- [x] **T020** `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes; `pnpm test` sin regresiones nuevas (los `*.integration.test.ts` fallan sin stack Supabase local — preexistente).
- [x] **T021** Wiki: [`features/cuenta.md`](../../../wiki/features/cuenta.md), [`features/mozo.md`](../../../wiki/features/mozo.md), [`features/admin.md`](../../../wiki/features/admin.md) (reporte) y [`dominio/schema.md`](../../../wiki/dominio/schema.md) (las 4 columnas + el nuevo significado de `unit_price_cents`). Log en `wiki/log.md`.
- [ ] **T022** Verify en vivo con **rol real** (encargado, nunca service_role) en golf-jcr: cargar con override a $0 y a un precio mayor, cobrar la mesa, corregir un ítem ya enviado, y ver las filas en el reporte. Confirmar que el **mozo no ve el control**.
- [ ] **T023** Comentar + cerrar la issue; checklist de qa-brain (`tipos/web.md`) antes de dar por terminado.

## Verificación adversarial (2026-07-30)

22 hallazgos reportados por 4 lentes independientes (plata, permisos, estado/UI, cumplimiento de spec), cada uno verificado por un refutador. **20 refutados** (preexistentes, o preferencias de presentación, o escenarios que un guard previo ya cortaba). **4 confirmados y corregidos:**

1. **El reporte contaba plata de mesas anuladas.** `getPriceOverrides` excluía órdenes canceladas con `.neq("orders.status", "cancelled")`, pero anular o liberar una mesa escribe SÓLO `orders.lifecycle_status` — y no hay trigger que las sincronice. Para la población de este reporte (salón y mostrador) el filtro era un **no-op**: nunca excluía una fila. Una mesa anulada con un ítem a mitad de precio sumaba a «se dejó de cobrar» plata que nunca se cobró ni se resignó. Se filtra por las dos columnas + test que se pone rojo si se saca cualquiera.
2. **Cambiar el producto dejaba el modal mintiendo.** El picker sólo patcheaba `productId`/`productName`; `catalogPriceCents` y `overrideCents` seguían siendo los del producto viejo. La pantalla decía «Precio de la carta $10.000 → se cobra $6.000» y al guardar el server (correctamente, FR-013) limpiaba el override y cobraba el precio del producto nuevo. Ahora el picker espeja lo que hace el server.
3. **Corregir sólo el motivo se perdía en silencio.** `rowChanged` comparaba únicamente `overrideCents`, así que editar el texto del motivo sin mover el precio no marcaba la fila como cambiada y el patch nunca salía. El motivo es justamente el dato que audita el reporte.
4. **El reporte traía «cuándo» y no lo mostraba.** `price_override_at` se seleccionaba, se mapeaba a `at` y quedaba como campo muerto; FR-020 lo pide explícito. Se agregó la columna, formateada en la timezone del negocio.

## Notas de implementación (2026-07-30)

- **`useState` después de un early return**: la primera versión del enganche en `cargar-pedido-sheet.tsx` declaraba el estado del modal debajo de `if (!open) return null`. Lo cazó `react-hooks/rules-of-hooks` en el lint, no los tests. El estado quedó arriba del early return y el derivado (`priceTarget`) abajo.
- **`changeQuantity` revertía el precio pisado**: los dos carritos recalculaban el subtotal con `unit_price_cents` (catálogo), así que tocar la cantidad después de pisar el precio volvía al de lista en silencio. Se centralizó en `effectiveUnitPriceCents()` en ambos.
- **`cargar-pedido-sheet.tsx` no recibe `role`** y no hizo falta: llegar ahí ya exige `canCargarPedido` (admin/encargado), el mismo conjunto que `canOverrideItemPrice`. Documentado en el código para que no parezca un gate faltante.
- **`database.types.ts` está desactualizado en el repo** (le falta `show_customer_name` de la 067, `is_default`, `is_business_manager`, un FK de `reservations`). Se lo viene parcheando a mano. Se tocó **sólo** lo de esta spec para no arrastrar drift ajeno; regenerarlo entero es tarea aparte.
- **`price_original_cents` es `bigint`**, no `integer`: `unit_price_cents` ya era `bigint` y dos columnas del mismo dato no pueden tener techos distintos.

## Notas

- **Riesgo de solapamiento**: T012 toca `cargar-pedido-sheet.tsx` y T015 toca el modal de edición del spec 049 — ambos archivos vienen siendo tocados por specs recientes (066/067/068). Chequear `git log` del submódulo antes de empezar (ver memoria *sesiones paralelas*).
- **`unit_price_cents` cambia de significado.** Es el cambio conceptual más grande de la spec: cualquier código que hoy asuma que la línea vale lo que dice el catálogo pasa a estar mal. T019 existe para cazar eso.
