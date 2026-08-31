# 137 · El plano del día, a la hora que elijas

**Issue:** [#208](https://github.com/gachetponzellini/RestaurantOS-app/issues/208) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-08-31)

**Input:** Juan, 2026-08-31, sobre el alcance del rediseño de reservas:
*"rediseño completo, plano incluido"*.

**Tercera de tres.** [135 · bandeja](../135-la-bandeja-de-solicitudes/spec.md)
→ [136 · layout](../136-reservas-en-dos-columnas/spec.md) → 137 · plano.

**Depende de**: [`136`](../136-reservas-en-dos-columnas/spec.md) (la columna del
día donde vive este modo).

## Por qué

Hay un plano y no sirve para esto. El de
[`salon-desktop.tsx`](../../src/components/admin/local/salon-desktop.tsx) es la
foto del **ahora**: mesas ocupadas, mozos, cuentas abiertas. Las reservas
aparecen recién cuando faltan tres horas —
`VENTANA_RESERVA_EN_PLANO_MS` en [`plan-reservation.ts`](../../src/lib/mozo/plan-reservation.ts),
y con razón: *"una reserva de las 21 vista a las 12 no dice nada útil"* para
quien está atendiendo el mediodía.

Pero el encargado que arma la noche tiene la pregunta opuesta: **cómo queda el
sábado a las 21**. Hoy la única respuesta es leer una lista de horarios e
imaginarse el salón. Y es exactamente la pregunta que hay que contestar para
decidir una solicitud: *si le doy esta mesa, ¿qué me queda?*

Que `/admin/reservas/plano` sea hoy un `redirect` a Salones deja claro que el
lugar estaba reservado y vacío.

## Las decisiones

**D1 · El plano es un modo de la columna del día, no otra pantalla.** Toggle
**Lista / Plano** arriba de la columna izquierda. Misma fecha, mismos datos,
otra forma de mirarlos.

**D2 · Una hora, elegida a mano.** Un control de hora sobre el plano: se mueve
y el salón se repinta a ese momento. Arranca en la hora del primer servicio con
reservas del día — el momento que el encargado va a querer ver.

**D3 · Tres estados de mesa, y el tercero es el que importa.** Libre ·
reservada · **con una solicitud sin responder**, esta última punteada y en
ámbar. Ver la mesa que una solicitud se comería es lo que convierte al plano en
una herramienta de decisión y no en un dibujo.

**D4 · Las genéricas no desaparecen, se cuentan aparte.** En modo flexible
muchas reservas no tienen mesa (spec 059). Como no se pueden dibujar, se listan
al pie del plano: «3 reservas sin mesa · 11 cubiertos». Esconderlas haría leer
un salón más vacío de lo que está.

**D5 · Click en una mesa dice quién la tiene**, con su hora y sus personas, y
—si es una solicitud— las mismas tres acciones de la bandeja. Confirmar desde
el plano es el gesto natural cuando la pregunta era espacial.

**D6 · Sólo lectura sobre la posición.** Acá no se arrastran mesas: el editor
del salón sigue en Salones. Este plano muestra, no edita el plano.

## Alcance

### Dominio

- **`plano-del-dia.ts` (nuevo, puro):**
  - `estadoDeMesasEn(hora, reservas, mesas)` → por mesa: `libre` ·
    `reservada` · `pendiente`, con la reserva que la ocupa. Una mesa está
    tomada si la hora cae dentro de `[starts_at, ends_at)`, que es el mismo
    rango que usa el GIST — así el plano no puede contradecir a la DB.
  - `horasDelDia(reservas, servicios, mode)` → los pasos del control: los slots
    del día en estricto, la ventana de los servicios en flexible.
  - `sinMesa(reservas)` → el resumen de las genéricas (D4).
- Sin migración, sin actions nuevas: las tres acciones son las de la 131/132.

### UI

- **`plano-del-dia.tsx` (nuevo):** el canvas de sólo lectura. Dibuja las mesas
  con la posición, forma y rotación del `floor_plan`. **No reusa `TableShape`**:
  ese componente está atado al editor (`EditorTable`, `selected`,
  `onPointerDown`, sillas dibujadas una por una) y acá el detalle estorba — son
  70 mesas que hay que leer de un vistazo, y lo que importa es el color. El
  encuadre sale del rectángulo que ocupan las mesas, con aire alrededor. Con más
  de un salón, un selector arriba.
- **Toggle Lista / Plano** en la columna del día (spec 136).
- **Control de hora** sobre el plano, con los pasos de `horasDelDia`.
- **Detalle de mesa** al hacer click: quién, hora, personas, y las acciones si
  es una solicitud.
- **Leyenda** de los tres estados, y el pie con las reservas sin mesa.

## Qué NO entra

- **Arrastrar una solicitud a una mesa** para asignarla. Es el gesto obvio que
  sigue, pero necesita resolver el conflicto con el GIST y el modo flexible; se
  hace después, con su propia spec.
- **Tocar el plano de Operación.** Sigue siendo el del ahora, sin cambios.
- **Animar el paso del tiempo** (reproducir la noche). Suena lindo y no ayuda a
  decidir.
- **Editar la posición de las mesas.** Eso es Salones (D6).

## Escenarios de aceptación

1. **Dado** un día con reservas, **cuando** el encargado pasa a «Plano»,
   **entonces** ve el salón pintado a la primera hora con reservas.
2. **Dado** el control de hora, **cuando** lo mueve, **entonces** las mesas
   cambian de estado según lo que esté reservado en ese momento.
3. **Dado** una solicitud sin responder con mesa pedida, **entonces** esa mesa
   se ve punteada y distinta de una reservada.
4. **Dado** que confirma esa solicitud desde el plano, **entonces** la mesa pasa
   a reservada y la solicitud sale de la bandeja.
5. **Dado** un negocio flexible con reservas genéricas, **entonces** el plano
   las resume al pie en vez de omitirlas.
6. **Dado** más de un salón, **entonces** se puede cambiar de salón sin perder
   la hora elegida.
7. **Dado** un click en una mesa reservada, **entonces** se ve quién la tiene, a
   qué hora y cuántos son.
8. **Dado** un día sin ninguna reserva, **entonces** el plano se ve entero libre
   y lo dice, en vez de quedar mudo.

## Verificación

15 tests nuevos de `plano-del-dia.ts`: bordes del rango (`starts_at` incluido,
`ends_at` excluido), la pendiente ganándole a la confirmada sobre la misma mesa,
los estados que no ocupan nada, los pasos de hora en los dos modos y sin config,
y el resumen de genéricas. `pnpm typecheck` en verde y 1864 unitarios en verde.

### Verificado en vivo (2026-08-31, `demo`, Salón 2)

| Escenario | Resultado |
|---|---|
| 1 · toggle | «Lista / Plano» en la columna del día; el plano abre en la primera hora con reservas (13:00) |
| 2 · la hora manda | movido el control a las 22:00, las 27 mesas quedan libres — las reservas eran de 13:00 a 14:30 |
| 3 · la solicitud se distingue | mesa 104 punteada en ámbar; las tres confirmadas, azules |
| 4 · confirmar desde el plano | la 104 pasó a `confirmed` con `decided_at`, quedó azul y la bandeja bajó de 2 a 1 |
| 7 · click en la mesa | «Mesa 104 — Bandeja Sábado · 4p · 13:00 · sin responder» con Confirmar y Rechazar |

Los datos de prueba del `demo` se borraron al terminar.
