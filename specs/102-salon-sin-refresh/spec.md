# Feature Specification: Salón — el plano deja de re-correr la página entera

**Feature Branch**: `102-salon-sin-refresh`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1521 tests) / build en verde, review adversarial con 3 hallazgos corregidos. **Pendiente verificar en vivo con rol real**. Issue [#160](https://github.com/gachetponzellini/RestaurantOS-app/issues/160).

**Input**: Iniciativa de perf percibida — [wiki/analyses/perf-percibida-operacion-mozo.md](../../../../wiki/analyses/perf-percibida-operacion-mozo.md). **Fase 2 de 4.** Continúa la [spec 101](../101-tabs-sin-red/spec.md); replica el patrón de la [spec 052](../052-kds-refetch-comandas/spec.md).

## Contexto y problema

La 101 sacó el round-trip de **cambiar de tab**. Queda el otro multiplicador, y es más caro porque corre durante el servicio: `salon-desktop.tsx` tenía **10 `router.refresh()`** —anular mesa, abrir con reserva, sentar reserva, limpiar distribución, cerrar el panel Distribuir, cerrar cobro, cerrar "pedir", walk-in, transferir y trasladar— y **los dos hooks de realtime hacían lo mismo en cada evento**.

Cada uno de esos re-ejecutaba `operacion/page.tsx` **entera**: `getBusiness` + `ensureAdminAccess` (hop de red a Supabase Auth) + `getSalonOptions` + las **7 promesas de tab** (~30 queries, con dos bucles N+1 adentro), y remandaba el árbol RSC completo por el cable a Virginia. Para mover una mesa.

El realtime es lo peor de los dos: cualquier mozo abriendo una mesa desde su teléfono disparaba ese ciclo completo en la tablet del encargado, con debounce de 200 ms como única contención. En hora pico, permanentemente.

El patrón de arreglo ya estaba escrito y validado en la [spec 052](../052-kds-refetch-comandas/spec.md) para Comandas. Esta spec lo replica en Mesas.

**Esta spec no toca plata:** no cambia ninguna mutación, ninguna query de cobro ni el overlay optimista de mesas que ya existía. Cambia **de dónde saca el plano sus datos** cuando algo cambia.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Una acción del plano cuesta lo que cuesta esa acción (Priority: P1)

**Why this priority**: es lo que el encargado hace todo el turno — abrir, sentar, transferir, anular, cobrar.

**Independent Test**: DevTools → Network. Anular una mesa dispara **una** action de 5 queries, no un render de la ruta con 30.

**Acceptance Scenarios**:

1. **Dado** que anulo / abro / transfiero / traslado una mesa, **Cuando** la action vuelve `ok`, **Entonces** el plano se re-sincroniza con `getSalonTabData` y **no** se re-ejecuta la page.
2. **Dado** un error del refetch (wifi del club, función fría), **Cuando** falla, **Entonces** el plano **mantiene** lo que tenía — nunca se vacía. Es un refresh de fondo, no una acción del usuario.
3. **Dado** dos refetch en vuelo, **Cuando** vuelven fuera de orden, **Entonces** sólo se aplica el más nuevo (guarda de secuencia).

### User Story 2 - El plano se mantiene vivo sin castigar al resto (Priority: P1)

**Why this priority**: con varias tablets y teléfonos, el realtime dispara seguido; hoy cada evento pagaba la página entera.

**Acceptance Scenarios**:

1. **Dado** que un mozo abre una mesa desde su teléfono, **Cuando** llega el evento de realtime, **Entonces** la tablet del encargado refetchea **sólo** la tab Mesas.
2. **Dado** una ráfaga (un walk-in dispara UPDATE de `tables` + INSERT de audit), **Cuando** llegan seguidos, **Entonces** el debounce de 200 ms los junta en **un** refetch.
3. **Dado** que vuelvo a la tab Mesas después de un rato, **Cuando** entro, **Entonces** se re-sincroniza: las órdenes dine-in **no tienen realtime propio** (sus ítems y totales cambian desde el teléfono del mozo, sin tocar `tables`) y con el keep-alive de la 101 el panel ya no se remonta.

### User Story 3 - El badge no contradice al panel (Priority: P2)

**Acceptance Scenarios**:

1. **Dado** que el plano se actualizó por refetch, **Cuando** miro la barra de tabs, **Entonces** el badge de Mesas cuenta sobre **ese** dato, no sobre el del page-load.

### Edge Cases

- **Refetch mientras el usuario está en otra tab**: el panel sigue montado (keep-alive), así que el refetch aplica igual y la vuelta a Mesas ya encuentra el plano al día.
- **Modo Distribuir mozos**: cada tap guarda con su propia action y pinta optimista; al cerrar el panel se re-sincroniza — ahora con 5 queries en vez de 30.
- **App del mozo (`/mozo`)**: sigue con el `router.refresh()` histórico. Los hooks de realtime lo mantienen como default y sólo cambian de comportamiento si el caller pasa `onChange`. Le toca su propia tanda.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `getSalonTabData(slug)` corre **sólo** las queries de `loadSalon` (el mismo loader que usa la page: floor plans + órdenes dine-in + reservas del día + mozos). La ventana de reservas se calcula en la TZ del **negocio**, igual que la page, para no correrse en el borde de medianoche.
- **FR-002**: **Gate de membresía obligatorio** (`requireMozoActionContext`) **antes** de tocar cualquier query. No es opcional: `loadSalon` corre con el cliente service-role (RLS bypass) y devuelve órdenes abiertas, reservas con nombre y teléfono, el plano y la nómina. Sin el gate, cualquier autenticado leería todo eso de otro negocio pasando un slug foráneo. Es la lección de la 2da ronda de review de la spec 052.
- **FR-003**: `serverData` en el cliente con **un solo escritor** (el refetch), guarda de carrera por secuencia, y `try/catch` que traga el error manteniendo el estado actual.
- **FR-004**: Los hooks de realtime aceptan `onChange`. Sin él conservan el `router.refresh()` histórico — `/mozo` no cambia de comportamiento en esta spec.
- **FR-005**: Volver a la tab Mesas dispara el refetch (`useOnActivate`).
- **FR-006**: El badge de Mesas se calcula sobre el último snapshot del refetch, no sobre la promesa RSC congelada.

## Implementación

| Archivo | Qué |
|---|---|
| `operacion/actions.ts` (nuevo) | `getSalonTabData(slug)` — colocada con `data.ts` y `counts.ts`, que es donde vive el server de esta ruta desde la spec 039 |
| `operacion/get-salon-tab-data.test.ts` (nuevo) | 4 tests: negocio inexistente, **no-miembro no lee el salón**, las 4 partes, y la ventana en TZ del negocio |
| `salon-desktop.tsx` | `serverData` + `refetchSalon`; los 10 `router.refresh()` pasan a refetch; `useRouter` desapareció del archivo |
| `use-tables-realtime.ts` · `use-reservations-realtime.ts` | `onChange` opcional (default = el refresh de ruta de siempre) |
| `local-shell.tsx` | `active` y `onServerData` a Mesas; el badge acepta un `override` ya resuelto |
| `order-summary-card.tsx` · `reservations-panel.tsx` | `onChanged` opcional (default = el refresh de siempre, que es lo que usa `/mozo`) |
| `salon-desktop.refetch.test.tsx` (nuevo) | 2 tests: entregar una comanda se refleja sin re-correr la ruta, y un refetch fallido no vacía el panel |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅
- Suite unitaria ✅ **1521 tests, 0 rojos**.
- ⏳ **En vivo con rol real**: anular una mesa y ver **una** llamada a la action (no un render de ruta); con dos pestañas abiertas, abrir una mesa en una y ver el plano de la otra actualizarse sin re-correr la página.

## Review adversarial

28 agentes en 4 lentes (seguridad multi-tenant / carreras / cobertura / operación real), cada hallazgo verificado por un refutador. **Tres confirmados**, corregidos:

1. **Grave — los hijos del salón quedaron mudos.** Al pasar el snapshot del server a estado propio, todo payload RSC posterior se descarta. Dos hijos que se renderizan **dentro** del salón seguían resolviendo con `router.refresh()`: `OrderSummaryCard` (entregar / anular comanda) y `ReservationsPanel`. El de comandas no se auto-curaba —`marcarComandaEntregada` no toca `tables` y el salón no escucha `comandas`—, así que la fila seguía diciendo «Activa» con el botón puesto y la mesa quedaba marcada demorada, pagando igual las ~30 queries del refresh y tirándolas. El verificador lo reprodujo con un test que pasa en `master` y falla con el cambio. Fix: prop `onChanged` (con caída al refresh de siempre, para no tocar `/mozo`) + test de regresión permanente.
2. **La tab Reservas dejó de enterarse en vivo.** La única suscripción a `reservations` de la app vive en el salón; su `router.refresh()` era, de rebote, lo que mantenía vivo el libro del día. Fix: además de re-sincronizar el plano, avisa al shell, que revalida la ruta **sólo si el encargado está justo mirando esa tab**.
3. **Los badges de Reservas y Rendición** quedan con el conteo del page-load hasta que se entra a esas tabs (ahí el puente de la spec 101 los revalida). Se acepta como limitación conocida: la 103 les da su propio refetch de tab.

Rechazados: gate insuficiente (el helper valida `business_users` por (business_id, user_id) y rechaza deshabilitados), sesión vencida que no se ve (la corta el middleware antes de la action), overlay optimista pegado, y varios preexistentes que el cambio no agrava.

## Qué NO entra

Los `router.refresh()` de Caja (4), Reservas (3+3), Rendición (2) y Caja-assignments (2), más el navegador de fechas de Reservas y los dos N+1 seriales de `loadCaja`/`loadRendicion`: son la **spec 103**. El impuesto de auth por navegación es la **104**. La app del mozo, su propia tanda.
