# Tasks — 073 · El catálogo sin buscar se ve y se navega igual que los resultados

Issue [#109](https://github.com/gachetponzellini/RestaurantOS-app/issues/109).

## Hook compartido (FR-002 · FR-003 · FR-004)

- [x] T1 · `product-search-box.tsx` — `useProductSearch` recibe `browse` (la categoría activa) y devuelve una sola `results` = lo visible; el filtro de la carta online aplica a los dos modos; `handleKeyDown` deja de exigir búsqueda activa; la selección se resetea cuando cambia la lista visible.
- [x] T2 · `product-search-box.test.tsx` — teclado sin búsqueda, reset al cambiar de categoría, filtro sin búsqueda, y que buscando se busque sobre el catálogo entero.

## Los tres flujos (FR-001)

- [x] T3 · `venta-rapida-panel.tsx` — `browseProducts` antes del hook; se va la grilla de 2 columnas.
- [x] T4 · `cargar-pedido-sheet.tsx` — ídem.
- [x] T5 · `pedir-client.tsx` — `tabSections` deja de depender de `isSearching` y se calcula antes del hook; `browse` = secciones aplanadas; `TabView` pinta cada sección con `ProductResultsList` y recibe `selectedProductId`; muere `ProductGrid`.

## Cierre

- [x] T6 · `pnpm typecheck` + `pnpm test`.
- [ ] T7 · Verificar en vivo con el rol real (encargado). (Verificado el buscador en el navegador con una página de preview temporal: lista sin buscar con el primero marcado, ↓↓ Enter agrega el tercero, cambio de categoría resetea la selección, «Solo para el local» filtra sin búsqueda. Falta el paso con sesión real y el criterio 5 —encabezados de categoría en la mesa—.)
- [x] T8 · Actualizar `wiki/features/mozo.md` + `wiki/log.md`, comentar y cerrar #109.
