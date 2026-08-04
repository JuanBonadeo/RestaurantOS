# Feature Specification: Reservas flexibles — cupo real para el cliente, override del encargado

**Feature Branch**: `077-reservas-cupo-real`

**Created**: 2026-08-04

**Status**: 📝 Spec aprobada (decisiones tomadas por Juan el 2026-08-04) — lista para implementar.

**Input**: Sesión con Juan (2026-08-04). Disparador: auditando el motor de reservas se detectó que en modo `flexible` **el cliente web nunca recibe un "no"**. `reservar-flow.tsx` arma los horarios con `arrivalSlots()` y sólo filtra los que ya pasaron: nunca consulta `fetchFlexibleAvailability`. Juan: *"habría que restringir el hecho de las reservas que no sea tan flexible"*.

**Issue**: [#118](https://github.com/gachetponzellini/RestaurantOS-app/issues/118) — milestone Post-demo · Growth & hardening.

**Depende de**: [`059-reservas-modo-flexible`](../059-reservas-modo-flexible/spec.md) (motor flexible, `reservation_services`, `soft_capacity`).

## Contexto y problema

La spec 059 diseñó la capacidad del modo flexible como **blanda a propósito**: el libro del Golf lleva el total de cubiertos a mano y usa lista de espera para el overflow, así que `soft_capacity` avisa pero no bloquea (FR-015). Con el piloto encima, esa decisión tiene tres consecuencias que hoy están vivas en `golf-jcr` (modo `flexible`, Almuerzo 12:00–14:30 y Cena 20:00–22:30, `soft_capacity` = 100 cubiertos por servicio y zona):

1. **La web no tiene freno.** [`reservar-flow.tsx:197`](../../src/components/reservations/reservar-flow.tsx) calcula los horarios de llegada con `arrivalSlots()` (pasos de 15 min sobre la ventana del servicio) y el único filtro es "que no haya pasado". Nunca llama a `fetchFlexibleAvailability`. Un cliente puede reservar la cena de un sábado con el salón entero comprometido.
2. **El server tampoco.** [`createFlexibleReservation`](../../src/lib/reservations/booking-actions.ts) valida `max_party_size`, servicio del día, hora no pasada y — sólo si se pidió mesa puntual — que la mesa exista, entre el party y esté libre. Una reserva **genérica** (el caso del cliente web, que nunca elige mesa) **no tiene ningún tope**: `computeFlexibleAvailability` devuelve `available: true` siempre para genéricas, por diseño de 059.
3. **La capacidad configurada no se usa contra nadie.** `soft_capacity` sólo alimenta el cartelito del modal del encargado (`X/100 cubiertos reservados — te pasás del cupo (igual podés reservar)`).

El resultado operativo es overbooking silencioso: el local se entera cuando la gente llega.

Esta spec **no revierte** 059 — la mesa sigue sin rotar y las reservas genéricas siguen existiendo. Lo que cambia es **quién puede pasarse del cupo**: el cliente final no, el encargado sí (con aviso). Es el principio del producto *"el local manda"* aplicado a la capacidad.

**Regla de oro**: *el cupo es duro para el cliente y blando para el encargado.*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El cliente deja de recibir cupo cuando el servicio está lleno (Priority: P1)

Como cliente de un negocio flexible, cuando el servicio que elijo ya no tiene lugar, la web me lo dice **antes** de cargar mis datos, y si igual intento confirmar el server me rechaza.

**Why this priority**: Es el agujero. Sin esto la config de capacidad no restringe nada.

**Independent Test**: En `golf-jcr`, bajar el cupo de la Cena a 4 cubiertos, cargar una reserva de 4 y verificar que la web ya no ofrece esa cena (ni por horario de llegada), y que un POST directo a `createFlexibleReservation` con `source: "web"` se rechaza.

**Acceptance Scenarios**:

1. **Dado** un servicio cuyos cubiertos reservados + mi party superan el cupo configurado, **Cuando** elijo ese servicio en `/reservar`, **Entonces** no se me ofrecen horarios y veo *"No quedan lugares para ese servicio"* con la sugerencia de probar otra fecha, otro servicio u otro salón.
2. **Dado** un servicio sin ninguna mesa activa libre que entre mi party (todas las mesas del servicio ya están reservadas, o ninguna tiene asientos suficientes), **Cuando** elijo ese servicio, **Entonces** tampoco se me ofrece — aunque el cupo de cubiertos no esté agotado.
3. **Dado** que el cupo se agota **entre** que cargué la pantalla y confirmo, **Cuando** confirmo, **Entonces** el server rechaza con un mensaje claro y la pantalla se re-consulta.
4. **Dado** un servicio con lugar, **Cuando** lo elijo, **Entonces** el flujo actual no cambia en nada (mismos horarios de llegada cada 15 min, mismo formulario).
5. **Dado** un servicio **sin cupo configurado** (`soft_capacity` nulo), **Cuando** reservo, **Entonces** el único tope es el de mesas libres (Escenario 2).

---

### User Story 2 - El encargado puede pasarse del cupo, con aviso explícito (Priority: P1)

Como encargado, cuando el servicio está lleno **igual puedo** cargar la reserva (llamó un socio, entra igual), pero el sistema me lo avisa y tengo que confirmarlo a propósito — no se me escapa por descuido.

**Why this priority**: Sin el override, el tope duro le saca al mostrador la flexibilidad que el libro real necesita. Va junto con US1: son la misma decisión.

**Independent Test**: Con el servicio lleno, abrir "+ Nueva reserva" en el admin, verificar que aparece el aviso de sobre-cupo y que la reserva sólo se guarda tras confirmar el override.

**Acceptance Scenarios**:

1. **Dado** un servicio lleno (por cubiertos o por mesas), **Cuando** el encargado carga una reserva, **Entonces** ve el aviso de que se pasa del cupo y **puede confirmar igual**.
2. **Dado** que el encargado confirma el override, **Cuando** se guarda, **Entonces** la reserva queda normal (no hay estado "en overflow"; la lista de espera sigue fuera de alcance).
3. **Dado** que el encargado **no** confirma el override, **Cuando** intenta guardar sobre un servicio lleno, **Entonces** el server rechaza (el aviso no es sólo cosmético).
4. **Dado** un servicio con lugar, **Cuando** el encargado carga una reserva, **Entonces** no hay fricción nueva: ni aviso ni confirmación extra.
5. **Dado** una **mesa puntual ocupada** en ese servicio, **Cuando** el encargado la elige, **Entonces** se sigue rechazando como hoy — el override es sobre el **cupo**, nunca sobre la regla una-reserva-por-mesa/servicio (la garantiza el GIST).

---

### User Story 3 - El chatbot respeta el modo y el cupo (Priority: P2)

Como negocio flexible, el chatbot de WhatsApp no puede ser la puerta de atrás: hoy `chatbot-actions.ts` usa el motor **estricto** (`computeAvailableSlots` + `pickTable` + ventana de 90 min) sin mirar `settings.mode`. Contra `golf-jcr` ofrece los slots viejos que quedaron en `schedule` (13:00 y 21:00) y crea reservas con un modelo que el local no usa.

**Why this priority**: Es un agujero real, pero el volumen de reservas por bot hoy es marginal frente a la web, y arreglarlo toca las tools del agente (superficie distinta). Se hace inmediatamente después de US1/US2.

**Independent Test**: Con `golf-jcr` en flexible, pedirle al bot disponibilidad y verificar que responde por servicios (Almuerzo/Cena) y no por slots, y que una reserva creada por el bot pasa por `createFlexibleReservation` con el mismo tope que la web.

**Acceptance Scenarios**:

1. **Dado** un negocio en flexible, **Cuando** el bot consulta disponibilidad, **Entonces** razona por servicios y cupo, no por la grilla de `schedule`.
2. **Dado** un servicio lleno, **Cuando** el cliente insiste por el bot, **Entonces** el bot no puede crear la reserva (mismo rechazo que la web; `source: "chatbot"` no tiene override).
3. **Dado** un negocio en estricto, **Cuando** el bot opera, **Entonces** se comporta exactamente como hoy — cero regresión.

### Edge Cases

- **Cupo por zona vs. por servicio**: en `golf-jcr` los servicios están configurados **por zona** (Salón principal y Terraza, 100 cada uno). El tope se evalúa **contra la zona elegida**; si el cliente no eligió salón, la pantalla ya lo obliga antes (`PickSalonHint`).
- **Race de cupo**: dos clientes confirmando a la vez pueden empujar los cubiertos un party por encima del tope. La integridad de **mesa** la sigue garantizando el GIST; la de **cubiertos** es best-effort en el server (mismo criterio que el pre-check de `pickTable`). Asumido: un desborde de un party en el borde es operativamente inocuo y no justifica un lock por servicio.
- **Reservas ya cargadas por encima del cupo**: al activar el tope, un servicio que ya está sobre-vendido simplemente deja de ofrecerse al cliente; las reservas existentes no se tocan.
- **Mesas de barra**: siguen fuera del motor (spec 08); no cuentan como mesas libres.
- **Sentar walk-ins**: no consume cupo de reservas. El tope es sobre reservas vivas del servicio, no sobre ocupación real del salón.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El motor flexible DEBE poder evaluar la disponibilidad **en modo cliente** (tope duro) o **en modo encargado** (advisory), sobre la misma función pura — sin duplicar la regla por canal.
- **FR-002**: En modo cliente, un servicio NO DEBE ofrecerse cuando `cubiertos reservados + party > cupo` del servicio/zona.
- **FR-003**: En modo cliente, un servicio NO DEBE ofrecerse cuando no queda **ninguna mesa activa libre** en ese servicio/zona con asientos suficientes para el party. Los dos topes conviven: **corta el que se agote primero**.
- **FR-004**: Un servicio **sin cupo configurado** (`soft_capacity` nulo) DEBE seguir limitado por mesas libres (FR-003); la ausencia de umbral no significa "infinito".
- **FR-005**: `createFlexibleReservation` DEBE aplicar FR-002/FR-003 cuando `source` es `web` o `chatbot`, con mensajes de error distinguibles ("no quedan lugares" vs. "la mesa ya está reservada").
- **FR-006**: `createFlexibleReservation` con `source: "admin"` DEBE aceptar un flag explícito de override; sin el flag, un servicio lleno se rechaza igual que para el cliente. El flag NO DEBE poder llegar desde los canales de cliente.
- **FR-007**: El override NUNCA DEBE saltear la regla una-reserva-por-(mesa, servicio, fecha) ni el GIST. Es exclusivamente sobre el cupo.
- **FR-008**: `fetchFlexibleAvailability` DEBE exponer el veredicto de cliente (`available` + motivo) además de los datos advisory que ya devuelve (`reservedCovers`, `softCapacity`, `overCapacity`, `freeTables`).
- **FR-009**: El flujo cliente `/reservar` DEBE consultar disponibilidad al cambiar fecha, servicio, salón o cantidad de personas, y DEBE ocultar los horarios de llegada de un servicio sin lugar, mostrando el motivo.
- **FR-010**: El modal del encargado DEBE mostrar el aviso de sobre-cupo (ya existe para cubiertos) extendido a "no quedan mesas libres", y DEBE pedir confirmación explícita antes de mandar el override.
- **FR-011**: El modo `estricto` NO DEBE cambiar en nada (motor, mensajes, tests). Cero regresión.
- **FR-012** *(US3)*: Las tools de reservas del chatbot DEBEN despachar por `settings.mode` y, en flexible, usar el motor flexible con el mismo tope que la web.

### Non-Goals

- **Lista de espera** para el overflow (sigue siendo futuro, como en 059).
- **Cupo por franja horaria** dentro del servicio (ej. 20 cubiertos por cada 15 min). El cupo es por servicio/zona.
- **Última llegada configurable** (cerrar la ventana antes del cierre del servicio): **descartado explícitamente** por Juan — se sigue pudiendo llegar en toda la ventana.
- **Tope duro para el encargado**: por decisión de producto el mostrador siempre puede pasarse.
- **Cupo en modo estricto**: el estricto ya está limitado por mesas y slots; no se toca.
- **Lock transaccional de cubiertos** (ver Edge Cases).

### Key Entities

- **`reservation_services`** (existe, migración 0022): `soft_capacity` pasa a ser **el cupo** — duro para el cliente, advisory para el encargado. **No se agrega columna nueva**: un solo número que el negocio configura y entiende, con semántica distinta por canal. La UI de config debe llamarlo "cupo de cubiertos" y aclarar la asimetría.
- **`reservations`** (existe): sin cambios de schema. El cupo se calcula sobre las reservas vivas del servicio (`confirmed`/`seated`), como ya hace `reservedCovers`.

## Success Criteria *(mandatory)*

- **SC-001**: Con el cupo agotado, la web no ofrece horarios de ese servicio y el server rechaza la creación por `web`/`chatbot`.
- **SC-002**: Con todas las mesas del servicio reservadas (o ninguna que entre el party), pasa lo mismo aunque sobren cubiertos de cupo.
- **SC-003**: El encargado puede cargar la misma reserva rechazada al cliente, viendo el aviso y confirmando el override; sin confirmar, se rechaza.
- **SC-004**: Una mesa puntual ya reservada en ese servicio se sigue rechazando incluso con override.
- **SC-005**: Un negocio en `estricto` no cambia: suite existente en verde sin modificar tests.
- **SC-006**: `pnpm typecheck` + `pnpm test` + `pnpm build` en verde; la lógica nueva del motor (tope por cubiertos, tope por mesas, asimetría cliente/encargado) cubierta por unit tests TDD; verificado en vivo con el rol real (encargado de `golf-jcr`).

## Assumptions

- `soft_capacity` está configurado con intención (100 en `golf-jcr`) y alcanza como único número de cupo; no hace falta un segundo umbral duro.
- El cliente web siempre elige salón cuando el negocio tiene más de uno, así que evaluar el cupo por zona es determinista.
- Un desborde de un party por carrera concurrente es aceptable (ver Edge Cases).
- El chatbot (US3) puede migrarse sin tocar el prompt del agente, sólo el dispatch de sus tools; si resulta que no, se separa en spec propia.
