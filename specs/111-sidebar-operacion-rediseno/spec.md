# Feature Specification: El sidebar operacional, rediseñado

**Feature Branch**: `111-sidebar-operacion-rediseno`

**Created**: 2026-08-11

**Status**: 🟢 Listo para implementar — decisiones D1-D4 cerradas con Juan (2026-08-11, §Decisiones).

**Input**: Pedido de Juan — *"el sidebar operacional: que sea más ancho, dos columnas con los ítems ya pedidos a la izquierda con máximo detalle (modificadores por ítem), disminuir la cantidad de clicks para comandar, que el nombre y apellido al sentar sean opcionales (que vayan a los 3 puntos), y que al tocar una mesa vacía aparezca enfocado el input de cargar ítem. Que contemple también el sidebar de los pedidos."*

## Contexto y problema

El `<aside>` de `/admin/operacion` ([salon-desktop.tsx:1492](../../src/components/admin/local/salon-desktop.tsx#L1492)) es donde el encargado vive el turno entero: es lista de entrada, detalle de mesa, abrir mesa, cargar pedido, cuenta y cobro — seis modos en el mismo marco.

**Mide 480px fijos** ([salon-desktop.tsx:1396](../../src/components/admin/local/salon-desktop.tsx#L1396) — `lg:grid-cols-[1fr_480px]`). El ancho es único a propósito: se fijó en el del modo más denso (cobro) porque antes crecía por modo y el panel "saltaba" al entrar a cobrar. En un monitor de 1920 eso es **25% de la pantalla para la tarea principal y 75% para un plano que no cambia**.

Adentro de ese ancho, el modo de carga ([pedir-client.tsx:1027](../../src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx#L1027)) apila **una sola columna**: header → buscador → catálogo con scroll → carrito con `max-h-44` (176px, ~3 ítems visibles) → total + Enviar. Consecuencias:

- **Lo ya pedido no se ve.** De todo lo enviado a cocina, el panel de carga muestra **un número** al lado de un ícono ([pedir-client.tsx:1066](../../src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx#L1066)). Para ver qué comió la mesa hay que salir a Cuenta — es decir, salir del modo de carga. El `ResumenStep` que sí lo lista completo sólo existe en el full-screen del mozo, no en el sidebar.
- **El carrito y el catálogo se pelean 40 líneas de alto.** Con 6 ítems cargados, el carrito scrollea dentro de 176px mientras a la derecha sobran 1400px de pantalla vacía.

Y el camino para comandar en una mesa libre son **tres clicks y un formulario**:

| # | Hoy | |
|---|---|---|
| 1 | tap en la mesa del plano | → `TableDetail` |
| 2 | «Sentar walk-in» | → `WalkInPanel` |
| 3 | «Abrir Mesa N» (Enter) | → encadena a cargar pedido ([salon-desktop.tsx:1647](../../src/components/admin/local/salon-desktop.tsx#L1647)) |
| 4 | tipear | el buscador recién acá se lleva el foco |

Ese paso 2-3 es un formulario de tres campos —Personas, Cliente, Notas— del que **nada es obligatorio**… y del que, además, hay un hallazgo:

## Hallazgos del relevamiento

1. **`party_size` del walk-in no se persiste en ninguna parte.** `sentarWalkIn` lo valida con Zod y no lo usa: no se lo pasa a `openTable` ([walk-in.ts:123](../../src/lib/mozo/walk-in.ts#L123)) y no existe columna — `party_size` sólo está en `reservations` y `reservation_settings` (`0001_baseline.sql`). El control más prominente del formulario (6 botones + stepper + atajos 1-9/+/−) escribe en el vacío. **Guardar cubiertos requiere migración**; sacarlo del camino crítico, no.
2. **`enviarComanda` ya abre la mesa solo.** Si la mesa está `libre`, la pasa a `ocupada`, fija `opened_at` y crea la `order` si no existe ([comandas/actions.ts:869](../../src/lib/comandas/actions.ts#L869) y [:388](../../src/lib/comandas/actions.ts#L388)). O sea: **entrar a cargar sin abrir la mesa antes ya funciona hoy**, sin tocar el server.
3. **…pero la apertura diferida perdería el mozo.** `openTable` auto-asigna `tables.mozo_id` al actor si la mesa no tenía ([open-table.ts:52](../../src/lib/mozo/open-table.ts#L52)); `enviarComanda` **no toca `tables.mozo_id`**. Una mesa abierta por el envío quedaría sin mozo en el plano, en la distribución y en la rendición. Es el único cambio de server que exige la fase 3.
4. **La plata por ítem ya está en la base, falta traerla.** `ComandaItemSnapshot` ([comandas/types.ts:38](../../src/lib/comandas/types.ts#L38)) trae nombre, cantidad, notas, modificadores, sector y estado de cocina, pero **no precio**; `order_items` sí tiene `unit_price_cents`, `subtotal_cents` y `seat_number`. La columna izquierda con total por línea es ampliar un `select`, no una migración.
5. **Son tres superficies de carga, no una.** El mismo patrón vive en el sidebar del salón (`MozoPedirClient embedded`), en el sheet del board de pedidos ([cargar-pedido-sheet.tsx](../../src/components/admin/cargar-pedido-sheet.tsx), 959 líneas, mostrador/delivery) y en `VentaRapidaPanel`. La spec 068 ya unificó buscador y resultados; el layout sigue copiado.

## Requirements *(mandatory)*

### Fase 1 — Ancho

- **FR-001** *(D1)*: El panel pasa de 480px fijos a un ancho **fluido con piso y techo**: `lg:grid-cols-[minmax(0,1fr)_minmax(560px,44%)]`, con techo duro (`max-w-[900px]`) para que en un ultrawide el plano no quede en una franja.
- **FR-002**: **El ancho sigue siendo único para todos los modos** (invariante de la decisión previa: el panel no puede saltar al cambiar de modo). Los modos que hoy están calibrados a 480 —lista de entrada, `TableDetail`, cobro, cuenta— no pueden quedar con una columna estirada: el contenido va con `max-w` propio o pasa a dos columnas donde tenga sentido. **Esta es la parte del trabajo que se subestima**: son seis modos, no uno.
- **FR-003**: Por debajo de `lg` no cambia nada (el plano ya se apila y el panel es full-width).

### Fase 2 — Dos columnas en el modo de carga

- **FR-004**: Con el panel ancho, el modo de carga se parte en dos columnas: **izquierda «Lo pedido»** (42% del panel, tope 380px), **derecha la carga** (buscador + catálogo + carrito + Enviar). *(Al implementarlo: el corte es `@3xl` = **768px de panel**, o sea ~1745px de viewport. Más abajo dos columnas darían ~280px cada una y no entra el detalle por ítem. Debajo de ese corte «Lo pedido» no desaparece: se abre como **hoja sobre el catálogo** con un botón en el header — sigue sin haber que salir a Cuenta, que es lo que la spec vino a arreglar.)*
- **FR-005**: La izquierda muestra, por ítem enviado: producto, cantidad, **modificadores elegidos** (`modifiers[]`, hoy visibles sólo en la cuenta y en la comanda de cocina), nota, precio de línea (hallazgo 4), sector y **estado de cocina** (pendiente / en preparación / listo / entregado), agrupado por comanda con su hora. Los cancelados se muestran tachados con el motivo, no se ocultan.
- **FR-006**: La izquierda cierra con **el total de la mesa hasta ahora**, separado del «Total a enviar» del carrito. Son dos números distintos y hoy el panel sólo muestra el segundo.
- **FR-007** *(D4)*: Las acciones sobre lo enviado son **entregar comanda y cancelar ítem** (con permiso), con el mismo overlay optimista que ya tiene `pedir-client`. **Editar un ítem enviado queda afuera**: es de la spec 110 y se cruza con la comanda ya impresa.
- **FR-008**: El carrito deja de estar encerrado en `max-h-44`: crece con la columna y scrollea sólo cuando de verdad no entra.
- **FR-009**: El recorrido de teclado sigue siendo el de las specs 055/075: buscador → resultados → carrito → Enviar. La columna izquierda queda **fuera de la cadena de flechas** y se alcanza con Tab. *(Al implementarlo: no se le puso `useRovingList` — sin una tecla de entrada propia sería una zona muerta, y meterla en la cadena alargaría justo el recorrido que las 055/075 acortaron. Mirar lo ya pedido es una consulta, no un paso de la carga.)*

### Fase 3 — Menos clicks para comandar

- **FR-010**: **Tap en una mesa libre entra directo al modo de carga, con el foco en el buscador.** Sin formulario de walk-in en el medio. De 3 clicks + Enter a **1 click y tipear**.
- **FR-011**: La mesa se abre **al enviar la primera comanda** (hallazgo 2), no al tocarla: un tap accidental no ensucia el salón con mesas abiertas. Salir sin enviar no deja rastro.
- **FR-012**: Al abrir por envío, **la mesa se auto-asigna al actor si no tenía mozo** — la regla de `openTable` (hallazgo 3), aplicada en `enviarComanda` para que el plano, la distribución y la rendición no pierdan el dato.
- **FR-013** *(D3)*: **«Personas» es lo primero del panel de carga** — una fila de chips 1-9 arriba del buscador, con 2 por defecto. Es **un tap, no un paso**: no tiene pantalla propia, no bloquea, y el foco arranca igual en el buscador (FR-010). Con el cursor en el buscador los dígitos escriben texto, así que acá es tap; los atajos 1-9/+/− siguen viviendo en el walk-in con formulario (FR-016).
- **FR-014** *(D3)*: **«Personas» se guarda de verdad.** Migración: `orders.party_size` (int, nullable). Lo escriben el walk-in con formulario, los chips de FR-013 y «Datos de la mesa». Sin esto el control seguiría siendo decorativo (hallazgo 1) — que es justo lo que esta spec viene a arreglar.
- **FR-015**: **Nombre y teléfono salen del camino.** El bloque `CustomerFields` pasa a una acción **«Cargar cliente»** en el menú ⋯ (`MesaOptionsMenu`), disponible antes y después de enviar. Un ítem del menú, no un paso — y ya no se pide nada del cliente para sentar a alguien.
- **FR-016**: El camino de mesa con reserva **no cambia**: si la mesa tiene reserva, tocarla sigue ofreciendo «Sentar reserva» (el bloqueo blando de la spec 059 se conserva).
- **FR-017** *(D2)*: **`TableDetail` sigue existiendo** tal cual para la mesa ocupada: se toca sólo para que respire con el ancho nuevo. El click que se ahorra es el de la mesa libre.
- **FR-018**: El walk-in con formulario **sigue existiendo** —desde el ⋯ y en la app del mozo en mobile (`WalkInModal`), con sus atajos de teclado—: se saca del camino por defecto, no del producto.

### Fase 4 — El sidebar de los pedidos

- **FR-019**: `CargarPedidoSheet` (mostrador/delivery) hereda ancho (`max-w-md` → `xl:max-w-[900px]`) y dos columnas. *(Al implementarlo: izquierda **cliente y entrega**, derecha **buscador + catálogo + carrito**. El carrito se quedó pegado al catálogo del que se carga —igual que en el salón— en vez de irse a la izquierda: moverlo hubiera dejado dos totales en pantalla o un carrito lejos de donde se agrega. La izquierda es el contexto del pedido, que es el análogo de «Lo pedido» en una superficie sin comandas previas.)*
- **FR-020**: **Se elimina el paso «datos»** (`view: "carga" | "datos"`): con dos columnas, cliente + entrega + cuándo entran a la vista sin un segundo paso. Es el mismo click de menos que la fase 3, en la otra superficie. *(Al implementarlo: el paso sigue existiendo **debajo de `xl`**, donde las dos columnas no entran; ahí sacarlo dejaría el formulario sin lugar. `⌘Enter` lo sabe: ancho confirma, angosto encadena los dos pasos como antes.)*
- **FR-021**: `VentaRapidaPanel` queda alineado en ancho y densidad (no necesita las dos columnas: no tiene cliente ni comandas previas).
- **NFR-001**: Nada de esto toca el kanban de comandas ni el flujo de cobro más allá de que respiren con el ancho nuevo.

### Fase 5 — el panel limpio *(pedido de Juan, 2026-08-12, sobre las fases 1-4 andando)*

Con las dos columnas a la vista quedó claro que la de carga seguía siendo la de antes con menos cosas, y que el detalle de mesa —un modo aparte— era una pantalla de paso. El pedido: *«que sea solo el buscador, con los más pedidos, que no te deje elegir categoría; lo de carta online tiralo para arriba como lo de los planos; más grande todavía; el detalle de mesa tiene que ser la columna izquierda; la parte de "Tu pedido" no debería aparecer; y que se note lo que todavía no mandaste».*

- **FR-022**: La columna de carga es **sólo el buscador y los resultados**. Se va el selector de categoría: con el buscador tolerante (acentos, plural, palabras en cualquier orden) elegir categoría es un rodeo de dos taps para llegar a lo mismo. Sin búsqueda se ven **sólo los más pedidos** — el panel es para cargar rápido lo que sale todo el tiempo; para el resto está el buscador. Único caso en que se muestra la carta entera: **negocio sin historial de ventas**, donde «los más pedidos» está vacío y la alternativa es una pantalla en blanco.
  > **Hallazgo (2026-08-12).** «Más pedidos» venía filtrado por la supercategoría `principales`, con el argumento de que bebidas y entradas tenían su tab dedicado. Los tabs ya no existen, y esa supercategoría **no existe en ningún negocio** (las supers son bebidas, cafetería, entradas-y-minutas, parrilla, pastas, pescados, picar, platos, postres, vinos): el filtro nunca corrió, pero quedaba de trampa — el día que alguien creara una super llamada «principales», la única lista del panel se habría quedado sin bebidas sin que nadie tocara nada. Se sacó.
- **FR-023**: El filtro de la carta online sube al **header del panel**, como **desplegable a la derecha de la fila del negocio** —alineado con el selector de salones de la barra de arriba— con su misma cara (ícono + label + chevron, ámbar cuando filtra). Es contexto de la PC —se elige una vez por turno y queda pegado—, no un control del buscador. Que cante cuando está puesto no es cosmético: en golf-jcr **10 de 11 gaseosas, 32 de 32 de cafetería y 32 de 32 de kiosko están fuera de la carta online**, así que un filtro en «En la carta online» y mudo esconde media carta.
- **FR-024**: **«Tu pedido» desaparece de la columna de carga.** El carrito se muda a la de la mesa, pegado a lo enviado: comparar dos listas en dos lados de la pantalla era el trabajo que hacía el que carga.
- **FR-025**: En la columna de la mesa, **lo sin enviar se distingue de lo enviado**: bloque propio, verde y con borde grueso. Confundirlos es servir de menos o mandar dos veces.
- **FR-026**: La columna izquierda pasa a ser **la mesa entera**: título, estado, minutos, orden, personas · lo enviado por tanda · lo sin enviar · total · acción primaria (**Enviar** si hay pendientes, **Cobrar** si no) y el ⋯ con cliente, transferir, trasladar y anular. Es la foto que pasó Juan, con el carrito adentro.
- **FR-027**: **`TableDetail` deja de ser un modo del panel** (revisa D2): tocar una mesa —libre u ocupada— entra a cargar, y la mesa se ve al lado. El detalle sobrevive para lo que la carga no cubre: **mesa con reserva** (donde «Sentar reserva» tiene que ganar, FR-016) y roles sin permiso de carga.
- **FR-028**: Más ancho: **50% del split**, piso 620 / techo 1100, y el corte de dos columnas baja a `@2xl` (672px **de panel**) para que una notebook de 1440 ya las vea.
- **NFR-002**: La cadena de teclado de las specs 055/075 no cambia: buscador → resultados → carrito → enviar. El carrito cambió de lado, no de lugar en el recorrido (`cartZone` viaja a la columna).

**Hallazgo al mover las acciones:** entregar una comanda desde el detalle disparaba el refetch del salón (spec 102); al mudarse a la columna, el plano se habría quedado con las demoras viejas. Se agregó `onMesaActualizada` — entregar y anular avisan al salón sin cerrar el panel.

## Decisiones *(cerradas con Juan, 2026-08-11)*

| # | Decisión | Resuelto | |
|---|---|---|---|
| **D1** | Cuánto ancho | **44% fluido**, piso 560 / techo 900 | FR-001 |
| **D2** | Qué pasa con `TableDetail` | Sigue existiendo (fase 3) → **revisado en la fase 5**: con la mesa entera en la columna izquierda, el detalle como modo aparte quedó sin razón de ser. Sobrevive para mesa con reserva y roles sin permiso de carga | FR-017 → FR-027 |
| **D3** | «Personas» | **Se queda y se guarda** (migración `orders.party_size`), y es **lo primero del panel de carga** — chips arriba del buscador, sin nombre ni nada más al lado. Cargar al cliente pasa a ser una opción del ⋯ | FR-013/014/015 |
| **D4** | ¿Editar lo ya enviado? | **No**: sólo entregar y cancelar. Editar es de la spec 110 | FR-007 |

## Riesgos

- **Regresión de teclado.** El panel tiene ocho zonas de `useRovingList` encadenadas (specs 055/075/110) y una suite grande que las cubre. Partir el layout en dos columnas es exactamente el tipo de cambio que rompe el encadenado sin romper un test. → FR-009 explícito + correr `salon-desktop.keyboard`, `product-search-box`, `product-modal.teclado` y `walk-in-modal` antes de dar nada por hecho.
- **Seis modos, un ancho.** El riesgo real de la fase 1 no es el panel de carga: es cobro con sus KPI, la lista de reservas y `TableDetail` estirándose feo.
- **Apertura diferida y estados de mesa.** FR-011 cambia *cuándo* una mesa pasa a ocupada. Hay que revisar el kanban, las demoras, `anularMesa` y la rendición con una mesa "en carga" que todavía figura libre.
- **`pedir-client.tsx` ya son 2218 líneas** y `salon-desktop.tsx` 2866. Esta spec agrega layout a los dos. Extraer la columna «Lo pedido» a su propio componente es parte del trabajo, no un extra.

## Tasks

- [x] **T0** — Cerrar D1-D4 con Juan.
- [x] **T1** — Fase 1: ancho fluido + los nueve modos revisados a ese ancho (27 arreglos, todos con container queries: a 480px no cambia nada).
- [x] **T2** — Fase 2a: datos de «Lo pedido» — `getLoPedido` + `TableOrderState` en el mismo viaje que las comandas, y `unit_price_cents`/`subtotal_cents`/`seat_number` en `ComandaItemSnapshot`.
- [x] **T3** — Fase 2b: `lo-pedido.ts` (agrupación por tanda, puro, 10 tests) + `LoPedidoColumn`.
- [x] **T4** — Fase 2c: `LoPedidoColumn` cableada, dos columnas a partir de `@3xl` (768px **de panel**) y carrito que crece con el ancho.
- [x] **T5** — Fase 3a: `enviarComanda` auto-asigna mozo al abrir mesa libre (FR-012) + 2 tests de integración.
- [x] **T6** — Fase 3b: tap/Enter en mesa libre → carga con foco en el buscador (FR-010/011), en el plano y en la lista. Test nuevo; el de «Esc devuelve el foco» pasó a mesa ocupada porque codificaba el camino viejo.
- [x] **T7** — Fase 3c: migración 0045 `orders.party_size` (aplicada al cloud) escrita por los tres caminos, chips de Personas arriba del buscador (FR-013/014) y «Cargar cliente» en el panel y en el ⋯ del detalle (FR-015).
- [x] **T8** — Fase 4: `CargarPedidoSheet` a dos columnas desde `xl`, sin paso «datos» (FR-019/020). `VentaRapidaPanel` ya había quedado alineado en T1 (FR-021).
- [x] **T10** — Fase 5: columna de carga sólo con buscador + más pedidos, filtro de carta online arriba, «Tu pedido» fuera, `MesaColumn` con lo enviado vs lo sin enviar y las acciones de la mesa, ancho al 50% (FR-022…028) + 8 tests nuevos.
- [ ] **T9** — `pnpm typecheck` + suite + build; **verificar en vivo con rol real** (encargado, no service_role).

## Verify

- Un turno simulado completo en `/admin/operacion` con rol **encargado**: mesa libre → cargar → enviar → agregar → entregar → cobrar, todo sin salir del panel y sin mouse.
- Que la mesa abierta por envío tenga mozo asignado en el plano (FR-012).
- Que el panel **no cambie de ancho** al pasar por los seis modos (FR-002).
- Que las personas queden guardadas en la orden, cargadas por cualquiera de los tres caminos (chips, walk-in con formulario, ⋯).
