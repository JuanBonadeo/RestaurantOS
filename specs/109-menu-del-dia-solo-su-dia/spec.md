# Feature Specification: El menú del día sólo entra su día

**Feature Branch**: `109-menu-del-dia-solo-su-dia`

**Created**: 2026-08-09

**Status**: 🟡 Implementada — typecheck / suite unitaria (1552 tests) / build en verde. **Pendiente verificar en vivo con rol real**. Issue [#167](https://github.com/gachetponzellini/RestaurantOS-app/issues/167).

**Input**: Observación incidental del review de las specs [107](../107-home-del-mozo/spec.md) / [108](../108-bundle-del-panel/spec.md). No es perf: es correctitud, y toca plata.

## Contexto y problema

Dos huecos que se tapaban entre sí, los dos sobre `daily_menus.available_days`.

**1. `enviarComanda` no validaba el día.** El camino del cliente online sí: `persist-order.ts` chequea `available_days` y rechaza con *"no está disponible hoy"*. El del mozo seleccionaba `is_active, is_available` y **nunca miraba `available_days`**.

El catálogo del mozo filtra por día al listar, así que la UI no lo ofrece — pero eso es la vista, no el gate. Una tablet abierta desde ayer (el turno cruza la medianoche **todas** las noches) manda el combo de otro día y el server lo acepta, cobrando el precio del combo en una jornada donde no se ofrece.

**2. El día se calculaba en la TZ del proceso.** `currentDayOfWeek` hacía `toZonedTime(now, tz).getUTCDay()`, que sólo acierta si el proceso corre en UTC. Medido:

| proceso | sáb 21:00 AR | dom 01:00 AR | lun 00:30 AR |
|---|---|---|---|
| UTC | ok | ok | ok |
| AR (UTC-3) | **domingo** | ok | ok |
| Tokio (UTC+9) | ok | **sábado** | **domingo** |

En producción no se veía —Vercel corre en UTC— pero en `pnpm dev` desde Argentina el menú del sábado a la noche era el del domingo. Y el catálogo del mozo tenía la misma falla por otra vía: `new Date().getDay()`, directamente la TZ del server.

Que el docstring del helper afirmara lo contrario —que los métodos UTC eran los correctos— es parte del hallazgo: la creencia estaba escrita.

## Requirements *(mandatory)*

- **FR-001**: `menuDisponibleHoy(availableDays, todayDow)` es **el** predicado, y lo usan los dos caminos que crean pedidos. La asimetría entre ellos fue el bug; dos copias eran la garantía de que volviera.
- **FR-002**: Sin días configurados, no se ofrece. La columna arranca en `'{}'` y el listado filtra con `contains`, que sobre un array vacío no matchea: decir "sin restricción" acá haría que el server acepte lo que la pantalla nunca mostró.
- **FR-003**: `currentDayOfWeek` no depende de la TZ del proceso (`formatInTimeZone(now, tz, "i") % 7`).
- **FR-004**: El catálogo del mozo calcula el día en la TZ del negocio. Va junto con FR-001: sólo el gate del server dejaría al mozo mirando un combo que el server le rechaza.

## Implementación

| Archivo | Qué |
|---|---|
| `src/lib/daily-menus/disponible-hoy.ts` (nuevo) | el predicado, con las dos reglas y su porqué |
| `src/lib/daily-menus/disponible-hoy.test.ts` (nuevo) | 7 tests, incluidos los tres casos de borde de medianoche |
| `src/lib/comandas/actions.ts` | `enviarComanda` trae `available_days` y valida el día |
| `src/lib/orders/persist-order.ts` | pasa a usar el predicado compartido |
| `src/lib/day-of-week.ts` | lectura independiente de la TZ del proceso, y el docstring corregido |
| `src/lib/mozo/pedir-panel-data.ts` | el día del catálogo, en la TZ del negocio |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅ · suite ✅ **1552 tests**.
- ⏳ **En vivo**: cargar un menú del día habilitado sólo para un día que no sea hoy y confirmar que (a) no aparece en el catálogo del mozo y (b) si se fuerza el envío, el server lo rechaza.

## Lo que NO era un bug

En el mismo lote se reportó que `enviarComanda` no validaba el min/max de los grupos de modificadores. **Falso**: los productos se validan en `actions.ts:327-362` y los del combo en `resolveModifiers` (`combo-modifiers.ts:137-151`). Queda anotado para que no vuelva a reportarse.
