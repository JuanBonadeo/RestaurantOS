# Tasks — 069 · Precio por ítem editable con motivo

Orden pensado para que **US1 sea entregable sola** (T001–T012). US2 (T013–T016) y US3 (T017–T019) se pueden cortar a otro bloque sin dejar nada roto.

## Datos y permisos

- [ ] **T001** Migración `0030_precio_override_por_item.sql`: las 4 columnas en `order_items` (`price_original_cents`, `price_override_at`, `price_override_by`, `price_override_reason`) + índice parcial + `comment on column` en las 4 y en `unit_price_cents` (pasa a significar "precio efectivamente cobrado"). **Aplicar al cloud** (`tjfufswzsxfujcpoxapx`) por MCP y verificar contra `information_schema`. (FR-001, FR-002)
- [ ] **T002** Regenerar `src/lib/supabase/database.types.ts` **por MCP** (`generate_typescript_types`). ⚠️ NO usar `pnpm db:types` — está roto y trunca el archivo.
- [ ] **T003** Test rojo en `can.test.ts` para `canOverrideItemPrice` (admin ✅, encargado ✅, mozo ❌, personal ❌) → implementar en `can.ts`. (FR-003)

## US1 · Cambiar el precio al cargar (P1)

- [ ] **T004** Tests de `enviarComanda` con override: override a $0, override mayor al de lista, motivo vacío → error, override de un mozo → error, override negativo/no entero → Zod, override + adicionales (subtotal `(override + mods) * qty`), override sobre `daily_menu` → error. (FR-004..FR-007)
- [ ] **T005** `EnviarComandaItem` + schema Zod: `price_override_cents` / `price_override_reason`, con la regla cruzada (motivo obligatorio si hay precio; motivo suelto sin precio → error).
- [ ] **T006** `enviarComanda`: gate `canOverrideItemPrice`, insert con las 4 columnas, subtotal con la base overrideada, rechazo de combos. (FR-005..FR-007)
- [ ] **T007** Test que blinda que el **checkout público** con `price_override_cents` en el payload inserta la línea a **precio de lista**. (FR-009, SC-005)
- [ ] **T008** `persist-order`: aceptar el override únicamente por el camino de staff; el input público no lee el campo. (FR-009)
- [ ] **T009** `cargarPedidoStaff`: mismo gate + misma validación, propagado a `persist-order`. (FR-008)
- [ ] **T010** `stores/cart.ts`: `CartItem` suma `price_override_cents?` / `price_override_reason?` + tests del store (setear, limpiar, que sobreviva el persist).
- [ ] **T011** Modal de override (componente nuevo compartido): precio de lista de referencia, teclado numérico para el precio nuevo, motivo obligatorio con confirmar deshabilitado si está vacío, «Volver al precio de lista» si ya hay uno. (FR-016)
- [ ] **T012** Enganchar el modal en `pedir-client.tsx` y `cargar-pedido-sheet.tsx`, solo con `canOverrideItemPrice(role)`; línea con override = precio de lista tachado + precio nuevo destacado + motivo abajo. (FR-015, FR-017)

## US2 · Corregir el precio de un ítem ya enviado (P2)

- [ ] **T013** Tests de `editarItemComanda` con precio: primer override, **segundo** override (que `price_original_cents` NO se pise), revertir con `null`, cambio de producto que limpia el override, ítem cancelado → error, orden cerrada → error. (FR-010..FR-014)
- [ ] **T014** `editarItemComanda`: `priceOverrideCents` / `priceOverrideReason` en el patch, doble gate (`canModifyPostEnvio` + `canOverrideItemPrice`), la regla de "seteá `price_original_cents` solo si es null", el revert y el recálculo de totales.
- [ ] **T015** El modal de edición del spec 049 suma el control de precio, con **loading explícito, no optimista** (frontera de plata, spec 21). (FR-018)
- [ ] **T016** `cuenta-client.tsx`: marcar las líneas con precio modificado para quien cobra. (FR-019)

## US3 · Registro legible (P2)

- [ ] **T017** Tests de `getPriceOverrides`: scope por `business_id`, rango de fechas con timezone AR explícita, exclusión de órdenes canceladas, cálculo del delta.
- [ ] **T018** `getPriceOverrides` en `src/lib/admin/` + `PriceOverridesSection` en `/admin/reportes`: tabla ordenada por `abs(delta)` desc, totales resignado/recargado **separados** (no netean), y no renderiza nada si está vacía. (FR-020, FR-021)
- [ ] **T019** Chequear que `profit-query.ts` (ingeniería de menú) y top-products no rompan al ver márgenes reales en vez de precio de lista — es el comportamiento **correcto**, pero hay que confirmar que ninguna cuenta asume `unit_price_cents == products.price_cents`.

## Cierre

- [ ] **T020** `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes; `pnpm test` sin regresiones nuevas (los `*.integration.test.ts` fallan sin stack Supabase local — preexistente).
- [ ] **T021** Wiki: [`features/cuenta.md`](../../../wiki/features/cuenta.md), [`features/mozo.md`](../../../wiki/features/mozo.md), [`features/admin.md`](../../../wiki/features/admin.md) (reporte) y [`dominio/schema.md`](../../../wiki/dominio/schema.md) (las 4 columnas + el nuevo significado de `unit_price_cents`). Log en `wiki/log.md`.
- [ ] **T022** Verify en vivo con **rol real** (encargado, nunca service_role) en golf-jcr: cargar con override a $0 y a un precio mayor, cobrar la mesa, corregir un ítem ya enviado, y ver las filas en el reporte. Confirmar que el **mozo no ve el control**.
- [ ] **T023** Comentar + cerrar la issue; checklist de qa-brain (`tipos/web.md`) antes de dar por terminado.

## Notas

- **Riesgo de solapamiento**: T012 toca `cargar-pedido-sheet.tsx` y T015 toca el modal de edición del spec 049 — ambos archivos vienen siendo tocados por specs recientes (066/067/068). Chequear `git log` del submódulo antes de empezar (ver memoria *sesiones paralelas*).
- **`unit_price_cents` cambia de significado.** Es el cambio conceptual más grande de la spec: cualquier código que hoy asuma que la línea vale lo que dice el catálogo pasa a estar mal. T019 existe para cazar eso.
