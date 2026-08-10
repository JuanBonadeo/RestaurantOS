# Feature Specification: El catálogo deja de viajar en cada apertura de mesa

**Feature Branch**: `105-catalogo-del-mozo`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1544 tests) / build en verde, review adversarial de 24 agentes sin hallazgos confirmados. **Pendiente verificar en vivo con rol real**. Issue [#163](https://github.com/gachetponzellini/RestaurantOS-app/issues/163).

**Input**: Iniciativa de perf percibida — [wiki/analyses/cache-operacion-conviene.md](../../../../wiki/analyses/cache-operacion-conviene.md), §4 ("dónde SÍ conviene cachear"). Primera de la tanda del mozo; las [101](../101-tabs-sin-red/spec.md)–[104](../104-impuesto-de-navegacion/spec.md) atacaron el panel.

## Contexto y problema

`/{slug}/mozo/mesa/[id]/pedir` mandaba el **bundle business-level entero** en el payload RSC de **cada apertura de mesa**: catálogo (414 productos + 301 modifiers con sus grupos anidados), sectores, menús del día y top de productos. Medido: **~195 kB de JSON**, desde Virginia al teléfono del mozo, con el wifi del club.

Y no cambia entre mesa y mesa: es data del negocio. El mozo abre treinta mesas en un turno y baja el mismo catálogo treinta veces.

El panel del salón ya lo había resuelto para su "Cargar pedido" embebido (`loadPedirCatalog` + cache en un ref): el catálogo se prefetchea una vez y al abrir una mesa sólo se piden sus comandas. Faltaba del lado del mozo — justo donde el dispositivo y la red son peores.

## Por qué es seguro para la plata

La pregunta que decide esta spec: **¿un catálogo viejo puede cobrar mal?** No.

`enviarComanda` resuelve el precio **en el server**, leyendo `products.price_cents` de la DB; el cliente sólo manda `product_id`, `quantity` y `modifier_ids`. Además valida `is_active` / `is_available` y rechaza con un mensaje explícito (`"X" no está disponible`). O sea: un catálogo desactualizado puede **mostrar** un precio viejo o un producto que ya se apagó, pero la venta no pasa con datos del cliente.

Esto se auditó de punta a punta en el review —producto simple, con modifiers, menú del día, combos y el override de precio del encargado— y no apareció ningún camino donde un importe del cliente se persista sin recalcularse.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Abrir la segunda mesa del turno no descarga el catálogo (Priority: P1)

**Independent Test**: DevTools → Network. La primera apertura pide el bundle; las siguientes, dentro de la ventana de revalidación, **no piden nada**.

**Acceptance Scenarios**:

1. **Dado** el catálogo ya cacheado, **Cuando** abro una mesa, **Entonces** la pantalla pinta al instante y no sale ni un byte.
2. **Dado** que pasaron más de 5 minutos, **Cuando** abro una mesa, **Entonces** pinta igual al instante con lo cacheado y revalida **en background**.
3. **Dado** un reload de la tablet, **Cuando** vuelvo a entrar, **Entonces** el catálogo sigue estando (sobrevive en `localStorage`).

### User Story 2 - Un catálogo viejo no rompe nada (Priority: P1)

**Acceptance Scenarios**:

1. **Dado** un producto apagado desde el admin, **Cuando** el mozo lo tiene en pantalla y lo envía, **Entonces** el server lo rechaza con un mensaje claro.
2. **Dado** que el server falla al revalidar, **Cuando** hay cache, **Entonces** el mozo no ve ningún error: es un refresh de fondo.
3. **Dado** que falla y **no** hay cache, **Entonces** sí se ve el error, con opción de reintentar.

### Edge Cases

- **Storage lleno o incógnito**: queda el cache de memoria; la sesión funciona igual.
- **JSON corrupto o de una versión vieja del bundle**: se descarta y se pide de nuevo.
- **Guardado hace más de 12 h**: no se usa, se pide fresco (`TTL_MS`).
- **Dos negocios en el mismo dispositivo** (House y Golf comparten socios): la clave del cache lleva el slug.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `loadPedirCatalog` gatea por **membresía** (`requireMozoActionContext`), no admin-only. El bundle es el menú del negocio: lo mismo que ve cualquiera en la carta pública, más sectores y top, que el mozo necesita para cargar el pedido.
- **FR-002**: Cache de cliente en dos niveles — `Map` a nivel módulo (sobrevive a las navegaciones SPA, que es el caso normal) y `localStorage` (sobrevive a un reload).
- **FR-003**: **Stale-while-revalidate con ventana**: se pinta con lo cacheado siempre; se revalida sólo si tiene más de 5 minutos. Sin la ventana, los bytes seguían bajando en cada apertura —fuera del camino crítico, pero bajando—, y el objetivo de la spec no se cumplía.
- **FR-004**: Las dos rutas de "pedir" (mozo y admin) dejan de mandar el bundle. Del server sólo baja lo de la mesa: su orden abierta y sus comandas.
- **FR-005**: Mientras no hay bundle se muestra el skeleton que ya usa el `loading.tsx` de esa ruta, así la transición es la que el mozo ya conoce.

## Implementación

| Archivo | Qué |
|---|---|
| `src/lib/mozo/pedir-panel-data.ts` | gate de membresía para el catálogo |
| `src/lib/mozo/use-catalog-bundle.ts` (nuevo) | el cache y su política |
| `src/lib/mozo/use-catalog-bundle.test.ts` (nuevo) | 7 tests: cache reciente no pide nada, cache viejo revalida, TTL, fallo con y sin cache, storage roto |
| `mozo/mesa/[id]/pedir/pedir-screen.tsx` (nuevo) | wrapper que resuelve el bundle, para no meterle estados de carga al cliente de 2200 líneas |
| las dos `pedir/page.tsx` | dejan de mandar el bundle |

`salon-desktop` no se toca: el panel embebido del salón sigue con su propio prefetch.

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅
- Suite unitaria ✅ **1544 tests, 0 rojos**.
- Review adversarial: 24 agentes en 3 lentes (plata / cache / superficie), **cero hallazgos confirmados**. Salieron rechazados varios huecos reales del server (`available_days` sin validar, min/max de modifiers) por ser **preexistentes** y no agravados por el cambio — quedan anotados como deuda aparte.
- ⏳ **En vivo con rol real**: abrir dos mesas seguidas y ver que la segunda no pide el catálogo.
