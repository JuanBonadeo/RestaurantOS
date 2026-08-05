# Feature Specification: Editar una reserva — mesa, comensales y horario

**Feature Branch**: `097-editar-reserva`

**Created**: 2026-08-05

**Status**: 📝 Spec — lista para implementar.

**Input**: Juan, 2026-08-05: *"hay que agregar la funcionalidad de poder modificar reservas, cambiar la mesa la cantidad de personas y el horario"*.

**Issue**: #149

**Depende de**: [`059-reservas-modo-flexible`](../059-reservas-modo-flexible/spec.md) · [`077-reservas-cupo-real`](../077-reservas-cupo-real/spec.md) · [`081-reservas-cupo-por-mesas`](../081-reservas-cupo-por-mesas/spec.md).

## Contexto y problema

Hoy `updateReservationDetails` (`src/lib/reservations/booking-actions.ts`) edita **mesa + comensales** y nada más. Tres agujeros:

1. **El horario no se puede cambiar en ningún lado.** No hay una sola escritura de `starts_at` fuera del insert. El cliente que llama para pasar de las 21:00 a las 22:00 obliga al encargado a **cancelar y volver a cargar**: se pierde el rastro (la reserva original queda `cancelled`), y si vino de la web se le dispara al cliente el aviso de cancelación de una reserva que en realidad sigue viva.

2. **En modo flexible las reservas genéricas no se pueden editar.** `UpdateReservationDetailsInputSchema` exige `table_id: z.string().uuid()` y el panel de edición deshabilita «Guardar» sin mesa. Las reservas que crea la web en flexible son **genéricas por diseño** (la mesa se decide al llegar, spec 059) → en `golf-jcr`, que es el único negocio real y está en `mode: flexible`, **el botón «Editar» no sirve para el caso normal**. Ni siquiera para cambiar los comensales.

3. **No se puede cambiar de servicio.** Pasar una reserva de Almuerzo a Cena es exactamente "cambiar el horario" en el vocabulario del modo flexible, y hoy no existe.

El editor también es lo que hace que el cupo de las specs 077/081 sea real: si mover una reserva es "cancelar + crear", el encargado esquiva todas las validaciones de cupo cada vez que un cliente cambia de idea.

## Alcance

**Entra:** mesa (incluida «sin mesa» en flexible), comensales, hora, y servicio en flexible. Sobre reservas `confirmed`, desde el panel de reservas del admin.

**No entra:**
- **Cambiar la fecha.** Mover a otro día es otra cosa (la lista es por día y el cliente reservó ese día). Se pidió el horario, no la agenda.
- **Avisarle al cliente que le cambiaron la reserva.** Falta de verdad — hoy se le manda mail/WhatsApp cuando *se confirma* (spec 45) pero no cuando *se modifica*. Queda anotado como siguiente paso, no se construye acá.
- Editar reservas ya `seated`/`completed`/`no_show`/`cancelled`.
- Que el cliente edite su propia reserva desde la web (hoy sólo puede cancelar).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cambiar el horario sin cancelar (Priority: P1)

Como encargado, cuando el cliente llama para correr la reserva una hora, la muevo y sigue siendo la misma reserva.

**Independent Test**: Editar una reserva confirmada de las 21:00 a las 22:00 y verificar que la fila sigue siendo la misma (mismo id, mismo estado, mismo cliente) con el horario nuevo.

**Acceptance Scenarios**:

1. **Dado** una reserva confirmada, **Cuando** el encargado le cambia la hora, **Entonces** se guarda con el nuevo `starts_at` y el `ends_at` recalculado, sin cancelar ni crear nada.
2. **Dado** el modo **estricto**, **Cuando** cambia la hora, **Entonces** `ends_at = starts_at + slot_duration_min` (la duración configurada del negocio).
3. **Dado** el modo **flexible**, **Cuando** cambia la hora de llegada dentro del mismo servicio, **Entonces** `ends_at` sigue siendo **el cierre del servicio** (regla de la 059: la hora ancla, el bloqueo llega hasta el cierre).
4. **Dado** una reserva en la mesa 5 a las 21:00, **Cuando** se la mueve a un horario donde la mesa 5 ya está tomada por otra reserva, **Entonces** se rechaza con «La mesa ya está reservada en ese horario» y no se guarda nada.
5. **Dado** que se mueve la reserva **sin cambiar de mesa**, **Entonces** la validación de solape **no la cuenta a ella misma** como conflicto.

---

### User Story 2 - Editar una reserva genérica del modo flexible (Priority: P1)

Como encargado de `golf-jcr`, edito los comensales o el horario de una reserva que todavía no tiene mesa, sin verme obligado a asignarle una.

**Independent Test**: Sobre una reserva genérica (sin mesa) del modo flexible, cambiar comensales de 4 a 6 y guardar.

**Acceptance Scenarios**:

1. **Dado** el modo flexible y una reserva **sin mesa**, **Cuando** el encargado cambia los comensales, **Entonces** se guarda y la reserva **sigue sin mesa**.
2. **Dado** el modo flexible y una reserva **con mesa**, **Cuando** el encargado elige «Sin mesa», **Entonces** la reserva vuelve a genérica y libera la mesa para ese servicio.
3. **Dado** el modo **estricto**, **Cuando** se intenta guardar sin mesa, **Entonces** se rechaza: en estricto la mesa es obligatoria.
4. **Dado** una reserva que pasa a tener mesa, **Entonces** su zona (`floor_plan_id`) queda derivada de la mesa; si vuelve a genérica, conserva la zona que tenía.

---

### User Story 3 - Cambiar de servicio en el modo flexible (Priority: P2)

Como encargado, paso una reserva de Almuerzo a Cena del mismo día.

**Independent Test**: Editar una reserva de Almuerzo eligiendo el servicio Cena y verificar que queda dentro de la ventana de la Cena.

**Acceptance Scenarios**:

1. **Dado** una reserva de Almuerzo, **Cuando** se elige el servicio Cena, **Entonces** `starts_at` cae dentro de la ventana de la Cena y `ends_at` es el cierre de la Cena.
2. **Dado** que se cambia de servicio **sin elegir hora**, **Entonces** la reserva arranca en la **apertura** del servicio nuevo.
3. **Dado** un servicio que **no existe ese día de la semana**, **Entonces** se rechaza con un mensaje claro.
4. **Dado** una hora de llegada **fuera de la ventana** del servicio elegido, **Entonces** se rechaza («Ese horario está fuera de \<servicio\>»).

---

### User Story 4 - El cupo se respeta al editar (Priority: P1)

Como club, mover o agrandar una reserva no puede ser la puerta de atrás que esquiva el cupo del servicio.

**Independent Test**: Con un servicio al límite de cubiertos, agrandar una reserva de 2 a 8 y verificar que pide confirmación de sobrecupo.

**Acceptance Scenarios**:

1. **Dado** el modo flexible, **Cuando** la edición deja el servicio por encima del cupo (cubiertos o mesas, specs 077/081), **Entonces** se avisa y **sólo pasa con confirmación explícita** del encargado (`allow_overbook`) — mismo trato blando que al crear.
2. **Dado** el cálculo de cupo de la edición, **Entonces** la reserva editada **se excluye del conteo previo** (sus 4 cubiertos viejos no se suman a los 6 nuevos).
3. **Dado** el modo estricto y un `party_size` mayor a los asientos de la mesa, **Entonces** se rechaza con la capacidad concreta de esa mesa.
4. **Dado** cualquier modo, **Cuando** `party_size` supera el `max_party_size` del negocio, **Entonces** se rechaza.

---

### User Story 5 - Sólo el que puede, y sólo lo que está vivo (Priority: P1)

**Acceptance Scenarios**:

1. **Dado** un usuario sin permiso de gestión de reservas, **Entonces** la edición se rechaza (`canManageReservations`, spec 22).
2. **Dado** una reserva de **otro negocio**, **Entonces** no se encuentra (scope por `business_id`).
3. **Dado** una reserva `seated`, `completed`, `no_show` o `cancelled`, **Entonces** no se edita.
4. **Dado** una mesa de **otro negocio** o deshabilitada, **Entonces** se rechaza.

## Requisitos

- **RF-01** — `updateReservationDetails` acepta, además de mesa y comensales: `time` ("HH:MM" local) y, en flexible, `service` y `allow_overbook`. Todos opcionales: lo que no viene, no se toca. Los llamadores actuales (asignar mesa arrastrando en el plano, `salon-desktop.tsx`) siguen andando sin cambios.
- **RF-02** — `table_id` pasa a ser **nullable**. `null` sólo es válido en modo flexible.
- **RF-03** — La fecha de la reserva **no cambia**: la nueva hora se interpreta en el día local que la reserva ya tiene, en la timezone del negocio.
- **RF-04** — La fuente de verdad del solape sigue siendo la base (`reservations_no_overlap`, GIST). El pre-chequeo en la action es para dar un mensaje bueno; el `23P01` se sigue atrapando y traduciendo.
- **RF-05** — Toda la validación cruzada corre contra los valores **nuevos** (mesa nueva × comensales nuevos × ventana nueva), no contra los guardados.
- **RF-06** — La edición se excluye a sí misma de solape y de cupo.

## Notas de implementación

- **Estricto**: ventana = `[hora, hora + slot_duration_min)`; solape vía `isTableAvailableForReservation` con `buffer_min` y `excludeReservationId`.
- **Flexible**: ventana = `flexibleServiceWindow(fecha, servicio, tz)`; regla dura **una reserva viva por (mesa, servicio)**; cupo vía `getFlexibleAvailability` con la reserva excluida.
- El día local del servicio se deriva de `starts_at`. Para servicios que cruzan la medianoche (cena 20:00 → 00:30) el `starts_at` de las 00:15 pertenece al servicio del **día anterior**: se resuelve con un helper puro y testeado (`serviceDateForStart`), no a ojo. `golf-jcr` hoy no tiene servicios así, pero el motor los soporta desde la 059.
- UI: el panel inline de `admin-day-list.tsx` se vuelve mode-aware (la página le pasa `mode` + servicios del día).

## Verify

- `pnpm typecheck` + `pnpm test` en verde.
- Tests unitarios de la lógica pura nueva (resolución de fecha de servicio, ventana resultante por modo).
- Verificación en vivo con el **rol real** (encargado de `golf-jcr`), no service_role.
