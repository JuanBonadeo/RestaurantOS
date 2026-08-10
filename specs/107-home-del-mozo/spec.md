# Feature Specification: El home del mozo deja de re-correr la ruta

**Feature Branch**: `107-home-del-mozo`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1545 tests) / build en verde, review adversarial con 4 hallazgos corregidos. **Pendiente verificar en vivo con rol real**. Issue [#165](https://github.com/gachetponzellini/RestaurantOS-app/issues/165).

**Input**: Iniciativa de perf percibida. Cierra la tanda del mozo, que arrancó con la [spec 105](../105-catalogo-del-mozo/spec.md) (el catálogo). Replica el patrón de las [102](../102-salon-sin-refresh/spec.md) y [103](../103-plata-sin-refresh/spec.md).

## Contexto y problema

`mozo-client.tsx` tenía **7 `router.refresh()`** —anular mesa, walk-in, transferir, trasladar, tomar una mesa, y dos de marcar notificaciones leídas— y su realtime de `tables` hacía lo mismo en **cada evento de cualquier compañero**.

Cada uno re-ejecutaba `mozo/page.tsx` entera: `ensureMozoAccess` + las **8 queries** del `Promise.all`, incluidas notificaciones, propinas del día y fichaje, que ninguna acción de mesa toca. Desde el teléfono del mozo, con el wifi del club.

Y el camino más caliente del turno —tocar una mesa y entrar a "Cargar pedido" o "Cuenta"— navegaba con `router.push`, que no calienta nada: el mozo tocaba y se quedaba mirando la pantalla anterior mientras bajaba el bundle. Mismo diagnóstico que la spec 101 arregló en las tabs del encargado.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Una acción de mesa cuesta lo que cuesta esa acción (Priority: P1)

**Acceptance Scenarios**:

1. **Dado** que anulo, transfiero, traslado o tomo una mesa, **Cuando** la action vuelve `ok`, **Entonces** se re-sincroniza el home con `getMozoHomeData` y **no** se re-ejecuta la page.
2. **Dado** un error del refetch, **Entonces** el plano mantiene lo que tenía — nunca se vacía.
3. **Dado** dos refetch en vuelo, **Entonces** sólo se aplica el más nuevo.

### User Story 2 - Tocar una mesa y entrar es instantáneo (Priority: P1)

**Acceptance Scenarios**:

1. **Dado** que elijo una mesa, **Cuando** toco "Cargar pedido" o "Cuenta", **Entonces** la pantalla abre sin esperar a que baje el bundle: las dos rutas se prefetchean al seleccionar la mesa.

### Edge Cases

- **Marcar notificaciones leídas**: ya no refresca la ruta. El estado se aplica optimista, el server persiste y el realtime de notificaciones reconcilia. Re-correr 8 queries por un puntito azul no tenía sentido.
- **Propinas del día y fichaje**: quedan fuera del refetch a propósito — ninguna acción de mesa las toca. Se refrescan al entrar al home (cobrar navega y vuelve).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `loadMozoHome` es el **único** lugar donde se define qué trae el home: lo usan la page y el refetch. El mapper de `activeOrders` (joins anidados de PostgREST → la forma del cliente) vive ahí; si la page mapeara y el refetch no, el home se rompería al re-sincronizar.
- **FR-002**: `getMozoHomeData` va en su propio archivo `"use server"` y el loader queda en un módulo `server-only`. En un archivo `"use server"` **toda** export es un endpoint invocable desde el cliente: el loader recibe un client de service-role y no tiene gate propio, así que no puede estar ahí.
- **FR-003**: Gate de membresía (`requireMozoActionContext`) antes de cualquier query: `loadMozoHome` corre con service-role y devuelve el plano, las reservas **con teléfono** y la nómina.
- **FR-004**: `serverData` con un solo escritor, guarda de secuencia y error tragado.
- **FR-005**: El realtime de `tables` re-sincroniza el home (`onChange`), no la ruta.
- **FR-006**: Los dos CTA del camino caliente (Cobrar / Cargar pedido) navegan con `<Link>`, cuyo prefetch por default es el **parcial**: corta en el `loading.tsx` de la ruta (spec 039) y deja el skeleton listo. **No** se usa `router.prefetch(href)` imperativo — ver el review.

## Implementación

| Archivo | Qué |
|---|---|
| `src/lib/mozo/home-data.ts` (nuevo) | `loadMozoHome` + el mapper, `server-only` |
| `src/lib/mozo/home-actions.ts` (nuevo) | `getMozoHomeData`, con el gate |
| `mozo/page.tsx` | usa el loader compartido; el mapper inline se fue |
| `mozo-client.tsx` | `serverData` + refetch; 7 `router.refresh()` → 5 refetch y 2 eliminados; prefetch de las rutas de la mesa |

## Review adversarial

28 agentes en 4 lentes. **Cuatro hallazgos** en esta spec, dos de ellos graves:

1. **El mismo bug de la spec 102, repetido.** Al mover el snapshot a `serverData`, `OrderSummaryCard` —que se renderiza dentro del drawer y sigue resolviendo con `router.refresh()`— quedó **mudo**: entregar una comanda pegaba en la DB y la fila seguía diciendo «Activa» con el botón puesto, y la mesa marcada demorada. No se curaba solo: `marcarComandaEntregada` no escribe `tables`, así que el realtime no dispara. La 102 dejó un test de regresión para esto y esta spec no lo tenía; ahora sí (`mozo-client.refetch.test.tsx`).
2. **`router.prefetch(href)` es el prefetch COMPLETO, no el parcial.** Con `clientSegmentCache` en false (el default), sin segundo argumento usa `PrefetchKind.FULL`: no manda el header de prefetch, así que el server **renderiza las dos pages enteras** —dos renders completos por cada tap de mesa, incluidas las libres— y, peor, cachea su data dinámica como `reusable` por **300 s**, ignorando `staleTimes.dynamic`. En `cuenta`, que es plata, eso es servir un total de hasta 5 minutos atrás. Se reemplazó por `<Link>`, cuyo default es el parcial.
3. Tres imports huérfanos en `mozo/page.tsx` y un `useRouter` sin usar en `local-shell.tsx`.
4. El skeleton de los donuts reservaba `h-64` (256 px) cuando en la grilla `lg:grid-cols-2` estiran a **377 px**: la fila entera saltaba 122 px al llegar los gráficos. Medido contra el render real.

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅ · suite unitaria ✅ **1544 tests**.
- ⏳ **En vivo con rol real**: transferir una mesa y ver **una** llamada a la action; con dos teléfonos, abrir una mesa en uno y ver el plano del otro actualizarse sin re-correr la página.
