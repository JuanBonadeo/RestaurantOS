# Tasks — 072 · Menú del día por pasos

Issue [#108](https://github.com/gachetponzellini/RestaurantOS-app/issues/108).

## Lógica pura (TDD)

- [x] T1 · `src/lib/mozo/daily-menu-steps.ts` — `buildMenuSteps(menu)` (un paso por `choice_group` + paso `confirm`), `optionIndexFromKey(key, length)` (`1`–`9` → índice), `initialOptionIndex(group, selections)` (la ya elegida, si no la primera), `choicesDeltaCents(selections)`. Test primero (`daily-menu-steps.test.ts`). Movimiento con flechas: reusa `moveSelection` de `product-search.ts`.

## Asistente (FR-001 … FR-006)

- [x] T2 · `src/components/mozo/daily-menu-wizard.tsx` — panel de pasos: header con progreso, lista de opciones de una columna con foco real y roving tabindex, paso final con resumen + cantidad + Agregar. Esc cierra (`useEscapeToClose`), focus-trap con Tab como en `ProductModal`.
- [x] T3 · `pedir-client.tsx` — borra `DailyMenuModal` y usa `DailyMenuWizard` con el mismo contrato (`menu`, `onClose`, `onAdd`, `embedded`); el ítem del carrito no cambia.

## Cierre

- [x] T4 · `pnpm typecheck` + `pnpm test`.
- [ ] T5 · Verificar en vivo con el rol real (encargado) en `/admin/operacion → Mesas` y con el dedo en `/mozo`. (Verificado el componente en el navegador con una página de preview temporal —recorrido completo con teclado, sin errores de consola—; falta el paso con sesión real.)
- [x] T6 · Actualizar `wiki/features/menu-del-dia.md` + `wiki/features/mozo.md` + `wiki/log.md`, comentar y cerrar #108.
