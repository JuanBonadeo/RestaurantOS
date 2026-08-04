# Tasks — 076 · Reordenar y borrar los componentes del menú del día

Issue [#116](https://github.com/gachetponzellini/RestaurantOS-app/issues/116).

## Lógica pura (TDD)

- [x] T1 · `src/lib/daily-menus/component-order.ts` — `toCards` / `flattenCards` / `normalize` (opciones contiguas, FR-005), `moveCard`, `moveOption`, `removeGroup`, `addOption` (inserta en su grupo) y `pruneBlocks` (descarta reglas hacia atrás y reporta cuáles, FR-004). Test primero (`component-order.test.ts`, 21 casos).

## Editor (FR-001 · FR-002 · FR-003 · FR-006 · FR-007)

- [x] T2 · `daily-menu-form.tsx` — render por tarjeta en vez de por índice plano; `CardMoveButtons` (▲/▼ con `aria-label` que dice qué mueve, deshabilitados en los extremos); borrar grupo con confirmación; `applyComponents` como único punto de escritura (prune + escritura + toast); foco a la nueva posición tras mover; `defaultValues` normalizados; se va el `GripVertical` decorativo.
- [x] T3 · `daily-menu-form.test.tsx` — 16 casos: orden de tarjetas, opciones que viajan con su grupo, extremos deshabilitados, foco (incluido el salto al botón contrario en el extremo), orden dentro del grupo, alta de opción pegada a su grupo, confirmación de borrado (cancelar y aceptar), y la regla que se descarta al mover en vez de quedar invisible.

## Cierre

- [x] T4 · `pnpm typecheck` + `pnpm test`.
- [x] T5 · Verificado en el navegador con una página de preview temporal: subir Guarnición sobre Principal descarta la regla con toast y deja los checks coherentes, foco correcto, borrar grupo pide confirmación («¿Borrar el grupo «Guarnición» y sus 2 opciones?»), cancelar no borra, sin errores de consola. **Pendiente el verify con sesión real de encargado.**
- [x] T6 · Actualizar `wiki/features/menu-del-dia.md` + `wiki/log.md`, comentar y cerrar #116.

## Fix del review adversarial (FR-008)

- [x] T7 · `applyComponents` escribe con `reset` en vez de `replace`: con `replace` los `Controller` no se re-sincronizaban y los valores quedaban pegados a la posición (los inputs de texto no se movían; el `+$` de una opción quedaba en la que le ocupó el lugar). Se saca `useFieldArray` del editor: todo —mover, agregar, borrar— pasa por el mismo punto.
- [x] T8 · Tests de los dos casos que faltaban: mover un componente suelto se ve en pantalla; el `+$` viaja con su opción al mover la opción y al mover el grupo.
- [x] T9 · Textos: el toast y el confirm ya no quedan con comillas vacías si el grupo no tiene nombre; el confirm dice «su única opción» en singular.
