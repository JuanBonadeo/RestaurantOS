# Feature Specification: Reservas flexibles — el cupo se cuenta en mesas, con colchón para walk-ins

**Feature Branch**: `081-reservas-cupo-por-mesas`

**Created**: 2026-08-04

**Status**: 📝 Spec aprobada (decisiones de Juan, 2026-08-04) — lista para implementar.

**Input**: Juan, 2026-08-04: *"el primer control tendría que ser la cantidad de mesas por salón, si hay 10 mesas en salón 1 no se deberían de poder hacer más de 8 reservas, siempre dejar dos libres ponele"*. Sobre dónde configurarlo: *"eso estaba en la parte de configuración de reservas, capaz habría que adaptarlo o mejorarlo"*.

**Issue**: _pendiente de crear._

**Depende de**: [`077-reservas-cupo-real`](../077-reservas-cupo-real/spec.md) (el cupo frena al cliente) · [`059-reservas-modo-flexible`](../059-reservas-modo-flexible/spec.md).

## Contexto y problema

La spec 077 hizo que el cupo frenara al cliente, pero con dos medidas que en la práctica casi no cortan por volumen:

1. **Cubiertos** (`soft_capacity`, 100 por servicio y zona en `golf-jcr`): recién frena con 100 personas.
2. **Mesa libre que entre el party**: sólo mira si queda **alguna** mesa con asientos suficientes.

El agujero está en la segunda. Las reservas que crea la web son **genéricas** (sin mesa asignada) y una genérica **no ocupa ninguna mesa** — sólo suma cubiertos. Resultado concreto: **30 reservas de 2 personas en un salón de 10 mesas pasan sin problema** (60 cubiertos, no llegó a 100; y las 10 mesas siguen "libres" porque ninguna reserva las tomó). El salón se compromete muy por encima de su capacidad física y nadie se entera hasta el día del servicio.

El control que falta es el que nombra Juan: **contar mesas**. Un salón de 10 mesas no puede comprometer más de 10 reservas — y menos todavía si el club quiere dejar algunas libres para los que caen sin reservar.

## Decisiones de producto (Juan, 2026-08-04)

| Pregunta | Decisión |
|---|---|
| ¿Dónde se configura el colchón? | En la **config de reservas que ya existe** (editor de servicios, donde hoy vive el cupo). Se adapta ese lugar en vez de inventar otro. |
| ¿Cuántas mesas consume un grupo grande? | **Las que necesite por tamaño**: 10 personas en un salón de mesas de 4 consumen 3 mesas, no 1. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El salón deja de comprometerse por encima de sus mesas (Priority: P1)

Como club, cuando las reservas de un servicio ya comprometieron las mesas disponibles del salón, la web deja de tomar reservas para ese servicio y zona — aunque sobren cubiertos del cupo.

**Independent Test**: En un salón de 10 mesas con colchón 2, cargar reservas hasta comprometer 8 mesas y verificar que la web ya no ofrece ese servicio en esa zona.

**Acceptance Scenarios**:

1. **Dado** un salón con 10 mesas activas y colchón de 2, **Cuando** las reservas vivas del servicio ya consumen 8 mesas, **Entonces** la web no toma más reservas para ese servicio y zona.
2. **Dado** ese mismo salón con 7 mesas consumidas, **Cuando** un cliente reserva para 2 personas, **Entonces** la reserva entra (consume la octava).
3. **Dado** un servicio **sin colchón configurado**, **Entonces** el tope es la cantidad de mesas activas de la zona (nadie compromete 30 reservas sobre 10 mesas).
4. **Dado** que el tope de mesas se alcanzó, **Cuando** todavía sobran cubiertos del cupo, **Entonces** igual corta: manda el que se agote primero (regla de 077).

---

### User Story 2 - Un grupo grande consume las mesas que realmente necesita (Priority: P1)

Como club, una reserva de 10 personas en un salón de mesas de 4 me consume 3 mesas del cupo, no una — que es lo que va a pasar el día del servicio cuando junte mesas.

**Independent Test**: En un salón de mesas de 4, cargar una reserva de 10 y verificar que el cupo de mesas bajó en 3.

**Acceptance Scenarios**:

1. **Dado** un salón con mesas de 4, **Cuando** entra una reserva de 10 personas, **Entonces** consume 3 mesas del tope.
2. **Dado** un salón con mesas de distintos tamaños, **Cuando** entra una reserva, **Entonces** se le imputa la mesa **más chica que la entre**; si ninguna la entra sola, se parte entre las que hagan falta.
3. **Dado** una reserva que ya tiene **mesa asignada** por el encargado, **Entonces** consume exactamente esa mesa.
4. **Dado** un party más grande que todas las mesas libres sumadas, **Entonces** no hay lugar por web.

---

### User Story 3 - El colchón se configura donde ya está el cupo (Priority: P1)

Como encargado, en la misma pantalla donde configuro los servicios y su cupo, defino cuántas mesas quiero dejar siempre libres para walk-ins.

**Independent Test**: Poner colchón 2 en la Cena del Salón principal, guardar, y verificar que el tope de ese servicio baja en 2 mesas.

**Acceptance Scenarios**:

1. **Dado** el editor de servicios, **Cuando** lo abro, **Entonces** cada servicio tiene su horario, su **cupo de cubiertos** y sus **mesas libres para walk-ins**, y queda claro cuál es cuál.
2. **Dado** que guardo un colchón, **Cuando** un cliente reserva, **Entonces** el tope aplicado es `mesas activas de la zona − colchón`.
3. **Dado** un colchón mayor o igual a las mesas de la zona, **Entonces** ese servicio no toma reservas web (el club cerró la zona); la config lo advierte en vez de fallar en silencio.

### Edge Cases

- **El encargado no queda afuera**: como en 077, puede pasarse confirmando (`allow_overbook`). El colchón es para el cliente.
- **Mesas de barra** (`is_bar`): siguen fuera del motor, no cuentan ni como capacidad ni como colchón.
- **Zona sin mesas activas**: no toma reservas web (ya pasaba).
- **Servicio sin zona** (`floor_plan_id` nulo, vale para todo el negocio): el tope se cuenta sobre las mesas reservables del negocio.
- **Carrera**: sigue siendo best-effort, igual que el cupo de cubiertos (077). La integridad de mesa la sigue dando el GIST.
- **Cambio de comportamiento vs. 077**: hoy un party de 10 en un salón cuya mesa más grande es de 8 recibe "no queda mesa". Con esta spec **entra**, consumiendo 2 mesas — porque el club junta mesas. El corte por tamaño se conserva sólo para **mesa puntual** pedida (`mesa-chica`).

## Requirements *(mandatory)*

- **FR-001**: El motor flexible DEBE calcular cuántas **mesas** de la zona consumen las reservas vivas de un servicio: las que tienen mesa asignada consumen la suya; las genéricas se imputan a la mesa libre **más chica que las entre**, partiéndose entre varias cuando ninguna las entra sola.
- **FR-002**: El tope de mesas DEBE ser `mesas activas de la zona − colchón`, y DEBE bloquear al cliente cuando `consumidas + las que necesita la nueva reserva > tope`.
- **FR-003**: El colchón DEBE configurarse **por servicio y zona**, en el editor de servicios que ya existe, junto al cupo de cubiertos. Default **0** (sin colchón), que no cambia el comportamiento de ningún negocio que no lo configure.
- **FR-004**: Los dos topes (cubiertos y mesas) DEBEN convivir: corta el que se agote primero, con el motivo correspondiente.
- **FR-005**: El encargado DEBE poder pasarse del tope de mesas confirmando, igual que con el de cubiertos (077). La regla una-reserva-por-(mesa, servicio) NO se toca.
- **FR-006**: El editor de servicios DEBE distinguir claramente **cupo de cubiertos** de **mesas libres para walk-ins**, y advertir cuando el colchón deja el servicio sin mesas reservables.
- **FR-007**: El modo `estricto` NO DEBE cambiar (ya asigna mesas reales). Cero regresión.

### Non-Goals

- **Mesas combinables como entidad** (una reserva atada a N mesas en la base). El cálculo es de **capacidad**, no crea vínculos: la mesa real se elige al sentar.
- **Colchón por franja horaria** dentro del servicio.
- **Cupo por cantidad de reservas** a secas (sin mirar tamaño) — descartado por la decisión de Juan.
- **Lock transaccional**: sigue best-effort.

## Success Criteria *(mandatory)*

- **SC-001**: En un salón de 10 mesas con colchón 2, la web deja de tomar reservas cuando las vivas consumen 8 mesas.
- **SC-002**: Una reserva de 10 personas en un salón de mesas de 4 consume 3 mesas del tope.
- **SC-003**: Sin colchón configurado, el tope es la cantidad de mesas activas — 30 reservas sobre 10 mesas ya no pasan.
- **SC-004**: El encargado puede cargar la reserva rechazada al cliente, confirmando.
- **SC-005**: El editor de servicios permite configurar el colchón por servicio y zona, y lo explica.
- **SC-006**: `pnpm typecheck` + tests unitarios del cálculo de mesas (imputación, grupo partido, mesa asignada, colchón, tope alcanzado) en verde; verificado en vivo.
