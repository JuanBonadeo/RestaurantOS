# Feature Specification: Operación — el cambio de tab deja de pegar al servidor

**Feature Branch**: `101-tabs-sin-red`

**Created**: 2026-08-06

**Status**: 🟡 Implementada — typecheck / suite unitaria (1515 tests) / build en verde, **2 rondas de review adversarial** (9 hallazgos en la ronda 1 + 2 en los propios fixes, todos corregidos). **Pendiente verificar en vivo con rol real** (encargado de golf-jcr). Issue [#159](https://github.com/gachetponzellini/RestaurantOS-app/issues/159).

**Input**: Iniciativa de perf percibida — [wiki/analyses/perf-percibida-operacion-mozo.md](../../../../wiki/analyses/perf-percibida-operacion-mozo.md) y [cache-operacion-conviene.md](../../../../wiki/analyses/cache-operacion-conviene.md). **Fase 1 de 4.** Continúa [spec 039](../039-fundaciones-perf-percibida/spec.md) y [spec 052](../052-kds-refetch-comandas/spec.md).

## Contexto y problema

En `/admin/operacion` **cada click de tab dispara un round-trip completo al servidor** y la pantalla no cambia hasta que vuelve: el encargado toca la tab y no pasa nada durante ~400-800 ms.

La cadena, verificada en código:

1. `local-shell.tsx` conmutaba con `router.replace('?tab=…')` — una navegación soft de Next, no un cambio de estado.
2. `operacion/page.tsx` es `force-dynamic` y no hay `staleTimes` → el Router Cache no reusa nada: **volver a una tab ya visitada igual pega al servidor**.
3. En el server, antes de emitir JSX: `getBusiness` + `ensureAdminAccess` (`auth.getUser()` = hop de red a GoTrue + 2 queries) + `await getSalonOptions`.
4. Se crean las **7 promesas de tab** y **las 6 pills las consumen todas incondicionalmente**, así que el stream RSC no cierra hasta que resuelven **≈29-35 queries** — incluidos dos bucles N+1 seriales (`getCajasConEstado`, `getRendicionesPendientesTodosLosMozos`).
5. Como `router.replace` corre dentro de una transición, React **conserva la UI vieja** en vez de mostrar el skeleton: se siente colgado, no cargando.
6. Al llegar el payload, desmonta el panel viejo y monta el nuevo, con teardown y re-suscripción de los channels de realtime (`getSession()` + `setAuth()` cada vez).

**No es la SQL.** golf-jcr tiene 8 pedidos, 5 comandas y 55 mesas, y Supabase (`us-east-1`) y las funciones de Vercel (`iad1`) están colocados: cada query es sub-ms. Lo que se paga es el cable a Virginia (~110-140 ms por tramo desde AR) multiplicado por pedir todo, siempre.

Esta spec **no toca plata**: no mueve ninguna action, no cambia ninguna query. Cambia **dónde vive la tab activa** y **cuándo se desmonta un panel**. Lo único con superficie de riesgo sobre plata es la frescura, y por eso lleva su propia guarda (FR-004).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cambiar de tab es instantáneo (Priority: P1)

El encargado toca "Caja" y la tab cambia en el mismo frame, sin red de por medio.

**Why this priority**: es el gesto más repetido del turno y hoy es el más lento.

**Independent Test**: DevTools → Network, filtro `_rsc`. Recorrer las 7 tabs = **cero requests**. Hoy son 7.

**Acceptance Scenarios**:

1. **Dado** el operativo abierto en Mesas, **Cuando** toco "Caja", **Entonces** la tab cambia sin ningún request y la URL pasa a `?tab=caja`.
2. **Dado** que estoy en Caja, **Cuando** vuelvo a Mesas, **Entonces** el parámetro `?tab` desaparece de la URL (canónica limpia) y tampoco hay request.
3. **Dado** un deep-link `?tab=caja`, **Cuando** abro esa URL, **Entonces** el operativo abre en Caja.
4. **Dado** que estoy en una tab cualquiera, **Cuando** toco "atrás" en el navegador, **Entonces** se comporta como antes (sale del operativo) — se usa `replaceState`, igual que hacía `router.replace`.

### User Story 2 - Volver a una tab no la reconstruye (Priority: P1)

**Why this priority**: el remonte tiraba las suscripciones de realtime, el scroll y los filtros de cada panel; además `SalonDesktop` (2731 líneas) y `ComandasKanban` (1501) se re-montaban enteros.

**Acceptance Scenarios**:

1. **Dado** que visité Mesas y me fui a Comandas, **Cuando** miro el DOM, **Entonces** el panel de Mesas sigue montado (oculto con CSS), no desmontado.
2. **Dado** que nunca entré a Rendición, **Cuando** miro el DOM, **Entonces** ese panel **no** está montado (montaje lazy: el primer pintado sigue siendo el de Mesas).
3. **Dado** que estaba en el kanban con scroll a mitad de una columna, **Cuando** vuelvo de otra tab, **Entonces** sigue donde estaba.

### User Story 3 - Ninguna tab miente con datos viejos (Priority: P1)

**Why this priority**: cortar la navegación deja la promesa RSC **congelada al page-load**. Sin guarda, Caja y Rendición mostrarían plata de hace media hora justo cuando se decide un corte.

**Acceptance Scenarios**:

1. **Dado** un cobro registrado desde otra pantalla, **Cuando** entro a Caja, **Entonces** los números son los de la DB, no los del page-load.
2. **Dado** que vuelvo a Comandas después de un rato, **Cuando** entro, **Entonces** se refetchea la tab (`getComandasTabData`) — no reaparecen comandas ya entregadas.
3. **Dado** que entro **por primera vez** a Rendición o Reservas —el caso que más importa, porque el montaje es lazy—, **Entonces** también se revalida. Vale igual si la sesión arrancó en otra tab y `SalonDesktop` nunca montó.
4. **Dado** que dejé Caja y me fui a otra tab, **Cuando** pasan horas, **Entonces** el poll de `/api/caja/stats` **no** sigue corriendo de fondo.

### User Story 4 - Los links a una tab siguen funcionando (Priority: P2)

**Why this priority**: `/admin/cajas` redirige a `?tab=caja`, la campana de notificaciones linkea a `?tab=…` y el cobro vuelve al operativo igual. Con el shell ya montado, esas navegaciones no re-crean el estado.

**Acceptance Scenarios**:

1. **Dado** el operativo abierto en Mesas, **Cuando** llego por un link a `?tab=caja`, **Entonces** la tab cambia a Caja.

### Edge Cases

- **Tab inexistente en la URL** (`?tab=inventada`): cae en Mesas, no rompe.
- **Otros parámetros de la ruta**: el `?date=` de Reservas no se pisa al cambiar de tab (se reescriben los params leyéndolos de `window.location.search`).
- **Primer ingreso a Comandas**: es la única tab sin pill, así que su promesa no la consumió nadie en el page-load y React la descubre al montar el panel → un tick de skeleton, imperceptible.
- **Deep-link a una tab con puente** (`?tab=rendicion`): no dispara revalidación, y está bien — la page se acaba de renderizar en el server.
- **Modales abiertos al cambiar de tab**: quedan dentro de un contenedor `hidden`, así que desaparecen de la vista y siguen abiertos al volver. Es el comportamiento de la tab Pedidos desde siempre.

## Review adversarial (ronda 1)

27 agentes en 3 lentes (plata / React / layout-UX), cada hallazgo verificado por un refutador independiente. **Nueve confirmados**, todos corregidos antes de cerrar:

| # | Hallazgo | Fix |
|---|---|---|
| 1 | La guarda se comía la **primera** entrada a la tab, y Rendición —la única sin carga propia— quedaba con el snapshot del page-load. Repro ejecutable del verificador: primera entrada = 0 refresh, re-entrada = 1. | puentes al nivel del shell (ver ronda 2) |
| 2 | **Reservas quedó sin ninguna vía de revalidación**: no tiene realtime propio (el de reservas vive dentro de `SalonDesktop`), así que si la sesión arrancaba en otra tab —F5 con `?tab=caja`, ahora que la tab persiste en la URL— no había **un solo** `router.refresh()` en toda la página. El encargado no vería reservas nuevas y sentaría walk-ins sobre mesas reservadas. | puente propio |
| 3 | Fichaje: `finished`/`absent` viven en `useState` sin sync y `getCurrentPresent` sólo trae presentes → el resumen del día quedaba congelado. | puente en vez de refetch parcial |
| 4 | `useTabParam` era **write-only**: los links externos a `?tab=…` dejaban de cambiar de tab. | FR-006 |
| 5 | El keep-alive dejaba los polls corriendo en tabs ocultas **para siempre** (`/api/caja/stats` × N cajas cada 30 s por tablet). | FR-007 |

Rechazados por el pase de refutación (no eran reales o eran preexistentes al cambio): mutar `visited.current` en el render, mismatch de hidratación, el wrapper rompiendo el layout de Pedidos, el foco del plano, las pills congeladas, el desglose de caja y el ciclo abrir/cerrar caja (que no existe en el modelo).

## Review adversarial (ronda 2 — sobre los fixes de la ronda 1)

Misma lección que la spec 052: la ronda que más rinde es la que revisa **los propios fixes**. 22 agentes, **dos hallazgos reales**, los dos sobre lo que había agregado la ronda 1:

1. **El `onMount: true` de los tres puentes sobraba y costaba.** El razonamiento estaba mal ubicado: lo que monta lazy es el **panel**, no el shell — y los puentes viven en el shell, que está siempre montado, así que `active === "x"` ya transiciona false→true en la primera entrada. Lo único que agregaba `onMount` era un `router.refresh()` en el montaje del shell: como la tab queda pegada en la URL, cada F5 o arranque en frío de la tablet corría la page entera y **acto seguido la volvía a correr**, descartando datos de 200 ms atrás. Justo el round-trip que la spec vino a eliminar, en el momento más caro. Se sacó la opción (y sus tests): el default cubre el caso, y abrir directo en esa tab ya no dispara nada — correcto, porque el server acaba de renderizarla.
2. **`FichajeTab` congelaba los props**: `finished`/`absent` en `useState` sin setter y `present` sin re-sync. Con keep-alive el panel monta una sola vez, así que el `router.refresh()` del puente traía datos nuevos que **se descartaban** — el puente pagaba ~30 queries por cero frescura, y el badge de la tab (que lee la promesa) terminaba contradiciendo a las tarjetas. Ahora el resumen del día se deriva de los props y `present` se re-sincroniza.

Rechazados: que Caja quedara fuera del puente (sus stats decisorios los recalcula `getCajaLiveStats`, no el prop), el `$0` por fetch fallido y el pinneo de `ultimo_corte` (ambos preexistentes), un supuesto loop del effect de URL (verificado contra el código de Next 15.5.15: el `replaceState` descarta la navegación en vuelo, no al revés) y varios nits de comentarios.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La tab activa es **estado de cliente**. La URL se sincroniza con `window.history.replaceState`, que Next parchea para actualizar `useSearchParams` **sin request RSC**. Nada de `router.replace`/`push` para conmutar.
- **FR-002**: El valor inicial se lee de la URL **una sola vez**, en el initializer del `useState`, de modo que el render del server y la hidratación coincidan (sin mismatch).
- **FR-003**: Una tab se monta la **primera** vez que se entra y de ahí en más se oculta con CSS (`hidden`) en vez de desmontarse. El montaje es **lazy**: entrar a una tab no monta las otras.
- **FR-004**: Toda tab revalida **al activarse** (`useOnActivate`). Las que saben hacerlo solas usan lo suyo, sin tocar la ruta: Comandas `getComandasTabData`, Caja su poll de `/api/caja/stats`, Mesas y Pedidos su realtime. Las tres que no tienen nada propio —**Reservas, Rendición y Fichaje**— usan el **puente** `router.refresh()`, centralizado en el shell. Cuesta lo mismo que costaba antes cada click de tab, pero ahora sólo al entrar a esas tres; las specs 102/103 lo reemplazan por un refetch por tab.
- **FR-005**: La guarda cubre la **primera** entrada a la tab. Por eso los puentes viven en el shell y no en cada panel: el shell está siempre montado, así que `active === "x"` transiciona false→true también la primera vez. Abrir directo en esa tab (`?tab=rendicion`) no dispara nada — el server acaba de renderizarla.
- **FR-006**: La tab se reconcilia con la URL cuando **cambia desde afuera** (redirect de `/admin/cajas`, campana, vuelta del cobro). El estado local no puede quedar write-only.
- **FR-007**: Los polls (`/api/caja/stats` cada 30 s, presentes cada 60 s) **se detienen con la tab oculta**. Con keep-alive el panel ya no se desmonta, y sin esto cada tablet del local seguiría golpeando el server para siempre por tabs que nadie mira.

### Non-Functional / Guardas

- **NFR-001**: Cero cambios en actions, queries o RLS. Esta spec no puede alterar ningún número.
- **NFR-002**: El wrapper de cada panel lleva `h-full` cuando está activo, para no romper la cadena de altura de los paneles que la usan (Mesas, Fichaje).

## Implementación

| Archivo | Qué |
|---|---|
| `src/lib/ui/use-tab-param.ts` (nuevo) | `useTabParam(param, fallback, options)` + `useOnActivate(active, fn)` |
| `src/lib/ui/use-tab-param.test.ts` (nuevo) | 10 tests: default, deep-link, valor inválido, no navega, URL canónica, no pisa `?date=`, sync desde afuera, y los 3 del disparo de activación |
| `src/components/admin/local/local-shell.tsx` | tab por estado, keep-alive lazy, los 3 puentes de frescura, prop `active` a los paneles |
| `src/components/admin/local/local-shell.tabs.test.tsx` (nuevo) | 7 tests: no navega, keep-alive (mismo nodo), montaje lazy, deep-link, URL canónica, y que la **primera** entrada a Rendición y a Reservas revalida |
| `comandas-kanban.tsx` | refetch de la tab al reactivarse |
| `caja-admin-board.tsx` | el poll se detiene con la tab oculta y se relanza al volver |
| `fichaje-tab.tsx` | ídem el poll, + el resumen del día deja de vivir congelado en `useState` |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅
- Suite unitaria ✅ **1515 tests, 0 rojos** (146 archivos; integración excluida por falta de stack local).
- ⏳ **En vivo con rol real** (encargado de golf-jcr): las 7 tabs sin requests `_rsc`, los números de Caja/Rendición contra la DB después de un cobro hecho desde otra pantalla, y un link externo a `?tab=caja` con el operativo ya abierto.

## Qué NO entra

Los `router.refresh()` que quedan dentro de los paneles (10 en `salon-desktop`, 4 en `caja-admin-board`, 3 en `reservations-panel`, …) y los dos hooks de realtime que refrescan la ruta entera. Son las specs **102** (salón) y **103** (caja/rendición/reservas). El impuesto de auth por navegación (4 hops a Supabase Auth) es la **104**.
