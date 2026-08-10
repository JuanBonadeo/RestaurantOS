# Feature Specification: Caja, Rendición y Reservas — el operativo deja de refrescar la ruta

**Feature Branch**: `103-plata-sin-refresh`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1537 tests) / build en verde, review adversarial con 4 hallazgos corregidos. **Pendiente verificar en vivo con rol real**. Issue [#161](https://github.com/gachetponzellini/RestaurantOS-app/issues/161).

**Input**: Iniciativa de perf percibida — [wiki/analyses/perf-percibida-operacion-mozo.md](../../../../wiki/analyses/perf-percibida-operacion-mozo.md). **Fase 3 de 4.** Cierra lo que abrieron la [spec 101](../101-tabs-sin-red/spec.md) y la [spec 102](../102-salon-sin-refresh/spec.md).

## Contexto y problema

La 101 sacó el round-trip de cambiar de tab; la 102, el del salón. Queda el resto del operativo: **13 `router.refresh()`** repartidos en Caja (4), el libro de reservas (3), Rendición (2), las asignaciones de caja (2) y el alta de reserva (1) — más el navegador de fechas, que además hacía un `router.push` por cada flecha. Cada uno re-ejecuta `operacion/page.tsx` entera: las 7 promesas de tab, ~30 queries y el árbol RSC completo. **Registrar una sangría cuesta lo mismo que cargar la pantalla de cero.**

Y quedaba una deuda declarada: la 101 dejó tres **puentes** `router.refresh()` (Reservas, Rendición, Fichaje) porque esas tabs no tenían forma propia de revalidar y, con el keep-alive, mostrarían el snapshot congelado del page-load. Eran un parche explícito hasta esta spec.

Aparte, la carga inicial arrastraba **dos N+1 seriales** en `src/lib/caja/queries.ts`: `getCajasConEstado` encadenaba 2 queries por caja y `getRendicionesPendientesTodosLosMozos` una consulta de pagos por mozo. Eso lo paga **toda** la operación cada vez que se abre `/admin/operacion`, mire la tab que mire.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mover plata cuesta lo que cuesta mover plata (Priority: P1)

**Independent Test**: DevTools → Network. Una sangría dispara **una** action de la tab Caja, no un render de ruta.

**Acceptance Scenarios**:

1. **Dado** que registro una sangría, un ingreso o un corte, **Cuando** la action vuelve `ok`, **Entonces** se re-piden **las dos mitades** de la tab: el estado de las cajas (`getCajaTabData`) y los stats vivos — en ese orden, con los stats recomputados **después** del insert. Al revés, el corte mostraría la plata del período que acaba de cerrar.
2. **Dado** que rindo un mozo, **Cuando** vuelve `ok`, **Entonces** el snapshot de Rendición se reemplaza **entero** con lo que devuelve el server. Nada se suma en el cliente: así es como se duplica una rendición.
3. **Dado** que el refetch falla, **Cuando** no vuelve, **Entonces** la tab **mantiene** lo que tenía. Una superficie de plata no se vacía por un problema de red.

### User Story 2 - El libro de reservas cambia de día sin navegar (Priority: P1)

**Acceptance Scenarios**:

1. **Dado** que toco la flecha del día siguiente, **Cuando** cambia, **Entonces** la URL se actualiza con la History API y el día nuevo se pide con `getReservasTabData(slug, date)` — sin navegación y sin tocar las otras seis tabs.
2. **Dado** que siento, cancelo o edito una reserva, **Cuando** vuelve `ok`, **Entonces** se re-pide **el día que estoy mirando**, no "hoy".
3. **Dado** que estoy en la tab Reservas, **Cuando** entra una reserva de la web o del chatbot, **Entonces** aparece sola (el realtime del salón avisa y la tab re-pide su día).

### User Story 3 - Abrir una tab por primera vez trae datos de ahora (Priority: P1)

**Why this priority**: los paneles montan lazy. Sin esto, la primera entrada —la que más importa— pinta la promesa del page-load, que puede ser de hace horas.

**Acceptance Scenarios**:

1. **Dado** que abrí el operativo en Mesas hace tres horas, **Cuando** entro por primera vez a Caja, **Entonces** revalida antes de mostrar.
2. **Dado** que abrí la página directamente en `?tab=caja`, **Cuando** carga, **Entonces** **no** refetchea: el server la acaba de renderizar y pedirla de nuevo sería tirar plata.

### Edge Cases

- **Cambio de día con un refetch en vuelo**: guarda de secuencia — sólo se aplica la respuesta más nueva, así una flecha rápida no deja el libro en el día anterior.
- **Componentes que viven en dos lados** (`AdminDayList` en `/admin/reservas`, `ReservaForm` en el salón, `CajaAssignmentsPanel`, `OrderSummaryCard` en `/mozo`): todos los `onChanged` son **opcionales** y caen al `router.refresh()` histórico. Afuera del operativo nada cambia de comportamiento.
- **El mozo llamando la action**: rechazada por rol, con el loader sin correr.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Una action por tab, todas con el mismo loader que usa la page.
- **FR-002**: **Gate de membresía + gate de rol** (`requireOperacionContext`), el mismo que aplica `operacion/page.tsx`. La membresía sola no alcanza: los loaders corren con service-role, y sin el gate de rol un mozo leería por la puerta de atrás la caja del turno y lo que rindieron sus compañeros — una pantalla que la UI le niega.
- **FR-003**: Cada panel con `serverData` propio: un solo escritor, guarda de secuencia, `catch` que traga manteniendo el estado.
- **FR-004**: Cero `router.refresh()` en el operativo. Los que quedan en componentes compartidos son fallbacks para su uso fuera del shell.
- **FR-005**: `useOnActivate(…, { onMount })` con `refetchAlMontar = tabInicial !== esaTab`: revalida la primera vez que se abre una tab, y **no** la tab con la que se abrió la página.
- **FR-006**: Los badges cuentan sobre el último snapshot de su tab.
- **FR-007**: `getCajasConEstado` y `getRendicionesPendientesTodosLosMozos` dejan de ser N+1 seriales.

## Implementación

| Archivo | Qué |
|---|---|
| `operacion/actions.ts` | `requireOperacionContext` (membresía + rol) + las 4 actions nuevas |
| `operacion/tab-data-actions.test.ts` | 21 tests: gate de rol y de membresía por action, la ventana en TZ del negocio, y el `date` inválido que cae en hoy |
| `caja-admin-board.tsx` · `rendicion-mozos-tab.tsx` | `serverData` + refetch; el corte recomputa stats después del insert |
| `local-shell.tsx` | `ReservasPanel` y `FichajePanel` con estado propio; overrides de los 5 badges; fuera los 3 puentes |
| `admin-day-list.tsx` · `new-reservation-modal.tsx` · `caja-assignments-tab.tsx` | `onChanged` opcional (default = el comportamiento histórico) |
| `src/lib/caja/queries.ts` | los dos N+1 → queries agrupadas / `Promise.all` |
| `src/lib/ui/use-tab-param.ts` | vuelve la opción `onMount`, ahora con el docstring que explica cuándo hace falta |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅
- Suite unitaria ✅ **1537 tests, 0 rojos**.
- ⏳ **En vivo con rol real**: sangría / corte / rendición con Network abierto (una action, no un render de ruta); cambiar de día en el libro; y los números de Caja contra la DB después de un cobro hecho desde otra pantalla.

## Review adversarial

31 agentes en 4 lentes (plata / las queries reescritas / frescura / regresiones fuera del operativo), cada hallazgo verificado por un refutador con el código en la mano. **Cuatro confirmados**, corregidos:

1. **El fix del N+1 se había comido la cota por caja.** Cambiar N lecturas `limit(1)` por una sola query `.in()` sin límite expone la lectura al `max_rows` de PostgREST (**1000**, fijado en `supabase/config.toml`), que trunca **en silencio**: con más de 1000 cortes del negocio posteriores al último corte de una caja, esa caja se leería como "nunca cortada" — "$0 inicio" y período desde el día que se creó, en la misma tarjeta donde el efectivo esperado sí sale del corte real (`getCajaLiveStats` conserva su `limit(1)`). Una pantalla de plata inconsistente consigo misma. Un verificador lo reprodujo con un test que corta la respuesta en 1000 filas. Ahora los cortes se piden **acotados por caja, en paralelo**: un solo round-trip lógico, ninguna query capaz de traer historia. Regla que queda escrita: en este repo, ninguna lectura sin `.limit()` sobre una tabla que crece por transacción.
2. **Carrera del día en el libro de reservas.** El reload usaba el día **pintado**, así que una revalidación que se cruzara con un cambio de día revertía al anterior — contra la URL, que ya decía el nuevo. Ahora se marca el día **pedido** antes del await.
3. **`useRouter` muerto** en `local-shell.tsx` (al irse los tres puentes).
4. **`useRouter` muerto** en `CajaCard` (al irse sus tres refresh).

Rechazados, entre otros: que el corte pudiera decidirse sobre stats viejos, que el snapshot de Rendición duplicara filas, que dos cortes simultáneos pasaran (preexistente, y el server tiene su propia guarda), y que el gate nuevo pudiera dejar una pantalla de plata en blanco por sesión vencida (la corta el middleware antes de llegar a la action). También se verificó que el candado de correcciones sobre un arqueo cerrado **no** depende de esta query: lo aplica el server en `correccion-actions.ts` con su propia lectura acotada.

## Qué NO entra

El impuesto de auth por navegación (4 hops a Supabase Auth, `ensureAdminAccess` sin `React.cache`, el layout admin que bloquea a `children`) y los `loading.tsx` que faltan: **spec 104**. La app del mozo, su propia tanda.
