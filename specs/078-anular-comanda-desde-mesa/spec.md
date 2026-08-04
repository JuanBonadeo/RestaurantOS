# Feature Specification: Anular la comanda desde el panel de la mesa

**Feature Branch**: `078-anular-comanda-desde-mesa`

**Created**: 2026-08-04

**Status**: ✅ Implementada (2026-08-04). `pnpm typecheck` limpio, `pnpm test` en verde (1255 unit; los `*.integration.test.ts` fallan por el stack local apagado, ruido conocido), lint limpio en los archivos de la spec. Sin migración. **Pendiente:** verify en vivo con el rol real (encargado) — el panel está detrás del login. Issue [#119](https://github.com/gachetponzellini/RestaurantOS-app/issues/119). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-08-04 — *"tendrías que poder anular una comanda desde la vista de las mesas, cuando tocás las mesas y te aparecen las comandas, sería el mismo proceso que desde comandas, es para que tenga un atajo desde ahí"*.

## Contexto y problema

Anular una comanda entera existe desde la [spec 049](../049-comandas-encargado-anular-editar/): motivo obligatorio, se cancelan todos sus ítems, sale un ticket **ANULADA** por la comandera del sector y se avisa al mozo. Pero vive en **un solo lugar**: el menú `⋯` de la card del tab **Comandas** ([`comandas-kanban.tsx`](../../src/components/admin/local/comandas-kanban.tsx)).

El encargado en hora pico no vive ahí: vive en **Mesas**. Toca la mesa, se abre el panel y el bloque «Comandas» de [`order-summary-card.tsx`](../../src/components/mozo/order-summary-card.tsx) ya le muestra las comandas del pedido con su sector, su tanda, sus ítems y su demora. Es exactamente donde se entera de que hay que anular una — y es el único lugar del que tiene que **salir** para hacerlo: cambiar de tab, encontrar la card entre las de todos los sectores de todas las mesas, y recién ahí anular. El dato ya está en pantalla; falta la acción.

Hay además una arista que ya existe hoy, y que se vuelve incoherente en cuanto se puede anular desde acá: **el panel de mesa no sabe si una comanda está anulada**. Ninguna de las dos queries que lo alimentan trae `comandas.cancelled_at`, y los ítems se filtran por `cancelled_at is null`. Resultado: una comanda anulada se dibuja como **Activa**, sin ítems, y con el botón **Entregar** habilitado. En el kanban el problema no se ve porque la card anulada se cae sola de las columnas (se queda sin ítems vivos).

## Alcance

**Entra:** el bloque «Comandas» del panel de mesa, que es una card compartida — se ve en `/admin/operacion → Mesas` ([`salon-desktop.tsx`](../../src/components/admin/local/salon-desktop.tsx)) y en la app del mozo full-screen ([`mozo-client.tsx`](../../src/app/[business_slug]/mozo/mozo-client.tsx)).

**Fuera de alcance:**

- **Editar** la comanda y **reimprimir** desde el panel. El kanban sigue siendo el lugar de la gestión completa; acá va sólo el atajo del caso urgente.
- Anular **ítems sueltos** desde el panel de mesa.
- La lista de comandas del panel **Pedir** (`loadTableComandas`): es otra superficie, con otro propósito (ver qué ya se mandó mientras cargás).
- Server actions, permisos, migraciones, ruteo a cocina, impresión: **cero cambios**. Se reusa todo.

## Requisitos

### FR-001 — Anular desde la fila de la comanda

Cada comanda del panel de mesa ofrece **Anular** en un menú `⋯` al lado de la acción primaria (Entregar). Abre el **mismo modal** que el kanban: explica qué se cancela (sector · tanda), avisa que sale el ticket ANULADA y que se le avisa al mozo, y exige un **motivo** no vacío.

Confirmar llama a `cancelarComanda(slug, comandaId, motivo)` — la misma server action, sin variante. Al volver OK: toast *«Comanda anulada · se reimprime ANULADA en cocina»* y `router.refresh()`, igual que el resto de las acciones de la card.

### FR-002 — Un solo modal, no dos copias

`AnularComandaModal` sale de `comandas-kanban.tsx` y pasa a ser un componente compartido, parametrizado por lo que muestra (sector, tanda, origen). El kanban lo consume desde ahí. **No** se duplica el copy ni el manejo del pending: si mañana cambia el texto o la acción, cambia en un solo archivo.

### FR-003 — Sólo encargado y admin

La acción se muestra si `canCancelItem(role)` — o sea admin/encargado, el mismo gate que el kanban. El mozo no la ve. Como la card es compartida, un **encargado** que labura desde la app del mozo sí la tiene: el gate es el rol, no la pantalla.

El gate del cliente es **sólo UX**: `cancelarComanda` ya valida el rol en el server y ahí no se toca nada.

### FR-004 — Una comanda anulada se ve anulada

`cancelled_at` viaja desde la query hasta la card. Una comanda anulada:

- se pinta con el chip **Anulada** (no «Activa»),
- **no** ofrece Entregar ni Anular,
- no cuenta como activa en el contador del encabezado del bloque, ni impide que el bloque se oculte cuando la mesa pidió la cuenta y el resto ya se entregó.

Tampoco se ofrece Anular sobre una comanda **entregada**: es la misma regla del kanban (`status !== "entregado" && !cancelled_at`), y el server la rechaza igual.

### FR-005 — Una comanda anulada deja de contar como demora

`tableDelay` toma como pendiente **toda** comanda sin `delivered_at`. Una anulada no se entrega nunca, así que quedaba pintando la mesa con una demora que crece sola para siempre — y contra el tiempo por defecto, porque sus ítems ya están cancelados y llegan vacíos.

Es un bug que ya existía (se llega igual anulando desde el tab Comandas), pero **no se podía arreglar** hasta esta spec: `cancelled_at` no viajaba al cliente. Y con el atajo se vuelve obvio, porque el encargado anula y se queda mirando esa misma mesa. `tableDelay` saltea las anuladas.

### FR-006 — El resto del panel no cambia

Ítems, total, demoras, orden de las comandas por tanda y sector, `hideComandasIfAllDelivered`: igual que hoy. Los ítems de la comanda anulada ya aparecen tachados en el resumen del pedido, porque `cancelarComanda` los cancela y la card ya dibuja los cancelados con line-through.

## Criterios de aceptación

1. Encargado en Mesas → toca una mesa con comandas activas → `⋯` en la fila → **Anular comanda** → motivo → confirma → la fila queda **Anulada**, sus ítems tachados en el resumen y sale el ticket ANULADA en la comandera del sector.
2. El mismo encargado ve el resultado en el tab Comandas sin hacer nada más (la card se cae sola de las columnas, spec 049).
3. Un **mozo** en la misma mesa no ve la acción.
4. Una comanda **entregada** o ya **anulada** no ofrece la acción.
5. Motivo vacío → no se envía, avisa que falta el motivo.
