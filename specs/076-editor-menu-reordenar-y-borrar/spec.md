# Feature Specification: Reordenar y borrar los componentes del menú del día

**Feature Branch**: `076-editor-menu-reordenar-y-borrar`

**Created**: 2026-08-04

**Status**: 🚧 En implementación. Issue [#116](https://github.com/gachetponzellini/RestaurantOS-app/issues/116). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-08-04 — *"hay que cambiar un par de cosas a la hora de crear un menu, primero que te deje reordenar el grupo de opciones y borrarlas, y segundo que el tema de las categorias y que deje tambien poner lo de lleva otra categoria para dos categorias para abajo"*.

## Contexto y problema

El editor del menú del día ([`daily-menu-form.tsx`](../../src/components/admin/daily-menus/daily-menu-form.tsx)) arma una lista plana de `components` con `useFieldArray`. El `sort_order` que se persiste **es la posición en ese array** (ver `syncComponents`), y ese orden es el que determina todo lo de abajo: el orden de los pasos del asistente del mozo ([spec 072](../072-menu-del-dia-por-pasos/)) y qué grupos puede condicionar una opción ([spec 074](../074-grupos-condicionales-menu-del-dia/), FR-002 — sólo hacia adelante).

Ese array **sólo crece**. No hay forma de mover nada ni de borrar un grupo:

- **No se puede reordenar.** Ni las tarjetas entre sí ni las opciones dentro de un grupo. Si cargaste Postre antes que Principal, quedó así para siempre; la única salida es borrar y volver a cargar todo. Hay un ícono `GripVertical` dibujado en cada opción que **no arrastra nada** — promete algo que no existe.
- **No se puede borrar un grupo.** El botón de basura vive por opción y está condicionado a `indices.length > 1`, o sea que nunca se puede sacar la última: un grupo creado por error queda pegado al menú.

Y de ahí sale el segundo pedido, que **es el mismo problema**. Los checks «Lleva X» ya se muestran para **todos** los grupos posteriores, no sólo el de al lado. Lo que pasa es que si el grupo que querés condicionar quedó cargado *arriba*, la regla es imposible por FR-002 y el propio validador te dice *«"Guarnición" se decide antes que "Principal" — movelo después para poder condicionarlo»*. El mensaje pide exactamente lo único que el editor no deja hacer. Confirmado con Juan: *«falta poder mover los grupos»*.

Hay además una consecuencia silenciosa del array append-only: **las opciones de un grupo no quedan contiguas**. Agregar una opción hace `append` al final del array, así que un grupo cargado temprano termina con opciones intercaladas entre los grupos que vinieron después. Hoy no rompe nada —el agrupado es por `choice_group_id` y la posición del grupo es la de su primera opción—, pero vuelve el `sort_order` guardado incomprensible y haría ambiguo cualquier "mover".

## Requisitos

### FR-001 — Cada tarjeta se sube y se baja

El editor muestra **tarjetas**: un componente suelto (texto o producto fijo) o un grupo de opciones entero. Cada tarjeta tiene ▲ / ▼ que la intercambian con la vecina. Los botones de los extremos van deshabilitados.

Mover un grupo mueve **todas sus opciones juntas**, en bloque. El orden de las tarjetas es el orden en que el mozo va a decidir, y es lo que se persiste como `sort_order`.

### FR-002 — Las opciones se ordenan dentro de su grupo

Dentro de un grupo, cada opción también sube y baja. Ese orden es el que ve el mozo en el paso, y el que numera los atajos `1`–`9` del asistente (spec 072), así que no es cosmético: define qué tecla carga qué plato.

### FR-003 — Un grupo se borra entero

Botón de borrar en el encabezado del grupo, que se lleva todas sus opciones. Pide confirmación —puede tirar varias opciones cargadas de un saque— nombrando el grupo y cuántas opciones se van.

El botón por opción sigue existiendo y sigue sin permitir borrar la última: para dejar el grupo vacío está el botón del grupo, que dice lo que hace. Un grupo sin opciones no es un estado intermedio útil (el asistente lo descarta y el editor no lo podría volver a mostrar).

### FR-004 — Al mover, la regla que queda mirando hacia atrás se descarta, con aviso

Si «Principal» condiciona a «Guarnición» y después se mueve Guarnición **arriba** de Principal, esa regla deja de ser válida (FR-002 de la spec 074) y —peor— se vuelve **invisible**: los checks sólo dibujan los grupos posteriores, así que no habría forma de destildarla y el menú no se podría guardar nunca más. Es un callejón sin salida.

Después de cada movimiento se descartan las reglas que quedaron apuntando hacia atrás, y se avisa con un toast que nombra cuál se fue y por qué. Silencioso no: es configuración que el encargado había cargado.

En la misma pasada se limpian las referencias a grupos que ya no existen (borrar un grupo deja punteros fantasma). Eso no se avisa: el grupo ya no está, no hay nada que decidir. `syncComponents` ya las filtraba al guardar; ahora además no ensucian el estado del form.

### FR-005 — Las opciones de un grupo quedan contiguas

Cualquier operación del editor deja el array normalizado: las opciones de un grupo, juntas y en orden, en la posición de su tarjeta. Agregar una opción la inserta **al final de su grupo**, no al final del menú.

Es la invariante que hace que "subir" y "bajar" signifiquen algo, y que el `sort_order` guardado se lea igual que la pantalla.

### FR-006 — La lógica de orden es pura y testeada

Agrupar en tarjetas, mover, borrar y limpiar reglas vive en un módulo puro (`src/lib/daily-menus/component-order.ts`), sin React ni DOM. El formulario sólo llama y hace `replace()`.

### FR-007 — Se puede reordenar sin mouse

Los botones son `<button>` de verdad, alcanzables con Tab y con `aria-label` que dice qué mueve ("Bajar el grupo Guarnición"). Después de mover, el foco queda **en el botón equivalente de la nueva posición**, así que bajar dos lugares es Enter, Enter — sin volver a buscar el botón con el mouse. Es el mismo criterio de las specs 055/066/072.

### FR-008 — Los valores viajan con la tarjeta, no con la posición

Al mover, lo que se ve tiene que moverse: el nombre del componente, su detalle, el `+$` de cada opción y el nombre del grupo.

Parece obvio y no lo era. Escribiendo con `replace()` de `useFieldArray`, los `Controller` de cada campo **no se re-sincronizan**: `useController` se suscribe con `exact: true`, así que la notificación de `replace` (que viaja con el nombre `components`) no le llega, y como las tarjetas conservan su posición en el DOM tampoco cambia el `name` que las obligaría a releer. Resultado: los datos se reordenaban y la pantalla no.

Dos síntomas, los dos verificados antes de arreglarlos:

- **Componentes sueltos**: ▲/▼ parecía no hacer nada mientras el array sí se reordenaba. Editar «el de arriba» le pisaba el nombre a otro componente y lo hacía desaparecer.
- **Opciones**: el `+$` quedaba pegado al índice viejo, así que la pantalla decía «Cerveza +$0 / Agua +$500» cuando el form tenía lo contrario. Toca plata (spec 29) y es justo lo que el encargado mira antes de guardar.

Por eso `applyComponents` —el único punto de escritura— usa `reset({ ...getValues(), components })`, que reconstruye el estado del form entero. Efecto lateral aceptado: los mensajes de validación se limpian al mover. Es preferible a dejarlos señalando la tarjeta equivocada, y vuelven a aparecer al intentar guardar.

## Decisiones

- **Botones ▲/▼ y no drag & drop.** El catálogo usa `@dnd-kit` ([`categorias-tab.tsx`](../../src/components/admin/catalog/categorias-tab.tsx)) y sería el precedente, pero acá hay **dos niveles anidados** (tarjetas y opciones dentro de un grupo) y el estado vive en `useFieldArray`, no en una lista suelta. Los botones son operables con teclado y con el dedo sin sensores extra, y se testean sin simular gestos. El `GripVertical` decorativo se va: prometía un arrastre que no existía.
- **Descartar la regla inválida en vez de bloquear el movimiento.** Prohibir mover mientras haya una regla sería más "seguro" pero deja al encargado sin salida del mismo modo. Mover es la operación que pidió; la regla es lo accesorio y se puede volver a tildar.

## Fuera de alcance

- Condicionar grupos **hacia atrás** (una opción que saque un grupo ya decidido). Sigue valiendo D-GCM-3 / FR-002 de la spec 074.
- Drag & drop.
- Reordenar menús entre sí en el listado (`daily_menus.sort_order`), que es otra pantalla.

## Criterios de aceptación

1. Con Entrada, Principal y Postre cargados, ▼ en Entrada la deja segunda y sus opciones viajan con ella.
2. El ▲ de la primera tarjeta y el ▼ de la última están deshabilitados.
3. Dentro de un grupo, ▼ en la primera opción la manda al segundo lugar y eso cambia qué opción es el atajo `1` del mozo.
4. Borrar un grupo de 4 opciones pide confirmación y se lleva las 4.
5. Si Principal condiciona a Guarnición y se sube Guarnición arriba de Principal, la regla se descarta con aviso y el menú se guarda sin error.
6. Agregar una opción a un grupo la deja pegada a las de su grupo, no al final del menú.
7. Después de mover una tarjeta con el teclado, el foco sigue en el botón que la mueve.
8. Mover un componente de texto **se ve**: los inputs cambian de lugar, no sólo el array.
9. Mover una opción con `+$` mueve su adicional con ella; la pantalla nunca muestra un adicional que no es el de esa opción.
10. `pnpm typecheck` y `pnpm test` en verde.
