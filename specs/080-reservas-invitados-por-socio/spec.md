# Feature Specification: Reservas — aviso de invitados por socio + registro por WhatsApp

**Feature Branch**: `080-reservas-invitados-por-socio`

**Created**: 2026-08-04

**Status**: ✅ Implementada (2026-08-04). **Ampliación del mismo día:** el registro de invitados es **sólo del servicio de la noche** — al mediodía cada socio se hace cargo de los suyos (Juan). Ver § Alcance por servicio.

**Input**: Juan, 2026-08-04: *"habría que aclarar, en la parte de reservas, que por cada socio solo puede haber dos invitados, que deben mandar el dni + nombre apellido al wsp del negocio, con un btn que lo lleve a wsp con el número configurado del club"*.

**Issue**: [#128](https://github.com/gachetponzellini/RestaurantOS-app/issues/128) · ampliación por servicio: [#130](https://github.com/gachetponzellini/RestaurantOS-app/issues/130).

**Relacionada**: [`077-reservas-cupo-real`](../077-reservas-cupo-real/spec.md) (cupo del modo flexible) · [`059-reservas-modo-flexible`](../059-reservas-modo-flexible/spec.md).

## Contexto y problema

El Golf es un **club**: quien reserva es un socio, y puede traer **hasta 2 invitados**, cuyos datos (**DNI + nombre y apellido**) el club necesita antes de la visita para el control de ingreso. Hoy nada de eso aparece en el flujo de reserva: el socio reserva para 4 personas sin enterarse de que tiene que registrar a los que no son socios, y el club se entera en la puerta.

No hay entidad **socio** en el sistema (la spec 059 la dejó explícitamente fuera de alcance), así que esto **no se valida ni se limita**: es un **aviso** con un camino de un toque para cumplirlo — un botón que abre WhatsApp contra el teléfono del negocio con el mensaje ya armado.

## Decisiones de producto (Juan, 2026-08-04)

| Pregunta | Decisión |
|---|---|
| ¿Dónde aparece? | En la **pantalla de reserva** y en la **confirmación**. No viaja en el mail/WhatsApp de confirmación. |
| ¿Configurable? | **No**: fijo en código para el club. Sin pantalla de config por ahora (se propuso configurable y se descartó por alcance). |
| ¿Qué número? | El **teléfono del negocio** (`businesses.phone`), que ya existe y ya alimenta el `wa.me` de la confirmación de pedidos. `golf-jcr` lo tiene cargado. |

Como el texto va fijo, la política se acota **por slug de negocio** en una constante del código: si apareciera en todos los negocios sería un bug de multi-tenancy (`demo` no tiene socios). Es deuda consciente y está anotada abajo.

## Alcance por servicio (ampliación, 2026-08-04)

Juan: *"las invitaciones de los socios serían solo para la noche, al mediodía se hace cargo cada socio"*. El aviso queda atado al **servicio**, no al negocio entero:

- **FR-008**: La política DEBE declarar en qué servicios aplica. En `golf-jcr`: sólo `Cena`.
- **FR-009**: Sin servicio elegido (todavía no lo eligió, o el negocio está en modo estricto y no tiene servicios) el aviso NO DEBE mostrarse: no sabemos si es la cena, y avisar de más en el almuerzo confunde.
- **FR-010**: La comparación del nombre del servicio DEBE ignorar mayúsculas y espacios — lo tipea el encargado en la config.
- En la pantalla de reserva el aviso se movió de la sección "¿Cuántos son?" a **debajo del picker de servicio**, que es donde recién se sabe si es la cena. En la confirmación sale de `reservations.service`.
- **No se muestra nada en el almuerzo.** Si más adelante se quiere un texto ahí ("cada socio se hace cargo de sus invitados"), es otra vuelta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El socio se entera al reservar (Priority: P1)

Como socio del club, mientras armo la reserva veo cuántos invitados puedo traer y qué datos tengo que mandar.

**Independent Test**: Entrar a `/golf-jcr/reservar` y verificar que el aviso aparece cerca del selector de personas, con el límite y los datos pedidos.

**Acceptance Scenarios**:

1. **Dado** un negocio con política de invitados, **Cuando** entro a `/reservar`, **Entonces** veo el aviso: hasta 2 invitados por socio, y que hay que mandar DNI + nombre y apellido de cada uno.
2. **Dado** un negocio **sin** política (`demo` y cualquier otro), **Cuando** entro a `/reservar`, **Entonces** no aparece nada nuevo.
3. **Dado** el aviso visible, **Cuando** toco el botón de WhatsApp, **Entonces** se abre WhatsApp contra el teléfono del negocio con un mensaje ya escrito, listo para completar los datos.

---

### User Story 2 - El socio manda los datos después de reservar (Priority: P1)

Como socio que ya confirmó la reserva, tengo el aviso y el botón a mano en la pantalla de confirmación — que es el momento en que efectivamente voy a mandar los datos.

**Independent Test**: Confirmar una reserva en `golf-jcr` y verificar que la pantalla de confirmación muestra el aviso con el botón, y que el mensaje pre-armado incluye el día y la hora de esa reserva.

**Acceptance Scenarios**:

1. **Dado** una reserva confirmada, **Cuando** veo la confirmación, **Entonces** aparece el aviso con el botón de WhatsApp.
2. **Dado** que toco el botón desde la confirmación, **Entonces** el mensaje pre-armado **incluye el día y la hora** de esa reserva (para que el club sepa a qué reserva corresponden los invitados).
3. **Dado** una reserva **cancelada** o ya pasada (`completed` / `no_show`), **Cuando** veo la confirmación, **Entonces** el aviso **no** aparece (no hay invitados que registrar).

### Edge Cases

- **Negocio sin teléfono cargado** (`businesses.phone` nulo): se muestra el texto del aviso pero **no** el botón. Nunca un `wa.me` roto.
- **Teléfono con formato**: `+54 9 341 …` se normaliza a dígitos — `wa.me` no acepta `+`, espacios ni guiones.
- **Reserva de 1 persona**: el aviso se muestra igual (es informativo; el socio puede sumar invitados después llamando al club).
- **El aviso no valida nada**: alguien puede reservar para 8 y no mandar ningún dato. El control de ingreso sigue siendo del club.

## Requirements *(mandatory)*

- **FR-001**: La política de invitados (máximo por socio) DEBE estar definida en un único lugar del código, acotada a los negocios que la tienen. Un negocio sin política NO DEBE ver ningún cambio.
- **FR-002**: El aviso DEBE indicar el **máximo de invitados por socio** y los **datos requeridos** (DNI + nombre y apellido de cada invitado).
- **FR-003**: El aviso DEBE ofrecer un botón que abra WhatsApp contra `businesses.phone` con un mensaje pre-armado. Sin teléfono cargado, el botón NO DEBE mostrarse.
- **FR-004**: El teléfono DEBE normalizarse a dígitos para el link `wa.me`.
- **FR-005**: El mensaje pre-armado DEBE incluir día y hora de la reserva **cuando existan** (confirmación) y funcionar sin ellos (pantalla de reserva, antes de confirmar).
- **FR-006**: El aviso DEBE aparecer en `/reservar` y en `/reservar/confirmacion`; en la confirmación, sólo para reservas **vivas** (`confirmed`/`seated`).
- **FR-007**: El aviso es **informativo**: NO DEBE bloquear ni validar la reserva, ni cambiar el cupo (spec 077).

### Non-Goals

- **Entidad socio** (número de socio, validación de membresía, vincular invitados a un socio). Sigue fuera de alcance, como en 059.
- **Registrar los invitados en el sistema** (formulario, tabla `reservation_guests`, control de ingreso). Hoy el canal es WhatsApp y el registro vive en el chat del club.
- **Validar el máximo** contra `party_size`.
- **Pantalla de configuración** de la política (texto, máximo, teléfono aparte). Descartada por alcance; ver deuda abajo.
- **Que el aviso viaje en el mail/WhatsApp de confirmación** (spec 45). Descartado por Juan en esta ronda.

## Success Criteria *(mandatory)*

- **SC-001**: En `golf-jcr`, `/reservar` y la confirmación muestran el aviso con el máximo (2) y los datos pedidos.
- **SC-002**: El botón abre `wa.me/5493413276804` con el mensaje pre-armado; desde la confirmación el mensaje trae día y hora.
- **SC-003**: En `demo` no aparece nada nuevo en ninguna de las dos pantallas.
- **SC-004**: Sin `businesses.phone`, se ve el texto y no el botón.
- **SC-005**: `pnpm typecheck` + tests unitarios del helper (política por slug, normalización del teléfono, mensaje con y sin fecha) en verde; verificado en vivo.

## Deuda consciente

El texto y el máximo van **fijos en el código**, acotados por slug. Cambiar "2 invitados" o la redacción exige un deploy, y sumar otro club exige tocar la constante. Se decidió así por alcance; el día que un segundo negocio lo pida, mover a `reservation_settings` (o tabla propia) con toggle + texto + máximo editable. El módulo queda armado para ese movimiento: una sola función resuelve la política a partir del negocio.
