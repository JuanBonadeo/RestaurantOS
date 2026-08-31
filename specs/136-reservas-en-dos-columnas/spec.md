# 136 · La pantalla de reservas, en dos columnas

**Issue:** [#207](https://github.com/gachetponzellini/RestaurantOS-app/issues/207) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📝 spec aprobada (diseño acordado con Juan el 2026-08-31) — lista para implementar

**Input:** Juan, 2026-08-31: *"yo creo que se debería ver mejor la tab de
reservas"*, y sobre el layout: las dos cosas **juntas en una pantalla**, con la
aclaración de que es una pantalla de escritorio — *"no tiene que ser mobile esta
pantalla, o sea sí pero no es importante"*.

**Segunda de tres.** [135 · bandeja](../135-la-bandeja-de-solicitudes/spec.md)
→ 136 · layout → [137 · plano del día](../137-el-plano-del-dia/spec.md).

**Depende de**: [`135`](../135-la-bandeja-de-solicitudes/spec.md) (la bandeja
existe y funciona; acá se muda a su lugar).

## Por qué

La 135 pone la bandeja donde había lugar. Esta le da la forma que el trabajo
real necesita.

El encargado hace **dos cosas distintas** en esta pantalla y hoy compiten por el
mismo espacio: *contestar lo que entró* (cualquier día, cualquier momento) y
*trabajar el turno* (este día, esta noche). Como tabs, cada una tapa a la otra:
mirando el día no se ve que hay tres solicitudes esperando, y mirando la bandeja
se pierde de vista la noche que se está armando.

En escritorio hay ancho de sobra para las dos. Es lo que Juan pidió: juntas.

## Las decisiones

**D1 · Dos columnas: el día manda, la bandeja acompaña.** Izquierda ancha para
el día, derecha fija (~340 px) para la bandeja. La proporción dice la verdad:
el día es donde se trabaja, la bandeja es lo que interrumpe.

**D2 · La bandeja se queda quieta.** `position: sticky` en la columna derecha:
al bajar por una lista larga de reservas, las solicitudes siguen a la vista.

**D3 · Escritorio primero, teléfono decente.** Por debajo del breakpoint las
dos columnas se apilan con la **bandeja arriba** — en un teléfono, lo primero
es lo que hay que contestar. No es la pantalla que se usa en el salón (para eso
está Operación), así que no se invierte esfuerzo en pulir esa vista.

**D4 · La tab «Pendientes» desaparece de la lista del día.** Tener las
solicitudes en dos lugares de la misma pantalla es pedir que se contradigan. En
la lista del día quedan las tabs del turno: Todas · Próximas · En mesa ·
Pasadas.

**D5 · Los KPI dicen lo que la pantalla no dice en otro lado.** Hoy son cuatro
y dos se pisan con lo que ya está a la vista. Quedan tres, sobre el día que se
está mirando: **Reservas** (con cubiertos abajo), **En mesa** y **Próxima**. Lo
pendiente sale de los KPI: ahora tiene una columna entera.

**D6 · Los días con solicitudes se marcan en el navegador de fechas.** Un punto
ámbar sobre el día. Es el único lugar donde el estado de otro día cabe sin
ruido, y evita tener que recorrer la bandeja para saber dónde se está juntando
trabajo.

**D7 · En Operación, bandeja + lista, sin plano.** La tab «Reservas» del
operativo hereda el mismo layout, pero la columna izquierda es siempre la lista:
al lado está la tab «Mesas» con el salón en vivo, y dos planos que muestran
cosas distintas en la misma pantalla confunden más de lo que ayudan.

## Alcance

### UI

- **`reservas/page.tsx`:** carga en paralelo lo del día (como hoy) y las
  solicitudes futuras (`getPendingReservations`, spec 135), y arma el grid de
  dos columnas.
- **`admin-day-list.tsx`:**
  - fuera el filtro `pending` y su tab; fuera `pendingCount` de la barra;
  - los KPI pasan a tres (D5);
  - `buildDateStrip` recibe los días que tienen solicitudes para pintar el punto
    (D6);
  - el resto de la lista queda igual: el turno ya funciona.
- **`solicitudes-inbox.tsx`** (de la 135) se monta en la columna derecha, con
  el modo compacto de tarjeta que pide el ancho de 340 px.
- **Operación:** el panel de la tab «Reservas» arma el mismo grid con la lista
  a la izquierda (D7).

### Dominio

Sin migración y sin actions nuevas. Lo único que cambia del server es que la
página pide dos cosas en vez de una.

## Qué NO entra

- **El plano**: es la 137.
- **Pulir la vista de teléfono.** Se apila y se usa; no se rediseña.
- **Tocar la lista del día más allá de las tabs y los KPI.** Lo que funciona en
  el turno se queda como está.

## Escenarios de aceptación

1. **Dado** un escritorio, **entonces** se ven el día y la bandeja al mismo
   tiempo, sin cambiar de pestaña.
2. **Dado** que la lista del día es larga, **cuando** el encargado baja,
   **entonces** la bandeja sigue visible.
3. **Dado** que se resuelve una solicitud del día que se está mirando,
   **entonces** desaparece de la bandeja y aparece en la lista del día.
4. **Dado** la lista del día, **entonces** ya no hay tab «Pendientes» y las
   solicitudes del día siguen contándose en los KPI de reservas y cubiertos
   (toman el lugar, spec 131).
5. **Dado** un día con solicitudes sin responder, **entonces** el navegador de
   fechas lo marca.
6. **Dado** un teléfono, **entonces** las columnas se apilan con la bandeja
   arriba y todo sigue siendo usable.
7. **Dado** la tab «Reservas» de Operación, **entonces** se ven bandeja y lista,
   y ningún plano.

## Verificación

- Unit: los KPI del día con pendientes adentro (`day-stats`), y qué días marca
  el strip.
- `pnpm typecheck` + tests en verde.
- En vivo en `demo` como Sofía: con solicitudes de dos días distintos, confirmar
  una desde la bandeja y verla aparecer en la lista del día sin recargar; y
  revisar la tab «Reservas» de Operación.
