# 135 · La bandeja de solicitudes

**Issue:** [#206](https://github.com/gachetponzellini/RestaurantOS-app/issues/206) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📝 spec aprobada (diseño acordado con Juan el 2026-08-31) — lista para implementar

**Input:** Juan, 2026-08-31: *"habría que rediseñar la pantalla de reservas,
teniendo en cuenta que ahora tienen que confirmar todas las reservas… que en
alguna parte se vean todas las reservas a confirmar, sin importar de qué día
sean"*.

**Primera de tres.** 135 · bandeja → [136 · layout](../136-reservas-en-dos-columnas/spec.md)
→ [137 · plano del día](../137-el-plano-del-dia/spec.md).

**Depende de**: [`131`](../131-confirmar-la-reserva/spec.md) (el estado
`pending`, `decideReservation`, el vencimiento), [`132`](../132-la-decision-por-whatsapp/spec.md)
(editar una pendiente), [`077`](../077-reservas-cupo-real/spec.md) (el cupo del
servicio).

## Por qué

La 131 puso a todas las reservas de cliente a esperar una decisión, y dejó la
bandeja donde había lugar: una **tab dentro de la vista de un día**. Pero la
página carga un día y nada más —
[`reservas/page.tsx`](<../../src/app/[business_slug]/admin/(authed)/reservas/page.tsx>)
filtra `gte dayStart` / `lt dayEnd` — así que una solicitud para el sábado
**no existe** hasta que alguien navega al sábado.

Eso convierte el vencimiento automático (D4 de la 131) en una trampa: la
solicitud que nadie miró se cierra sola a las dos horas del turno, y el
encargado nunca supo que estuvo ahí. El local no queda peor que antes, pero el
cliente sí: pidió, esperó, y no le contestaron.

El otro agujero es de contexto. La fila de hoy dice hora, nombre y personas. La
pregunta que hay que responder para confirmar no es esa, es **cómo viene ese
servicio**: cuatro personas sobre un almuerzo a 96/100 cubiertos es una decisión
distinta a las mismas cuatro sobre uno a 48/100 — y hoy ese número está en otra
pantalla.

## Las decisiones

**D1 · La bandeja es global.** Todas las solicitudes `pending` con `starts_at`
futuro, sin filtro de fecha ni de salón. La consulta deja de estar atada al día
que se está mirando.

**D2 · Agrupadas por día, y adentro por la que vence primero.** El orden es el
del apuro real: primero la que se muere, no la que entró antes.

**D3 · Cada solicitud trae con qué decidir.** Además de lo obvio (cuándo,
quién, cuántos), la fila muestra **la ocupación del servicio al que entra** y
**cuánto le queda antes de vencer**. Sin eso, confirmar es un acto de fe y la
bandeja es apenas una lista de nombres.

**D4 · Las tres acciones, sin salir.** Confirmar · Editar · Rechazar, que ya
existen (`decideReservation` de la 131, `updateReservationDetails` abierto a
`pending` en la 132). Editar abre el mismo panel inline que la lista del día.

**D5 · La ocupación se dice distinto según el modo.** En **flexible** hay cupo
de verdad (`soft_capacity`): «Cena · 48/100 cubiertos» con la barra. En
**estricto** no hay cupo configurado, así que se dice lo que sí es cierto:
cuántas mesas quedan libres para ese horario. Una sola pieza de UI, dos
lecturas, según lo que el negocio tenga.

**D6 · Se actualiza sola.** La bandeja se suscribe al realtime de reservas que
ya existe (`use-reservations-realtime`, migración 0023): una solicitud nueva
aparece sin recargar, y una que otro encargado ya resolvió desaparece.

## Alcance

### Datos

Sin migración. `reservations_pending_idx` (business + starts_at, parcial sobre
`pending`) ya lo creó la migración 0053 justo para esta consulta.

### Dominio

- **`queries.ts` → `getPendingReservations(businessId, timezone)`:** las
  `pending` futuras del negocio con `tables(label, floor_plans(id, name))`,
  ordenadas por `starts_at`. Sin ventana de fecha.
- **`pending-inbox.ts` (nuevo, puro):** arma lo que la UI necesita por
  solicitud, sin tocar la DB:
  - `agruparPorDia(solicitudes, timezone)` → días con sus solicitudes, en orden.
  - `ocupacionDeLaSolicitud(...)` → el texto y la proporción de la barra, con
    las dos lecturas de D5.
  - el vencimiento sale de `pendingExpiresAt` (spec 131) — acá sólo se formatea
    («vence en 2 h», «vence hoy 19:00»).
- Las acciones se reusan tal cual. No hay server actions nuevas.

### UI

**`solicitudes-inbox.tsx` (nuevo).** Recibe las solicitudes ya resueltas por el
server y se encarga de: agrupar, pintar, y llamar a las tres acciones. Estados:

- **Con solicitudes:** días y tarjetas, como el mockup acordado.
- **Vacía:** «No hay solicitudes esperando respuesta» — un estado corto y
  tranquilo, no una disculpa.
- **Resolviendo:** la tarjeta se apaga mientras la acción va y viene.

La tarjeta muestra, en este orden de peso visual: hora (grande) · nombre ·
personas · servicio y salón · por dónde entró y hace cuánto · notas si hay ·
ocupación del servicio (a la derecha) · aviso de vencimiento cuando falta poco.

Esta spec **monta la bandeja donde hoy está la tab «Pendientes»** de la lista
del día, para que sirva desde el primer día. La 136 la muda a su columna.

## Qué NO entra

- **El layout de dos columnas** y sacar la tab «Pendientes»: es la 136.
- **El plano**: es la 137.
- **Acciones en lote** («confirmar las cuatro del sábado»). Cada solicitud es
  una decisión; el lote invita a apretar sin leer.
- **Solicitudes pasadas o vencidas.** La bandeja es trabajo por hacer, no
  historial: lo vencido se ve en la lista del día que corresponda.

## Escenarios de aceptación

1. **Dado** una solicitud para dentro de cinco días, **cuando** el encargado
   abre reservas mirando hoy, **entonces** la ve en la bandeja igual.
2. **Dado** varias solicitudes, **entonces** aparecen agrupadas por día y,
   dentro del día, primero la que vence antes.
3. **Dado** una solicitud a menos de tres horas de vencer, **entonces** la
   tarjeta lo dice y se distingue del resto.
4. **Dado** un negocio flexible, **entonces** la tarjeta muestra los cubiertos
   reservados del servicio sobre el cupo; **dado** uno estricto, muestra cuántas
   mesas quedan libres a ese horario.
5. **Dado** que el encargado confirma desde la bandeja, **entonces** la tarjeta
   desaparece y el cliente recibe el aviso (spec 131/132).
6. **Dado** que rechaza con motivo, **entonces** desaparece y el lugar se
   libera.
7. **Dado** que edita hora o mesa desde la bandeja, **entonces** la solicitud
   sigue pendiente y la tarjeta muestra los datos nuevos.
8. **Dado** que entra una solicitud nueva mientras la pantalla está abierta,
   **entonces** aparece sola.
9. **Dado** que no hay ninguna, **entonces** se ve el estado vacío y la pantalla
   no pierde altura útil.

## Verificación

- Unit de `pending-inbox.ts`: agrupación con cambio de día en TZ AR, orden por
  vencimiento, las dos lecturas de ocupación, el formateo del «vence en».
- `pnpm typecheck` + tests en verde.
- En vivo en `demo` como Sofía (encargada): cargar dos solicitudes de días
  distintos desde `/demo/reservar`, verlas juntas en la bandeja mirando hoy,
  confirmar una y rechazar la otra.
