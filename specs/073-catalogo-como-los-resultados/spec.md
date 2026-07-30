# Feature Specification: El catálogo sin buscar se ve y se navega igual que los resultados

**Feature Branch**: `073-catalogo-como-los-resultados`

**Created**: 2026-07-30

**Status**: 🚧 En implementación. Issue [#109](https://github.com/gachetponzellini/RestaurantOS-app/issues/109). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"y que los productos de entrada sin buscar aparezcan como buscas"*, sobre los **tres flujos de carga**.

## Contexto y problema

La [spec 066](../066-teclado-operacion/) unificó los **resultados de búsqueda** de los tres buscadores en una lista de una columna navegable con ↓/↑/Enter ([`ProductResultsList`](../../src/components/mozo/product-results-list.tsx)), y dejó escrito que el **catálogo por categoría** —lo que se ve sin escribir nada— seguía siendo una grilla de dos columnas: *"ahí no hay índice de teclado, es superficie de toque"*.

Eso deja al usuario con **dos modos distintos en la misma pantalla**: si escribe, tiene teclado; si no escribe, tiene que ir al mouse. Y el estado por defecto —el que ve al abrir el panel, antes de tipear nada— es justamente el que no se puede manejar con el teclado. Para cargar lo primero de la mesa hay que tipear algo aunque el producto esté a la vista.

Hay un segundo síntoma del mismo corte: los chips del filtro de la carta online (spec 068) se muestran también sin búsqueda activa, pero ahí **no filtran nada** — el catálogo por categoría no pasa por el filtro. Un control visible que no hace nada.

## Requisitos

### FR-001 — Sin búsqueda, el catálogo es la misma lista que los resultados

En los tres flujos de carga —mesa ([`pedir-client`](../../src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx)), para llevar/delivery ([`cargar-pedido-sheet`](../../src/components/admin/cargar-pedido-sheet.tsx)) y venta rápida de mostrador ([`venta-rapida-panel`](../../src/components/admin/local/venta-rapida-panel.tsx))— los productos de la categoría/pestaña activa se muestran con `ProductResultsList`, exactamente igual que los resultados de búsqueda. Se va la grilla de dos columnas.

En la mesa, los **encabezados de categoría** dentro de la pestaña se conservan: cada sección es su header + su lista.

### FR-002 — El teclado funciona desde el momento cero

↓/↑ mueven la selección sobre la lista visible **haya o no texto en el buscador**, y Enter abre el producto seleccionado. El foco vive en el `<input>` del buscador, como hasta ahora; lo único que cambia es que el índice ya no está atado a que haya query.

Al cambiar de categoría o de pestaña, la selección vuelve al primer producto de la lista nueva.

### FR-003 — El filtro de la carta online también filtra sin búsqueda

Los chips «Todos / En la carta online / Solo para el local» aplican al catálogo por categoría igual que a los resultados. Hoy se muestran y no hacen nada cuando no hay búsqueda.

### FR-004 — Una sola fuente de la lista visible

`useProductSearch` pasa a recibir, además del catálogo completo para buscar, **la lista de la categoría activa**, y devuelve una sola `results` que ya es «lo que hay que mostrar» en cualquiera de los dos modos. Los tres callers dejan de calcular por su cuenta el `isSearching ? resultados : categoría`.

## Decisión revertida

**Spec 066 → «el catálogo por categoría conserva la grilla de 2 columnas».** Se revierte. El motivo original (no hay índice de teclado ahí) deja de valer justamente porque esta spec lo agrega. La fila compacta ya había demostrado que la densidad no se pierde, y `min-h` de la fila sigue siendo target de toque válido en el celular del mozo.

## Fuera de alcance

- Las tarjetas de **menú del día** (mesa, pestaña «Más pedidos»): no son productos del catálogo, siguen arriba de la lista como tarjetas y se abren con Tab + Enter o con el dedo. Meterlas en el índice implica volver la lista una unión de tipos.
- Navegar las **pestañas/categorías** con el teclado (hoy son un `<select>` y chips).

## Criterios de aceptación

1. Abrir cualquiera de los tres paneles sin escribir nada: los productos se ven como lista de una columna, con el primero marcado.
2. ↓ ↓ Enter sin haber tipeado nada abre el tercer producto de la lista.
3. Cambiar de categoría deja la selección en el primer producto de la categoría nueva.
4. Con el filtro «Solo para el local» puesto y sin búsqueda, la lista no muestra productos publicados en la carta online.
5. En la mesa se siguen viendo los encabezados de categoría dentro de la pestaña.
6. `pnpm typecheck` y `pnpm test` en verde.
