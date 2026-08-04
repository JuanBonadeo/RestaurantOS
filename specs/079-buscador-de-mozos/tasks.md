# Tasks — 079 · Buscador de mozos al transferir una mesa

Issue [#121](https://github.com/gachetponzellini/RestaurantOS-app/issues/121). Ver [`spec.md`](spec.md).

Todo es cliente: una función pura + el input en el modal. Sin migración, sin server actions.

## Lógica pura

- [x] T1 · `src/lib/mozo/mozo-search.ts` **(nuevo)** — `filterMozos(mozos, query)` (normaliza acentos + minúsculas, todos los tokens tienen que aparecer en el nombre) y `shouldShowMozoSearch(count)` con el umbral de FR-002. Va en `lib/` y no adentro del componente para poder testearla sin DOM, como `product-search.ts`.
- [x] T2 · `src/lib/mozo/mozo-search.test.ts` **(nuevo)** — query vacía devuelve todo; case-insensitive; sin acentos; tokens en cualquier orden; sin match devuelve vacío; `full_name` null no rompe; el umbral.

## UI

- [x] T3 · `transfer-table-modal.tsx` — input con lupa + limpiar arriba de la lista (FR-001), visible solo si `shouldShowMozoSearch(candidates.length)` (FR-002), lista filtrada, mensaje de «ningún mozo coincide» (FR-004).
- [x] T4 · `transfer-table-modal.tsx` — `effectiveToMozoId` derivado: la selección cuenta solo si está en la lista visible; el submit y el `disabled` del CTA usan ese valor (FR-003).

## Tests

- [x] T5 · `src/components/mozo/transfer-table-modal.test.tsx` **(nuevo)** — con pocos candidatos no hay buscador; con muchos sí y filtra; elegir + filtrar afuera deshabilita el CTA y `transferTable` no se llama; borrar la búsqueda lo vuelve a habilitar; sin resultados sale el mensaje.

## Cierre

- [x] T6 · `pnpm typecheck` + `pnpm test` + `pnpm lint` en verde.
- [x] T7 · Commit `feat(salon): …` con `Closes #121`, tildar tasks, actualizar la feature page del brain y loggear.
- [ ] T8 · Verify en vivo con rol real (encargado) — transferir una mesa buscando al mozo por nombre.
