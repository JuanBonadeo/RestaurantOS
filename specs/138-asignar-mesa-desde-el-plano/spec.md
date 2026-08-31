# 138 · Asignar mesa a una solicitud desde el plano

**Issue:** [#209](https://github.com/gachetponzellini/RestaurantOS-app/issues/209) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-08-31)

**Input:** Juan, 2026-08-31: *"hacé lo de arrastrar la solicitud a la mesa, pero
no debería ser arrastrando, debería ser como en operación para elegir la mesa de
una reserva, podríamos reutilizar ese componente"*.

**Depende de**: [`137`](../137-el-plano-del-dia/spec.md) (el plano del día),
[`135`](../135-la-bandeja-de-solicitudes/spec.md) (la bandeja),
[`059`](../059-reservas-modo-flexible/spec.md) (de donde sale el gesto).

## Por qué

La 137 dejó afuera «arrastrar una solicitud a una mesa» como el paso siguiente
obvio. Juan corrigió el gesto, y tiene razón: **el drag sería inventar una
interacción que el sistema ya resolvió de otra manera**.

En Operación, asignarle mesa a una reserva es: tocar «Asignar mesa», el plano
queda esperando con un banner índigo —*«Tocá una mesa para Martín · 6p»*—, y el
tap la asigna ([`salon-desktop.tsx:1105`](../../src/components/admin/local/salon-desktop.tsx),
spec 059). El encargado ya lo conoce, funciona con el dedo en una tablet, y no
depende de la puntería de un arrastre sobre mesas de 40 px.

Lo que falta es que ese gesto exista en el plano del día, que es donde ahora se
mira la noche y se deciden las solicitudes.

## Las decisiones

**D1 · El mismo gesto, y el mismo código.** No se copia el patrón: se extrae. El
banner de modo y la regla de «¿esta mesa sirve?» pasan a piezas compartidas que
usan los dos planos. Dos copias del mismo gesto se separan al primer cambio.

**D2 · `FloorPlanViewer` no se reusa, y el motivo es real.** El viewer de
Operación pinta por `operational_status` (libre / ocupada / pidió cuenta) con
los colores fijos adentro: es el estado del **ahora**. El plano del día pinta
otra cosa —qué está reservado a una hora futura, y qué se comería una solicitud
sin responder— y para reusarlo habría que abrirle un modo de pintado externo,
tocando un componente del que dependen el mozo y el operativo. Se comparte lo
que de verdad es lo mismo: la interacción, no el dibujo.

**D3 · Asignar no decide.** Igual que editar (spec 132 · D2): darle mesa a una
solicitud la deja `pending`. El aviso al cliente sale en la decisión, una sola
vez y con los datos finales.

**D4 · La mesa se valida donde ya se validaba.** `updateReservationDetails`
—la misma action que usa Operación— chequea capacidad, ventana, cupo y GIST. El
cliente sólo adelanta lo obvio (capacidad) para no hacer ir y volver al server
por algo que se ve en la mesa. El sobrecupo en flexible sigue pidiendo
confirmación (`OVERBOOK_HINT`, spec 077).

**D5 · Se entra desde la bandeja, que es donde está la solicitud sin mesa.** El
botón **Asignar mesa** aparece en la tarjeta sólo cuando falta la mesa. La
segunda puerta que se había pensado —el detalle de una mesa del plano— no tiene
sentido: ese panel muestra la reserva que **ya ocupa** esa mesa, así que ahí
«asignar» no significa nada. Encender el modo trae el plano al frente si el
encargado estaba en la lista.

**D6 · Mientras el modo está activo, el plano no hace otra cosa.** El tap
asigna en vez de abrir el detalle, el borde del plano se marca, y hay una
salida visible. Es lo que hace Operación, y evita el clásico «toqué una mesa y
no sé qué hice».

## Alcance

### Dominio

- **`asignar-mesa.ts` (nuevo, puro):**
  - `mesaSirveParaReserva({ mesa, partySize })` → `{ ok }` o `{ ok: false, motivo }`
    con el texto que ve el encargado («Mesa 12 tiene 4 lugares para 6
    personas»). Es la regla que hoy vive suelta dentro de
    `handleAsignarMesaReserva`.
  - `mensajeDeAsignacion({ intent, mesa, nombre })` → el copy del banner y del
    toast, para que los dos planos digan exactamente lo mismo.

### UI

- **`elegir-mesa-banner.tsx` (nuevo, compartido):** la barra índigo de modo
  —icono, texto y «Cancelar»—, tal cual la de Operación. La usan
  `salon-desktop` y el plano del día.
- **`plano-del-dia.tsx`:**
  - estado `asignandoA: SolicitudId | null`;
  - con el modo activo: banner arriba, borde marcado, y el tap sobre una mesa
    llama a `updateReservationDetails` en vez de abrir el detalle;
  - las mesas que no sirven por capacidad se ven apagadas — que el error se vea
    antes del tap, no después;
  - al asignar: toast, sale del modo y el plano se repinta con la mesa tomada.
- **`solicitudes-inbox.tsx`:** botón **Asignar mesa** en las solicitudes sin
  mesa, que enciende el modo en el plano. Como la bandeja y el plano son
  hermanos en la pantalla (spec 136), el estado del modo sube a un contenedor
  cliente nuevo, **`reservas-workspace.tsx`** — la página es un server component
  y no puede sostenerlo. Encender el modo **trae el plano al frente**: si no, se
  prende donde nadie lo ve.
- **`salon-desktop.tsx`:** usa el banner y la regla compartidos; su
  comportamiento no cambia.

## Qué NO entra

- **Arrastrar.** Es lo que se descartó a propósito.
- **Sugerir la mesa** («esta es la más chica que entra»). El motor ya sabe
  hacerlo (`pickTable`), pero elegir por el encargado es otra decisión de
  producto.
- **Asignar mesa a varias solicitudes seguidas** sin salir del modo. Primero
  que funcione una.
- **Mover una reserva confirmada de mesa desde el plano.** Existe desde el
  panel de edición; meterlo acá amplía el alcance sin pedido.

## Escenarios de aceptación

1. **Dado** una solicitud sin mesa en la bandeja, **cuando** el encargado toca
   «Asignar mesa», **entonces** el plano pasa al frente y entra en modo, con el
   banner y una salida visible.
2. **Dado** el modo activo, **cuando** toca una mesa con lugar, **entonces** la
   mesa queda asignada, se avisa con un toast y el plano la muestra tomada.
3. **Dado** el modo activo, **cuando** toca una mesa chica para el grupo,
   **entonces** se lo dice con el número («tiene 4 lugares para 6 personas») y
   no asigna.
4. **Dado** que asignó la mesa, **entonces** la solicitud **sigue pendiente** y
   la bandeja la muestra con su mesa nueva.
5. **Dado** el modo activo, **cuando** toca «Cancelar», **entonces** vuelve todo
   como estaba y el tap siguiente abre el detalle de la mesa otra vez.
6. **Dado** que la mesa está ocupada por otra reserva en esa ventana,
   **entonces** el server lo rechaza con un mensaje claro y no se pierde el
   modo.
7. **Dado** un negocio flexible donde la mesa deja el servicio sobre el cupo,
   **entonces** se pide confirmación en vez de rechazar (spec 077).
8. **Dado** el plano de Operación, **entonces** el gesto sigue funcionando igual
   que antes.

## Verificación

7 tests nuevos de `asignar-mesa.ts` (capacidad justa, insuficiente con el texto
exacto, singular/plural, mesa deshabilitada, y el copy de los dos intents).
`pnpm typecheck` en verde y 1871 unitarios en verde.

### Verificado en vivo (2026-08-31, `demo`, Sofía · encargada)

| Escenario | Resultado |
|---|---|
| 1 · encender el modo | «Asignar mesa» en la bandeja trajo el plano al frente, con el banner «Tocá una mesa para Asignar Mesa 138 · 6p» y el borde índigo |
| 3 · mesa chica | de 43 mesas, 40 aparecieron apagadas; tocar R01 avisó «Mesa R01 tiene 4 lugares para 6 personas» y el modo siguió activo |
| 2 · asignar | tocada R11 (6 lugares), quedó asignada con su toast |
| 4 · no decide | la solicitud siguió `pending` (`decided_at` null) y la bandeja la mostró con «mesa R11» |
| 6 · mesa ya tomada | una segunda solicitud a la misma hora sobre R11: «La mesa ya está reservada en ese horario», sin salir del modo y sin escribir nada |
| 8 · Operación | el plano del operativo sigue igual, sin errores de consola |

**Bug encontrado y arreglado de paso:** la bandeja calculaba su `now` con
`new Date()` en el cliente, y como se renderiza también en el server los «vence
en» no coincidían → error de hidratación en cada carga. Ahora el reloj viene del
server (`ahoraIso`) y pasa al del navegador después de montar.

Los datos de prueba del `demo` se borraron al terminar.
