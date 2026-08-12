# Feature Specification: Abrir una mesa en el sidebar deja de esperar el catálogo

**Feature Branch**: `114-abrir-mesa-en-el-salon`

**Created**: 2026-08-09

**Status**: 🟡 Implementada — typecheck / suite (1631 tests) / build en verde, review con 2 hallazgos corregidos. **Pendiente verificar en vivo con rol real**. Issue [#177](https://github.com/gachetponzellini/RestaurantOS-app/issues/177).

**Input**: Pedido de Juan — "hay que optimizar más todavía la parte de cargando catálogo cuando tocás una mesa; estuvimos modificando mucho el sidebar, habría que optimizarlo de vuelta".

## Contexto y problema

La [spec 105](../105-catalogo-del-mozo/spec.md) le hizo al **mozo** un cache de catálogo de dos niveles (`useCatalogBundle`: memoria de módulo + `localStorage`, TTL de 12 h, revalidación cada 5 min). El panel del salón —el que se abre al tocar una mesa— nunca lo adoptó: se quedó con su prefetch propio en `useState`, que es de dónde venía la idea original pero sin ninguna de las dos capas.

Tres cosas, todas medibles:

1. **Cada carga de `/admin/operacion` bajaba el catálogo entero** (~195 kB, medidos en la 105), aunque el encargado no abriera una sola mesa. Un F5 lo volvía a bajar: `useState(null)` no sobrevive a nada.
2. **Tocar una mesa costaba cuatro viajes en serie** a Virginia: el gate (`getBusiness` + `ensureAdminAccess`), el chequeo cross-tenant de la mesa, `getActiveOrderByTable`, y recién ahí las comandas + «Lo pedido». Los dos del medio no dependen entre sí.
3. **El cartel mentía.** Decía «Cargando catálogo…» con el catálogo ya en memoria; lo que se esperaba era el estado de esa mesa. Y era un renglón centrado, que no anticipa nada de lo que viene.

## Requirements *(mandatory)*

- **FR-001**: El panel del salón usa `useCatalogBundle`, el mismo cache que el mozo. Dentro de la ventana de revalidación no sale un byte.
- **FR-002**: El chequeo cross-tenant y la búsqueda de la orden abierta van en paralelo. El gate no se relaja: la mesa tiene que colgar de un `floor_plan` de este negocio, y `getActiveOrderByTable` ya filtra por `business_id` por su cuenta.
- **FR-003**: Mientras carga, el panel muestra un skeleton que calca el buscador, los chips y la grilla — lo que el que carga está por usar. Con `role="status"` y nombre: acá el panel entero es el skeleton, así que no puede ser `aria-hidden` como los demás.
- **FR-004**: Sin nada cacheado y con la carga fallada, el panel lo dice y ofrece **reintentar**. Sacar el fetch del camino de apertura se llevó el `toast` + cierre que cubría ese caso; sin reemplazo, el panel se quedaba en el skeleton para siempre.
- **FR-005**: `useCatalogBundle` expone `recargar()`. El effect corre una vez por montaje, y con el keep-alive de la spec 101 el panel del salón se monta **una vez por carga de página**: sin reintento, un solo fallo de red dejaba al encargado sin poder cargar pedidos el resto del turno. La pantalla del mozo, que ya tenía un «Reintentar», pasa de `window.location.reload()` a este reintento acotado.

## Implementación

| Archivo | Qué |
|---|---|
| `salon-desktop.tsx` | `useCatalogBundle`; se van el prefetch propio, el `setCatalogBundle` de la apertura y el estado `pedirLoading` |
| `src/lib/mozo/pedir-panel-data.ts` | los dos viajes independientes de `loadTableComandas`, en paralelo |
| `src/components/skeletons/mesa-route-skeleton.tsx` | `PedirPanelSkeleton` |
| `salon-desktop.plano-tap.test.tsx` | usaba el texto «Cargando catálogo…» como marca de "panel abierto"; ahora consulta el `role="status"` |

## Review

Tres lentes (seguridad del cross-tenant / cache / estados), 22 agentes. **Dos confirmados**, los dos de este cambio:

1. **Se perdió el reintento del catálogo.** El camino viejo re-pedía el catálogo en cada apertura de mesa, así que un fallo de red se curaba solo en el siguiente tap. `useCatalogBundle` pide una vez por montaje — y con el keep-alive de la spec 101 eso es una vez por carga de página. El verificador lo reprodujo: tras el fallo, tocar dos mesas distintas dejaba `loadPedirCatalog` en **una** sola llamada, con «Cerrar» como único botón. Justo el escenario que motivó toda la tanda (el wifi del club), en la pantalla que está abierta todo el turno.
2. `catalogBundleRef` quedó sin lectores al mover el catálogo al hook, arrastrando su import de tipo.

Rechazado lo que más me preocupaba: la paralelización del chequeo cross-tenant. `gateAdmin` sigue awaiteado antes, `getActiveOrderByTable` filtra por `business_id` por su cuenta, y `activeOrder` no se lee antes del guard de tenancy.

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅ · suite ✅ **1630 tests**.
- ⏳ **En vivo**: abrir `/admin/operacion` dos veces y ver en Network que la segunda no pide el catálogo; tocar una mesa y ver el skeleton al instante.
