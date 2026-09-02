# 144 · La reserva nueva elige salón (y la mesa se toca en el plano)

**Issue:** [#216](https://github.com/gachetponzellini/RestaurantOS-app/issues/216) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada (2026-09-02)

**Input:** Juan, 2026-09-02: *"hay que corregir, a la hora de crear una reserva
en la tab de reservas, al elegir una mesa debería de aparecer el mapa, y creo
que te tendría que hacer elegir un salón no? así puede contar bien el cupo
después, aunque no tenga la mesa asignada"*.

**Depende de**: [`059`](../059-reservas-modo-flexible/spec.md) (modo flexible,
cupo por zona y el gesto de elegir mesa en el plano),
[`077`](../077-reservas-cupo-real/spec.md) (el cupo),
[`136`](../136-reservas-en-dos-columnas/spec.md) y
[`138`](../138-asignar-mesa-desde-el-plano/spec.md) (la pantalla de reservas y
el plano donde ya se toca la mesa).

---

## Por qué

«Nueva reserva» de la tab de Reservas —tanto `/admin/reservas` como
`/admin/operacion?tab=reservas`— abre el **mismo** `ReservaForm` que el sidebar
del salón, pero llamado con `floorPlanId={null}`: el salón no se pregunta porque
en el sidebar viene dado por el plano que se está mirando. Eso rompe dos cosas.

**1 · El cupo no cuenta la reserva.** En flexible los cubiertos se cuentan **por
zona**: `reservedCovers(reservas, ventana, floorPlanId)` filtra por
`floor_plan_id`, y los servicios de golf-jcr están configurados **por salón**
(Almuerzo y Cena × Salón principal / Terraza, `soft_capacity` 100 cada uno). Una
reserva cargada desde la tab se guarda con `floor_plan_id = NULL`, así que **no
suma al cupo de ningún salón** — y la reserva sin mesa, que es la que el cupo
existe para contar, es exactamente el caso que se pierde.

**2 · En estricto sólo existe el primer salón.** Sin `floor_plan_id`,
`getBusinessTables` cae al comportamiento legacy: el **primer** `floor_plan` del
negocio. En `demo`, «Salón 2» (27 mesas) hoy es invisible para reservas — ni
para auto-asignar ni para elegir a mano.

Y encima la mesa se elige de un `<select>` de 70 renglones, cuando el sistema ya
resolvió ese gesto dos veces: en Operación (spec 059) y en el plano del día
(spec 138) la mesa **se toca**.

## Las decisiones

**D1 · El salón es un campo del formulario, y es obligatorio cuando hay más de
uno.** No hay opción «cualquier salón»: es la que produce el agujero del cupo.
Con un solo salón reservable no se pregunta nada (se elige solo y no se dibuja
el campo): no es una decisión, es un dato.

**D2 · Reservable = tiene al menos una mesa activa que no sea de barra.** Es el
mismo criterio que el motor (`getAllReservableTables` filtra `is_bar`), así que
«Pedidos de Mostrador» de golf-jcr —60 mesas, todas de barra— no aparece como
salón para reservar, y ninguna mesa que el server vaya a rechazar se puede
tocar.

**D3 · La mesa se toca en un plano embebido en el formulario, no en el plano de
la página.** El sidebar del salón delega en el plano que ya está en pantalla
(`TablePickerBridge`), pero acá el formulario es una hoja modal y en la tab de
Operación **no hay** plano al lado. El plano viaja adentro del campo: un botón
«Elegir mesa en el plano» lo despliega, y elegida la mesa queda el mismo chip
índigo que en el sidebar. Un solo lenguaje visual, tres pantallas.

**D4 · El plano pinta libre / ocupada / no entra.** El estado sale del motor,
no del `operational_status`: en flexible de `freeTables` del servicio, en
estricto de las mesas libres **del slot elegido**. «No entra» (mesa más chica
que el grupo) se distingue de «ocupada» porque son dos problemas distintos: uno
se arregla cambiando de mesa, el otro de horario.

**D5 · El motor de estricto pasa a decir qué mesas quedan libres en cada slot.**
`computeAvailableSlots` ya recorre mesa por mesa para decidir si el slot existe;
ahora devuelve además `freeTableIds`. Sin esto el plano tendría que pintar el
`operational_status` —el estado del **ahora**—, que para una reserva de mañana
no significa nada. Es la misma corrección que la spec 137 le hizo al plano del
día, ahora en el picker.

**D6 · La mesa sigue siendo opcional; el salón no.** «Sin mesa, se sienta al
llegar» es el caso normal del libro de reservas (spec 059) y no se toca. Lo que
cambia es que esa reserva ahora **tiene zona**, que es lo único que el cupo
necesita para contarla.

**D7 · Los servicios se filtran por el salón elegido, con red.** Un servicio
configurado para una zona sólo se ofrece en esa zona (más los que no tienen
zona). Si el salón elegido no tiene ninguno —el Bar de golf-jcr no tiene
servicios cargados— se ofrecen todos igual: bloquear la reserva sería una
regresión silenciosa de algo que hoy se puede hacer.

## Alcance

### Dominio

- **`availability.ts`:** `AvailableSlot` suma `freeTableIds: string[]` — las
  mesas del pool (activas, con lugar) sin conflicto en `slot + duración +
  buffer`. Se calcula donde ya se recorría; el slot sigue existiendo sólo si hay
  al menos una.
- **`availability-actions.ts`:** el DTO de `fetchAvailability` viaja con
  `free_table_ids`.
- **`plano-del-dia.ts`:** `encuadreDeMesas(mesas)` — el `viewBox` que hoy calcula
  a mano el plano del día, ahora compartido con el picker.

### UI

- **`mesa-figura.tsx` (nuevo, compartido):** el dibujo de una mesa en SVG
  (círculo / cuadrado / rectángulo, rotación y etiqueta). Lo usan el plano del
  día y el picker; es lo único que de verdad es igual entre los dos (spec 138 ·
  D2: se comparte la pieza, no el componente).
- **`mesa-picker-plano.tsx` (nuevo):** el plano dentro del formulario. Pinta
  libre / ocupada / no entra / elegida, el tap elige y vuelve a tocar la
  elegida la saca. Navegable con teclado: ↑/↓ recorren las mesas libres, Enter
  elige, Escape cierra (spec 075 — el formulario de reserva se teclea entero).
- **`new-reservation-modal.tsx` (`ReservaForm`):** campo **Salón** (chips, misma
  mecánica de teclado que los servicios), el `<select>` de mesas reemplazado por
  el picker, y el salón elegido viajando a `fetchAvailability` /
  `fetchFlexibleAvailability` / las dos actions de creación.
- **`admin-day-list.tsx`:** le pasa `floorPlans` al modal, y cuando la tab de
  Operación tiene **un solo** salón filtrado, ése viene preelegido.

## Qué NO entra

- **Tocar el sidebar del salón.** Ahí el salón ya viene dado por el plano que se
  está mirando y la mesa ya se toca: sigue igual.
- **El flujo del cliente** (`/reservar`). Elegir salón ahí es otra decisión de
  producto (spec 059 lo dejó afuera a propósito).
- **Editar el salón de una reserva ya creada.** El panel de edición (spec 097)
  cambia mesa, comensales y horario; la zona sigue derivando de la mesa.
- **Backfill de las reservas viejas sin zona.** Quedan como están: son las que
  ya se cargaron, y adivinarles el salón sería inventar datos.

## Escenarios de aceptación

1. **Dado** un negocio con dos o más salones reservables, **cuando** el
   encargado abre «Nueva reserva», **entonces** ve el campo Salón sin nada
   elegido y no puede crear la reserva hasta elegir uno.
2. **Dado** un negocio con un solo salón reservable, **entonces** el campo no se
   dibuja y la reserva se crea igual que antes.
3. **Dado** el salón elegido, **cuando** toca «Elegir mesa en el plano»,
   **entonces** aparece el plano de **ese** salón, con las mesas libres
   tocables y las ocupadas y las chicas apagadas.
4. **Dado** el plano abierto, **cuando** toca una mesa libre, **entonces** queda
   el chip «Mesa 12» con «Cambiar» y «✕», y la reserva se crea sobre esa mesa.
5. **Dado** que no toca ninguna mesa, **entonces** la reserva se crea **sin
   mesa** pero **con salón**, y los cubiertos del servicio suben en ese salón.
6. **Dado** un negocio flexible con el cupo lleno en un salón, **cuando** el
   encargado cambia de salón, **entonces** el contador de cubiertos y el aviso
   de servicio completo se recalculan para el salón nuevo.
7. **Dado** el modo estricto, **cuando** elige un horario, **entonces** el plano
   muestra libres exactamente las mesas que no tienen reserva en ese slot (no el
   estado del momento).
8. **Dado** el sidebar del salón (spec 059), **entonces** «Nueva reserva» sigue
   funcionando exactamente igual.

## Verificación

8 tests nuevos: 2 del motor (`availability.test.ts` — las mesas libres son las
del slot, y no entran ni las chicas ni las deshabilitadas), 2 del encuadre
compartido y 6 del formulario (`new-reservation-modal.salon.test.tsx`: sin salón
no se crea nada, la disponibilidad se pide para el salón elegido, la reserva sin
mesa se guarda con salón, la mesa se toca en el plano, una mesa no libre no se
puede elegir, y con un solo salón no se pregunta nada). `pnpm typecheck` en
verde y 1985 unitarios en verde (los `*.integration.test.ts` que fallan —caja,
comandas, stock y un copy de editar reserva— venían fallando de antes y no tocan
nada de esto).

### Verificado en vivo (2026-09-02, `demo`, Sofía · encargada)

| Escenario | Resultado |
|---|---|
| 1 · salón obligatorio | con «Salón principal» y «Salón 2» sin elegir, «Crear reserva» quedó `disabled` y el horario dijo «Elegí un salón para ver los horarios» |
| 7 · estricto, mesas del slot | elegido Salón 2 aparecieron sus horarios (20:30 / 21:00 / 21:30 — antes el salón entero era inalcanzable) y el plano mostró sus 27 mesas, las 27 libres |
| 4 · elegir en el plano | tocada la 115 quedó el chip «Mesa 115» con «Cambiar» y «✕», y la reserva se creó sobre esa mesa |
| 7 bis · ocupada | reabierto el formulario a las 21:00, la 115 pasó a «ocupada» y las otras 26 siguieron libres |
| «no entran» | subiendo a 6 personas, 7 mesas del salón pasaron a «no entran», 1 ocupada, 19 libres |
| 6 · cupo por salón (flexible) | con `demo` en flexible y un servicio por zona: Salón principal «0/60 cubiertos», Salón 2 «2/20» — el contador se recalcula al cambiar de salón |
| 5 · sin mesa, con salón | creada sin mesa en Salón 2: la fila quedó con `table_id NULL` y **`floor_plan_id` = Salón 2**, y el contador pasó de 2/20 a **4/20** (antes la reserva no sumaba en ningún cupo) |

**Bug encontrado y arreglado de paso:** `createReservationFromAdmin` **no le
pasaba** el `floor_plan_id` a `createReservationCommon`, aunque el schema ya lo
aceptaba. El pool de mesas caía al primer `floor_plan` del negocio, así que
elegir una mesa de otro salón moría con «La mesa seleccionada no existe» (y el
auto-asignar siempre terminaba en el primer salón). Salió apenas el formulario
pudo ofrecer el segundo salón.

Los datos de prueba del `demo` se borraron al terminar (reservas, servicios de
QA y el modo, que volvió a `estricto`).
