# Feature Specification: Las comandas entregadas se ocultan a los 30 minutos

**Feature Branch**: `082-comandas-entregadas-ventana`

**Created**: 2026-08-04

**Status**: ✅ Implementada (2026-08-04).

**Input**: Juan, 2026-08-04: *"las comandas que ya fueron entregadas hace mas de 30 minutos deberian de ocultarse"*.

**Issue**: #131

**Depende de**: [`035-reimpresion-y-fallos-de-impresion`](../035-reimpresion-y-fallos-de-impresion/spec.md) (alerta de fallos sobre el mismo set) · [`065-filtros-salon-y-catalogo`](../065-filtros-salon-y-catalogo/spec.md) (el filtro de salón vive en la misma derivación).

## Contexto y problema

La columna **Entregadas** del KDS (`/admin/operacion` → tab Comandas) mostraba **todo lo que salió en el día operativo**, ordenado por hora de entrega desc, con un tope de 100 cards. En un servicio real eso la convierte en un archivo: a media tarde son decenas de comandas que ya nadie mira y que empujan hacia abajo lo único accionable — la entrega que se acaba de marcar, la comanda que no imprimió.

Una comanda entregada sirve como **acuse de recibo** ("sí, eso ya salió, hace 3 minutos"). Ese valor se agota a los minutos: pasado un rato, el plato está comido y la card sólo ocupa pantalla en la hora pico, que es justo cuando el encargado menos puede scrollear.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Cuánto dura la ventana? | **30 minutos** desde la entrega (pedido de Juan). Constante única, compartida por server y cliente. |
| ¿Ventana rodante o corte por día? | **Rodante**. El corte por día operativo se saca: a las 00:10 el local sigue sirviendo y la columna no tiene por qué vaciarse en el cambio de fecha. |
| ¿Se avisa? | Sí — la columna aclara "Últimos 30 min" bajo el título, para que las cards que se van solas no se lean como un bug. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La columna Entregadas muestra lo de recién (Priority: P1)

Como encargado, en hora pico quiero que Entregadas muestre sólo lo que salió recién, para leer de un vistazo qué acaba de irse a la mesa sin scrollear el historial del día.

**Independent Test**: Con comandas entregadas hace 5, 20 y 90 minutos, abrir la tab Comandas y verificar que se ven las dos primeras.

**Acceptance Scenarios**:

1. **Dado** una comanda entregada hace 5 minutos, **Cuando** abro la tab, **Entonces** se ve en Entregadas.
2. **Dado** una comanda entregada hace 90 minutos, **Cuando** abro la tab, **Entonces** no se ve.
3. **Dado** que no hubo entregas en la última media hora, **Entonces** la columna queda vacía con "Sin entregas recientes" — no con un mensaje que sugiera que nunca se entregó nada.
4. **Dado** que marco una comanda como entregada, **Entonces** pasa a Entregadas y se queda los 30 minutos.

---

### User Story 2 - La card se va sola, sin refetch (Priority: P1)

Como encargado con el KDS abierto y quieto, quiero que una comanda que cumple los 30 minutos desaparezca sola, sin depender de que entre un pedido nuevo.

**Independent Test**: Dejar la pantalla abierta con una comanda entregada hace 29 minutos y verificar que se va sin tocar nada.

**Acceptance Scenarios**:

1. **Dado** el kanban abierto sin actividad, **Cuando** una comanda entregada cumple la ventana, **Entonces** desaparece en el próximo tick del reloj (≤ 30 s), sin refetch ni refresh.
2. **Dado** que la card se ocultó, **Cuando** entra un evento de realtime, **Entonces** no reaparece (server y cliente aplican el mismo corte).

---

### User Story 3 - Los números de la tab siguen cuadrando (Priority: P2)

Como encargado, quiero que la alerta de impresión y los contadores cuenten lo mismo que veo: si dice "1 comanda no se imprimió", tiene que haber una card para tocar.

**Independent Test**: Con una comanda entregada hace 2 horas y con `print_failed_at`, verificar que la alerta no la cuenta y que "Ver solo las fallidas" no abre una columna vacía.

**Acceptance Scenarios**:

1. **Dado** una comanda fuera de la ventana con fallo de impresión, **Entonces** no suma a la alerta de fallos.
2. **Dado** el filtro "solo fallidas" activo, **Entonces** lo que cuenta la alerta es exactamente lo que se muestra.
3. **Dado** el filtro por salón (spec 065), **Entonces** las dos reglas se componen: se ve lo del salón elegido y dentro de la ventana.

### Edge Cases

- **Medianoche**: la ventana es rodante. A las 00:10 sigue visible lo entregado 23:55 — antes el corte por día lo borraba de golpe.
- **`delivered_at` nulo** en una comanda `entregado` (dato viejo/inconsistente): no se muestra. La columna se ordena y se corta por esa hora; sin ella no hay forma de saber si es de recién. Es el comportamiento que ya tenía la query.
- **Reloj del cliente desfasado hacia adelante**: una `delivered_at` "futura" se muestra, no se descarta.
- **Reimpresión**: una comanda entregada sale del KDS a los 30 minutos y con ella su opción de reimprimir. Es aceptable — reimprimir el ticket de cocina de un plato que ya se comió no tiene uso; las comandas **activas** (pendiente / en preparación) no tienen recorte temporal y se siguen viendo siempre.
- **Comandas activas**: no las toca. Una comanda vieja sin entregar sigue arriba en su columna, que es el punto de la alerta de demora (spec 30).
- **Reportes**: los tiempos por sector (`station-timings`) salen de su propia query — no dependen de esta ventana.

## Requirements *(mandatory)*

- **FR-001**: El KDS DEBE mostrar en la columna Entregadas sólo las comandas con `delivered_at` dentro de los últimos **30 minutos**.
- **FR-002**: La ventana DEBE ser una constante única compartida por la query server y el filtro cliente, para que las dos mitades no puedan contradecirse.
- **FR-003**: El cliente DEBE re-evaluar la ventana con un reloj vivo (tick ≤ 30 s), sin depender de realtime ni de un refetch.
- **FR-004**: El corte DEBE aplicarse **antes** de derivar los números de la tab (alerta de fallos de impresión, contadores por columna), no sólo al pintar las cards.
- **FR-005**: La ventana DEBE ser rodante — NO se corta por día operativo.
- **FR-006**: La columna DEBE decir que muestra los últimos 30 minutos.
- **FR-007**: Las comandas **activas** NO DEBEN tener recorte temporal (cero cambio).

### Non-Goals

- **Ventana configurable por negocio.** Constante fija; si algún local la pide distinta, es cambiar una línea.
- **Un "ver todas las del día"** en el KDS. El histórico ya vive en reportes y en la mesa.
- **Tocar el tope de 100** cards, que queda como red de seguridad del DOM.
- **Archivar / borrar** comandas en la base. Sólo cambia lo que se muestra.

## Success Criteria *(mandatory)*

- **SC-001**: Una comanda entregada hace más de 30 minutos no aparece en el KDS, ni en el page-load ni tras un refetch.
- **SC-002**: Una comanda entregada hace 5 minutos sí aparece.
- **SC-003**: Con la pantalla quieta, una card se oculta sola al cumplir la ventana (≤ 30 s de retraso).
- **SC-004**: La alerta de fallos de impresión no cuenta comandas ocultas.
- **SC-005**: `pnpm typecheck` + unit tests de la ventana (dentro, fuera, límite exacto, `delivered_at` nulo, medianoche) en verde; verificado en vivo.
