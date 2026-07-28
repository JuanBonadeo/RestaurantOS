# Feature Specification: Reservas — modo flexible ("libro de reservas") con flag por negocio

**Feature Branch**: `059-reservas-modo-flexible`

**Created**: 2026-07-28

**Status**: 🚧 **En progreso (2026-07-28)** — Juan aprobó implementar. **P1 (fundaciones) hecho y commiteado**: motor de disponibilidad flexible puro + 20 tests verdes (`81d764a`) + migración `0022` **aplicada al cloud**. Clarifications #1/#3/#5 **resueltas** (abajo). **Hecho también**: server completo (`createFlexibleReservation`, `getFlexibleAvailability`, `setReservationMode` + CRUD `reservation_services`, sentar genérico), config UI (toggle de modo + editor de servicios) y **modal del encargado mode-aware**. `typecheck` + 61 tests + `build` **verdes**. **Pendiente**: flujo cliente web `/reservar` en flexible, totales de cubiertos en el panel admin, P3 (no-show relacional, chatbot), verify en vivo con rol real. Milestone: Post-demo · Growth & hardening.

> **Nota de ejecución (2026-07-28):** se avanza por commits chicos en `master` (el árbol del submódulo lo comparten sesiones paralelas que hacen `git clean`; commitear blinda el trabajo). La **aplicación de la migración al cloud + regen de `database.types.ts`** se difiere hasta que baje el churn paralelo (ese archivo lo están reescribiendo otras sesiones).

**Input**: Sesión de diseño con Juan (2026-07-23). Disparador: *"el sistema de reservas que planteamos no tiene sentido, porque nunca vas a poder echar a un comensal de la mesa para que otro ocupe el turno"*. Se descartó primero el modelo actual (mesa pre-asignada + slots de 90 min) y después la alternativa de turnos+cupos rígidos (*"algo más flexible, que no sean tan rígidos los turnos"*). Se acordó: **flag de modo por negocio** (`estricto` = lo actual, se conserva / `flexible` = libro de reservas nuevo), **una reserva por mesa por servicio**, **la hora ancla el bloqueo de la mesa**, y **seguir soportando el modelo estricto** (multi-tenant). Validado contra el **libro real** del Golf (`REGISTRO DE RESERVAS GOLF.xlsx`).

**Issue**: _pendiente de crear_ (GitHub MCP sin autorizar en esta sesión; crear con `gh issue create` antes de implementar).

**Diseño / contexto**: [`wiki/analyses/reservas-rediseno-modelo-flexible.md`](../../../../wiki/analyses/reservas-rediseno-modelo-flexible.md) · relevamiento del encargado + del Excel.

## Contexto y problema

Hoy el módulo de reservas ([`src/lib/reservations`](../../src/lib/reservations)) tiene **un solo modelo**, implementado y testeado (specs [02](../../../../wiki/specs/02-reservas-asignacion-mesa/) y [22](../../../../wiki/specs/22-reservas-deuda-y-permisos/)):

- Al reservar, `pickTable`/`assignTable` **ata la reserva a una mesa puntual** en una **ventana de `slot_duration_min` (90 min)**.
- El exclusion constraint GIST `reservations_no_overlap` garantiza que dos reservas vivas no se pisen en la misma mesa/ventana.
- El cliente elige entre **slots fijos por día** (`reservation_settings.schedule`).

Ese modelo **asume que la mesa rota dentro del servicio** (la reserva de 20:00 libera a las 21:30 para la siguiente). En un **club con socios** (golf-house) esa rotación **no se puede forzar**: no echás a un comensal. Resultado: la mesa sigue ocupada y la reserva no se cumple.

El **libro real** (Excel del Golf) confirma cómo operan de verdad: una **grilla de mesas físicas** por **día de semana**, partida en **servicios** (MEDIODÍA / CENA) y **zonas** (ADENTRO / AFUERA / BAR); **una reserva por mesa**; **hora opcional** pero buscada; **total de cubiertos a mano** (capacidad blanda); **lista de espera** para el overflow; y *"si se cancela, marcar CANCELADA — NO BORRAR"*.

Como RestaurantOS es **multi-tenant**, no se reemplaza un modelo por otro: se agrega un **modo de reservas por negocio**. El modo `estricto` es exactamente lo que ya existe (se conserva para negocios de alta rotación). El modo `flexible` es el libro de reservas nuevo. Esta feature **construye el modo flexible + el switch**, sin cambiar el comportamiento del estricto.

**Regla de oro del flexible** (lo que mata el desalojo): *una reserva por (mesa, servicio, fecha); la mesa nunca se promete dos veces en el mismo servicio.*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Elegir el modo de reservas por negocio, sin regresión del estricto (Priority: P1)

Como negocio, puedo operar en modo `estricto` (lo actual) o `flexible` (nuevo). Un negocio en `estricto` **no cambia en nada**; un negocio en `flexible` usa el motor nuevo. El modo es una config del negocio.

**Why this priority**: Es el espinazo arquitectónico y la garantía de no romper lo que ya anda (specs 02/22, golf-jcr y demás negocios). Sin el switch no hay nada.

**Independent Test**: Con un negocio en `estricto`, correr el flujo actual de reserva web/chatbot/admin y verificar que se comporta idéntico a hoy (slots + pickTable + GIST). Cambiar el flag a `flexible` y verificar que el motor cambia de rama.

**Acceptance Scenarios**:

1. **Dado** un negocio sin config de modo, **Cuando** se lee `reservation_settings`, **Entonces** el modo por defecto es `estricto` (los negocios existentes siguen igual, cero migración de comportamiento).
2. **Dado** un negocio en `estricto`, **Cuando** un cliente reserva por web/chatbot/admin, **Entonces** corre el pipeline actual (slots fijos → `pickTable` → insert con GIST) **sin cambios observables**.
3. **Dado** un negocio en `flexible`, **Cuando** un cliente/encargado reserva, **Entonces** corre el motor flexible (US2), no el de slots.
4. **Dado** un admin con permiso de configurar reservas, **Cuando** entra a la config de reservas, **Entonces** puede ver/cambiar el modo del negocio; el mozo/personal no.

---

### User Story 2 - Reservar en modo flexible sin prometer rotación (Priority: P1)

Como encargado (o cliente/chatbot) de un negocio flexible, tomo una reserva con **cliente + personas + fecha + servicio + hora opcional + mesa opcional + notas**. Si nombro una mesa, esa mesa **no se puede volver a reservar** ese servicio; queda tomada **desde la hora hasta el cierre del servicio**. Si no nombro mesa, la reserva es **genérica** y se sienta al llegar (US4).

**Why this priority**: Es el corazón de la feature — la reserva que **no genera desalojo**. Resuelve el problema que disparó todo.

**Independent Test**: En un negocio flexible, crear una reserva con mesa T1 para la cena; intentar crear una segunda reserva sobre T1 esa misma cena y verificar que se rechaza; crear una reserva genérica (sin mesa) para la misma cena y verificar que se acepta.

**Acceptance Scenarios**:

1. **Dado** un negocio flexible, **Cuando** creo una reserva para un servicio con una mesa libre, **Entonces** se guarda atada a esa mesa y esa mesa queda ocupada para ese servicio/fecha.
2. **Dado** una mesa ya reservada en un servicio/fecha, **Cuando** intento crear otra reserva sobre la **misma** mesa en el **mismo** servicio/fecha (a cualquier hora), **Entonces** se rechaza con un error claro ("La mesa ya está reservada en ese servicio").
3. **Dado** una reserva con mesa y hora (ej. T1, 21:00), **Cuando** miro la disponibilidad de esa mesa, **Entonces** figura **libre antes de las 21:00** para uso operativo (US4) pero **no reservable** de nuevo ese servicio.
4. **Dado** que quiero reservar sin atar mesa, **Cuando** creo una reserva **genérica** (solo personas + servicio + hora opcional), **Entonces** se acepta sin `table_id` y no bloquea ninguna mesa.
5. **Dado** que cancelo una reserva, **Cuando** cambia a `cancelled`, **Entonces** la fila **se conserva** (soft-delete, no se borra) y la mesa se libera para ese servicio.
6. **Dado** una reserva **sin hora** (solo "cena"), **Cuando** se guarda, **Entonces** es válida (la hora es opcional en flexible; se usa el inicio del servicio para orden/recordatorios).

---

### User Story 3 - Zonas + capacidad blanda por servicio (Priority: P2)

Como encargado, veo el conteo de **cubiertos reservados por servicio y zona** (ADENTRO / AFUERA / BAR) y el sistema me **avisa** si me paso de un umbral configurado — pero **no me bloquea** (la capacidad es blanda, como el total a mano del libro).

**Why this priority**: golf-house lo usa (totales por zona en el libro), pero el core no-desalojo (US2) funciona sin esto. Increment sobre US2.

**Independent Test**: Configurar un umbral de cubiertos para la cena adentro; cargar reservas hasta pasarlo; verificar que aparece el aviso pero que se puede **seguir reservando** igual.

**Acceptance Scenarios**:

1. **Dado** un negocio flexible con zonas, **Cuando** creo/edito una reserva, **Entonces** puedo asignarle una **zona** (además de, o en vez de, una mesa puntual).
2. **Dado** reservas cargadas en un servicio/zona/fecha, **Cuando** miro el panel, **Entonces** veo el **total de cubiertos** reservado de ese servicio/zona.
3. **Dado** un umbral de capacidad configurado, **Cuando** el total lo supera, **Entonces** se muestra un **aviso** (no un bloqueo); la reserva se puede confirmar igual.
4. **Dado** un negocio flexible **sin** zonas configuradas, **Cuando** opero, **Entonces** todo funciona con una zona implícita única (las zonas son opcionales).

---

### User Story 4 - Sentar al llegar (operación) (Priority: P2)

Como encargado/mozo, cuando el cliente llega **siento la reserva**: si es genérica, elijo cualquier mesa libre; si tiene mesa, abro esa mesa. Antes de la hora reservada, la mesa figura **usable** para sentar un walk-in a criterio.

**Why this priority**: Cierra el ciclo operativo del flexible reutilizando lo que ya existe (`sentarReserva`/`openTable`). Depende de US2.

**Independent Test**: Sentar una reserva genérica en una mesa libre y verificar que se abre la cuenta en esa mesa con `table_id` seteado y estado `seated`; sentar una reserva con mesa y verificar que abre en su mesa.

**Acceptance Scenarios**:

1. **Dado** una reserva **genérica** confirmada, **Cuando** el encargado la sienta eligiendo una mesa libre, **Entonces** se setea `table_id`, pasa a `seated` y se abre la cuenta (reusa `openTable`).
2. **Dado** una reserva **con mesa**, **Cuando** la siento, **Entonces** abre en **su** mesa.
3. **Dado** una mesa reservada a las 21:00, **Cuando** son las 20:15, **Entonces** el encargado **puede** sentar un walk-in en esa mesa (figura usable antes de la hora); el sistema no lo impide, pero tampoco ofrece esa mesa a otra **reserva** del servicio. *(Comportamiento sujeto a `[NEEDS CLARIFICATION: usable-antes-de-la-hora]`.)*

---

### User Story 5 - Confirmación y no-show relacional (Priority: P3)

Como encargado, marco reservas como **confirmadas** y manejo el no-show de forma **relacional**: pasado un margen (ej. 15 min) la reserva queda "por confirmar" para que **yo** llame y decida — nada la larga automáticamente sin criterio.

**Why this priority**: Alinea con la práctica real (llaman a los 15 min), pero es refinamiento sobre el ciclo básico. El auto-`no_show` duro del estricto **no** aplica igual acá.

**Independent Test**: Con una reserva flexible vencida por el margen, verificar que queda señalada "por confirmar" y que **no** se marca `no_show` automáticamente liberando la mesa sin acción del encargado (o que la gracia es configurable y, en flexible, por defecto no auto-libera).

**Acceptance Scenarios**:

1. **Dado** una reserva flexible, **Cuando** el encargado la confirma, **Entonces** se registra el estado de confirmación (reusa `client_confirmed_at`).
2. **Dado** una reserva cuya hora + margen ya pasó, **Cuando** corre el job de vencidas, **Entonces** en modo flexible **no** se auto-marca `no_show` liberando sin criterio (a diferencia del estricto); se señala como "por confirmar / demorada" para acción manual. *(Sujeto a `[NEEDS CLARIFICATION: gracia-flexible]`.)*
3. **Dado** una reserva demorada, **Cuando** el encargado decide, **Entonces** puede marcarla `seated`, `no_show` o `cancelled` a mano.

### Edge Cases

- **Cambio de modo con reservas vivas**: si un negocio pasa de estricto→flexible (o viceversa) con reservas futuras cargadas, esas reservas **existentes** deben seguir siendo legibles y gestionables; no se re-interpretan retroactivamente. (Se recomienda cambiar de modo sin reservas futuras; documentar.)
- **Reserva genérica que nunca se sienta**: cuenta para capacidad blanda hasta su servicio; el cierre/limpieza no debe romper reportes.
- **Concurrencia sobre la última mesa**: dos encargados reservan la misma mesa/servicio a la vez → uno gana, el otro recibe el error de "ya reservada" (la integridad la garantiza la base, no la UI).
- **Mesa de barra (`is_bar`)**: hoy queda fuera del motor de reservas (spec 08). En flexible, si el Golf reserva en el BAR, revisar si la zona BAR entra al motor o sigue afuera. *(`[NEEDS CLARIFICATION: bar-reservable]`.)*
- **Hora en bandas (franjas)**: el domingo el libro usa "12,30/13" y "13,30/14". La hora puede expresarse como banda; tratarla como hora de llegada sugerida, no como sub-cupo rígido.

## Requirements *(mandatory)*

### Functional Requirements

**Modo por negocio (US1)**

- **FR-001**: `reservation_settings` DEBE tener un **modo** de reservas por negocio con valores `estricto | flexible`, **default `estricto`** (los negocios existentes no cambian de comportamiento).
- **FR-002**: En modo `estricto`, el motor de disponibilidad y el booking DEBEN comportarse **idénticamente a hoy** (slots fijos + `pickTable`/`assignTable` + GIST). Cero regresión.
- **FR-003**: En modo `flexible`, el booking y la disponibilidad DEBEN usar el motor nuevo (US2/US3), no los slots ni `pickTable`.
- **FR-004**: Los **tres canales** (web `fetchAvailability`, chatbot, admin) DEBEN respetar el modo del negocio (dispatch único, no rama copiada por canal — mantener la consolidación de spec 22).
- **FR-005**: Configurar el modo DEBE requerir permiso `canConfigureReservations` (admin/encargado); el mozo/personal no.

**Reserva flexible (US2)**

- **FR-006**: En flexible, una reserva DEBE aceptar **mesa opcional** (`table_id` nullable, ya lo es) y **hora opcional**, con **servicio** (ej. mediodía/cena) y **fecha** siempre presentes.
- **FR-007**: En flexible, DEBE garantizarse **como máximo una reserva viva por (mesa, servicio, fecha)** — nunca dos sobre la misma mesa en el mismo servicio, a ninguna hora. La garantía DEBE ser **a nivel base de datos** (no sólo UI).
- **FR-008**: Una reserva con mesa DEBE bloquear esa mesa **desde su hora hasta el cierre del servicio**; antes de esa hora la mesa NO DEBE ofrecerse a otra **reserva** del servicio, pero SÍ puede usarse operativamente (US4). *(Ver `[NEEDS CLARIFICATION: usable-antes-de-la-hora]`.)*
- **FR-009**: Una reserva **genérica** (sin mesa) DEBE aceptarse sin bloquear ninguna mesa; su `table_id` se setea recién al **sentarla** (US4).
- **FR-010**: La disponibilidad en flexible DEBE calcularse como *"¿esta mesa está libre este servicio?"* (para mesa puntual) y/o *"¿hay lugar en el servicio/zona?"* (genérica), **no** como grilla de slots de 90 min.
- **FR-011**: Cancelar una reserva NUNCA DEBE borrar la fila: cambia a `cancelled` (soft-delete) y libera la mesa para ese servicio.
- **FR-012**: La regla de "hora opcional" NO DEBE romper recordatorios ni orden: sin hora, se usa el inicio del servicio como referencia.

**Zonas y capacidad blanda (US3)**

- **FR-013**: En flexible, una reserva DEBE poder asociarse a una **zona/salón** (reusar `floor_plans`), además de o en vez de una mesa puntual. Las zonas son **opcionales** (negocio sin zonas = zona única implícita).
- **FR-014**: El sistema DEBE mostrar el **total de cubiertos reservados** por (servicio, zona, fecha).
- **FR-015**: La capacidad DEBE ser **blanda**: un umbral configurable por (servicio[, zona]) que, al superarse, **avisa** pero **no bloquea** la reserva. Tope duro = fuera de alcance (futuro, para eventos).

**Operación / sentar (US4)**

- **FR-016**: Sentar una reserva flexible DEBE reutilizar el flujo actual (`sentarReserva`/`openTable`): setear `table_id` (si genérica), pasar a `seated` y abrir la cuenta.
- **FR-017**: Los permisos de gestión operativa DEBEN reutilizar `can.ts` (`canManageReservations` = admin/encargado/mozo; `canSeatReservation`). Sin duplicar lógica.

**Confirmación / no-show (US5)**

- **FR-018**: DEBE registrarse el **estado de confirmación** de una reserva (reusar `client_confirmed_at`).
- **FR-019**: En flexible, el auto-cierre a `no_show` NO DEBE liberar la mesa automáticamente sin criterio del encargado; la reserva vencida se **señala** para acción manual. La gracia DEBE ser configurable. *(Ver `[NEEDS CLARIFICATION: gracia-flexible]`.)*

**Sin regresión (todas)**

- **FR-020**: Negocios en `estricto` (incl. los actuales y golf-jcr) NO DEBEN sufrir ningún cambio de comportamiento, datos ni RLS por esta feature.

### Non-Goals (fuera de alcance de esta spec — fases siguientes / specs futuras)

- **Reservas recurrentes** (mesa fija por día de semana para un socio; "mesa 6 los martes"). Es el uso central del libro, pero se modela **aparte** (plantilla + generador) en una spec siguiente. Esta spec deja el modelo de datos **listo para** recurrentes, no las implementa.
- **Mesas combinables (N:N)** — una reserva sobre varias mesas (grupo de 16 en 3 mesas). Futuro.
- **Lista de espera / "Extras / Excepciones / Espera"** (overflow del libro). Futuro.
- **Socio como entidad** (vincular reserva a un socio/miembro, flag socio/no-socio como dato de primera clase). Por ahora, `notes` o un flag simple; el modelo de socios es aparte.
- **Eventos / grupos grandes en fechas puntuales** (bodas, cumpleaños de 49 pax, "Día de la Madre") — el libro los maneja en una lista aparte (FECHAS PROXIMAS); posible **flujo evento** propio. Futuro.
- **Atributos de mesa** ("ventana", "redonda") como metadato buscable/filtrable. Futuro (hoy `notes`).
- **Tope duro de capacidad / cupos** (turnos estrictos con límite). El modo `estricto` cubre el caso rígido; el flexible es blando por diseño.
- **Cambiar el modo `estricto`**: se conserva tal cual; esta spec no lo refactoriza.

### Key Entities

- **`reservation_settings`** (existe): suma **`mode`** (`estricto|flexible`, default `estricto`). En flexible, suma la definición de **servicios** (ej. mediodía/cena con apertura/cierre por día) y, opcional, **franjas de llegada** y **umbrales de capacidad blanda** por (servicio[, zona]). *(Forma exacta — columna vs tabla nueva `reservation_services` / `reservation_capacity` — se decide en [`plan.md`](./plan.md).)*
- **`reservations`** (existe): en flexible usa `table_id` **nullable** (ya lo es), `starts_at` como hora **opcional** (referencia = inicio de servicio si no hay hora), y suma la noción de **servicio** y **zona/`floor_plan_id`** para las genéricas. `status` y `client_confirmed_at` se reutilizan. `ends_at` = **cierre del servicio** (clave para la integridad, ver plan).
- **`floor_plans` / `tables`** (existen): las **zonas** = floor_plans (ADENTRO/AFUERA/BAR); las mesas y capacidades ya están.
- **Integridad "una por mesa/servicio"**: se resuelve en base (opción preferida en el plan: reusar el GIST con `ends_at = cierre de servicio`, de modo que dos reservas en la misma mesa/servicio se solapen y la base rechace). Sin esto, un lock por `(business, table, service, date)` en la RPC.

## Success Criteria *(mandatory)*

- **SC-001**: Un negocio en `estricto` reserva por los 3 canales exactamente como hoy (verificado: mismos slots, misma asignación, mismo GIST) — **cero regresión**.
- **SC-002**: En un negocio `flexible`, dos reservas no pueden caer sobre la misma mesa en el mismo servicio/fecha (rechazo garantizado por la base), y una reserva genérica se acepta sin mesa.
- **SC-003**: Una mesa reservada figura **libre antes de su hora** para uso operativo y **no reservable** de nuevo ese servicio.
- **SC-004**: Cancelar conserva la fila (soft-delete) y libera la mesa del servicio.
- **SC-005**: El panel muestra el total de cubiertos por servicio/zona y **avisa sin bloquear** al pasar el umbral.
- **SC-006**: Sentar una reserva (genérica o con mesa) abre la cuenta reutilizando `openTable`, con permisos de `can.ts`.
- **SC-007**: `pnpm typecheck` + `pnpm test` + `pnpm build` en verde; lógica pura del motor flexible (disponibilidad por servicio, regla una-por-mesa/servicio, cómputo de cubiertos) cubierta por **unit tests** (TDD); verificado **en vivo con el rol real** (encargado de golf-house en modo flexible).

## Assumptions

- El modo por defecto `estricto` preserva a todos los negocios actuales sin migración de comportamiento (golf-jcr incluido).
- Reusar el GIST poniendo `ends_at = cierre del servicio` da la integridad "una por mesa/servicio" con cambio mínimo de DB (a validar en el plan; si no alcanza, lock en RPC).
- Las zonas se mapean a `floor_plans` (ya soportado, multi-salón); ADENTRO/AFUERA/BAR = 3 floor_plans del negocio.
- El "servicio" (mediodía/cena) se define por negocio con apertura/cierre; la hora de la reserva es opcional y, cuando falta, se ordena por inicio de servicio.
- La capacidad blanda es advisory: el negocio no quiere un bloqueo duro (el libro lleva el total a mano y usa lista de espera para el overflow).
- El chatbot de reservas (LangChain) puede necesitar ajustar sus tools para el modo flexible (disponibilidad por servicio en vez de slots); el alcance exacto del chatbot se afina en el plan.

## [NEEDS CLARIFICATION] — #1/#3/#5 resueltas (Juan, 2026-07-28); #2/#4 abiertas

1. **`usable-antes-de-la-hora`** — ✅ **RESUELTO: SÍ.** La mesa se puede usar operativamente **antes** de la hora reservada (criterio del encargado); el sistema no la ofrece a otra *reserva* del servicio, pero no impide sentar un walk-in. Ya reflejado en `isTableFreeForService` (bloquea la reserva, nunca la operación).
2. **códigos-del-libro** — significado de **"H-A" / "H-S"**, **"R"** suelta, **"-A"** en las notas del Excel (¿zona? ¿confirmada? ¿ratificada?). Preguntar al encargado. No bloquea el core.
3. **gracia-flexible** — ✅ **RESUELTO: señalar "demorada" sin auto-`no_show`** (relacional, como llaman a los 15 min). En flexible el job de vencidas NO auto-libera; marca para acción manual. (Se implementa en P3.) 
4. **bar-reservable** — ¿la zona BAR entra al motor de reservas en flexible, o sigue fuera como las mesas `is_bar` de spec 08?
5. **servicios-config** — ✅ **RESUELTO: tabla `reservation_services`** (configurable por negocio, por día de semana y por zona). Ya en la migración `0022`.
