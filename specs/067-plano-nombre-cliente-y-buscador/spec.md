# Feature Specification: El plano puede mostrar el nombre del cliente sentado + buscador de cliente al sentar

**Feature Branch**: `067-plano-nombre-cliente-y-buscador`

**Created**: 2026-07-30

**Status**: ✅ Implementado (2026-07-30) — `pnpm typecheck`, `pnpm lint` y `pnpm build` verdes; `pnpm test` 894 pass / 140 skip (los 16 `*.integration.test.ts` fallan por falta del stack Supabase local, preexistente). Migración `0029` aplicada al cloud y verificada por SQL. **Pendiente:** verify en vivo con rol real. Issue [#104](https://github.com/gachetponzellini/RestaurantOS-app/issues/104). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"hay que agregar la posiblidad a la hora de modificar un plano de que muestre el nombre del cliente sentado, y que no muestre lo otro… y ademas habria que hacer que cuando sienta a alguien aparezca el buscador de clent, y que bsuque solo clientes pq se quejaron, que aparecian productos ahi"*.

## Contexto y problema

**El plano.** Hoy una mesa ocupada muestra siempre lo mismo ([`floor-plan-viewer.tsx`](../../src/components/mozo/floor-plan-viewer.tsx)): el **número de mesa** grande y, debajo, el **tiempo abierto** (`45m`, `1h30`). Sirve para un local que opera por número de mesa. No sirve para uno que opera por nombre: en un club donde el encargado conoce a los socios, "Mesa 12" es un dato menos útil que "Gutiérrez", y el nombre existe (viene del walk-in o de la reserva) pero no se ve en el plano — hay que tocar la mesa para leerlo en el panel lateral.

**El buscador.** Al sentar un walk-in, el campo de nombre es un `<input>` de texto libre. Escribís "Gutiérrez" a mano incluso cuando Gutiérrez ya está en el CRM del negocio con su teléfono, sus direcciones y su historial. El negocio **ya tiene** la búsqueda de clientes ([`buscarClientes`](../../src/lib/admin/customers-actions.ts), spec 054) y la usa en «Cargar pedido» y en «Nueva reserva» — falta en el paso más frecuente de todos.

Sobre la queja de que *"aparecían productos"*: `buscarClientes` consulta **sólo** la tabla `customers`, nunca devolvió un producto. Lo que pasa es otra cosa, y es un problema de foco: en el sheet de cargar pedido conviven **dos** buscadores, y el que se lleva el foco al abrir es el de **productos**. El encargado empieza a tipear el nombre del cliente en la caja donde está el cursor y le salen milanesas. El arreglo real no es tocar la query: es que al **sentar** aparezca un buscador que busca clientes y **se ve** como tal.

## Requisitos

### FR-001 — Opción por salón: "mostrar el nombre del cliente"

El editor del plano ([`/admin/salones/[id]`](../../src/components/admin/floor-plan/floor-plan-editor.tsx)) suma un interruptor **«Mostrar el nombre del cliente en las mesas ocupadas»**, apagado por defecto. Se guarda con el resto del plano (`saveFloorPlan`) en una columna nueva de `floor_plans`.

Es **por salón**, no por negocio: un complejo puede querer nombres en el salón de socios y números en la terraza de paso.

### FR-002 — Con la opción activada, la mesa ocupada muestra SOLO el nombre

Decisión explícita de Juan ante las tres alternativas: **solo el nombre**. En una mesa ocupada con nombre conocido, el plano muestra el nombre del cliente y **nada más** — ni número de mesa ni tiempo abierto.

- **Mesa libre:** siempre su número. No hay cliente que mostrar y el encargado necesita poder nombrar la mesa al asignarla.
- **Mesa ocupada sin nombre** (walk-in anónimo, que es el default de `openTable`): cae al comportamiento de hoy — número + tiempo abierto. La opción no puede dejar una mesa **sin ninguna etiqueta**.
- El resto de las señales del plano (color de estado, punto de demora de cocina, badge de reserva, badge de mozo) **no se tocan**: son estado, no identidad.

### FR-003 — De dónde sale el nombre

El mismo criterio que ya usa el panel lateral del salón, extraído a un helper puro y testeado:

1. el `customer_name` de la **reserva** sentada en esa mesa, si hay;
2. si no, el `customer_name` de la **orden abierta**, salvo que sea un placeholder (`Mesa`, `Walk-in`, `-`), que no es un nombre;
3. si no, no hay nombre → FR-002, tercer caso.

### FR-004 — El nombre entra en la mesa

Un nombre largo no puede desbordar el dibujo ni encogerse hasta ser ilegible. Se muestra el **primer nombre / apellido** que entre y se trunca con elipsis según el ancho de la mesa. La tipografía escala con la mesa, como el número hoy.

### FR-005 — Al sentar aparece un buscador de clientes

El walk-in reemplaza el campo libre «Nombre» por un **buscador de clientes**: desde 2 caracteres consulta `buscarClientes` (debounce 300ms) y ofrece los resultados con nombre + teléfono. Elegir uno completa nombre y teléfono de una.

- **No es obligatorio elegir.** Lo tipeado vale como nombre del walk-in: un cliente nuevo no puede quedar bloqueado detrás de un buscador. Es la razón por la que esto es un buscador con texto libre y no un `<select>`.
- **Con un cliente elegido, el teléfono NO se edita** (FR-007).
- **Busca sólo clientes.** El componente es de clientes y sólo llama a `buscarClientes` — que consulta `customers` scopeada por `business_id` con gate de staff. Ningún camino de esta pantalla puede devolver un producto.
- **Teclado** (coherente con [spec 066](../066-teclado-operacion/)): ↓/↑ recorren los resultados, Enter elige el marcado, Escape cierra la lista sin cerrar el panel. Los atajos de cantidad de personas (`+`/`−`/dígitos) siguen sin aplicar mientras se escribe en un campo de texto.

### FR-007 — Elegido un cliente, su teléfono queda bloqueado

Feedback de Juan sobre la primera versión: *"el telofono, si elige un cliente no lo deberia de dejar de modificarlo, no tendria sentido"*. Correcto, y no es cosmético: el teléfono es **la clave con la que se identifica al cliente** (`sentarWalkIn` hace `upsert` por `(business_id, phone)`). Editarlo con un cliente elegido no le cambia el teléfono a ese cliente: apunta a **otro**, y crea uno nuevo sin que nadie se entere.

Con un cliente del CRM elegido, entonces:

- el campo Teléfono queda **de sólo lectura**, con el rótulo «Teléfono · del cliente elegido»;
- un botón **«Quitar»** suelta la identidad: limpia el teléfono y deja el nombre como texto libre. Es la salida cuando el contacto es otro;
- escribir a mano en el campo Cliente también suelta la identidad (dejaste de ser ese cliente).

Actualizarle el teléfono a un cliente existente es una operación de **CRM** y vive en su ficha, no en el camino caliente de sentar gente.

**La misma regla se aplica a las otras dos superficies que eligen cliente**, que tenían el mismo agujero: «Cargar pedido» ([`cargar-pedido-sheet.tsx`](../../src/components/admin/cargar-pedido-sheet.tsx)) y «Nueva reserva» ([`new-reservation-modal.tsx`](../../src/components/admin/local/new-reservation-modal.tsx)). Arreglar sólo el walk-in habría dejado dos lugares con exactamente el problema que Juan señaló.

### FR-006 — Nada más cambia

No se toca `sentarWalkIn` ni su contrato: elegir un cliente existente sólo **prellena** nombre y teléfono, y el upsert por teléfono que ya hace la acción se encarga del resto (idempotente por `(business_id, phone)`). Sin columna nueva en `orders`, sin vínculo `order → customer_id` nuevo.

## Decisiones

**D1 — Por salón, en el editor del plano, no en Configuración.** Es una propiedad de cómo se dibuja *ese* plano, igual que la imagen de fondo o su opacidad. Ponerlo en la config del negocio lo volvería global y perdería el caso "socios sí, terraza no".

**D2 — "Solo el nombre" con fallback obligatorio.** Es lo que pidió Juan, pero una mesa sin etiqueta ninguna sería un bug de usabilidad, no una decisión de diseño: por eso FR-002 fija el fallback a número + tiempo cuando no hay nombre. La opción cambia *qué* se muestra, nunca deja de mostrar algo.

**D3 — El fix de "aparecían productos" es de foco, no de query.** Se verificó: `buscarClientes` sólo lee `customers`. Poner el buscador de clientes en el momento de sentar ataca la causa (el encargado tipeando un nombre en la caja de productos porque era la que tenía el cursor). Reordenar el foco dentro del sheet de cargar pedido (que hoy arranca en el buscador de productos) es otra discusión y **queda pendiente**.

**D4 — Elegir un cliente no crea un vínculo nuevo.** Prellenar nombre + teléfono aprovecha el upsert que `sentarWalkIn` ya hace. Un `orders.customer_id` explícito sería más rico (historial por mesa) pero es cambio de datos y de contrato para un beneficio que nadie pidió todavía.

## Alcance

**Toca:**
- `supabase/migrations/0029_floor_plan_mostrar_nombre_cliente.sql` **(nueva)** — `floor_plans.show_customer_name boolean not null default false`.
- `src/lib/reservations/types.ts` + `schema.ts` — el campo en `FloorPlan` y en `SaveFloorPlanInputSchema`.
- `src/lib/admin/floor-plan/actions.ts` — persistirlo.
- `src/components/admin/floor-plan/use-floor-plan-store.ts` + `floor-plan-editor.tsx` — el interruptor.
- `src/lib/mozo/table-display-name.ts` **(nuevo)** + test — el helper puro de FR-003.
- `src/components/mozo/floor-plan-viewer.tsx` — render del nombre (FR-002/004).
- `src/components/admin/local/salon-desktop.tsx` — pasa `customerName` en los extras y reusa el helper.
- `src/components/mozo/customer-search-field.tsx` **(nuevo)** — el buscador de clientes.
- `src/components/mozo/walk-in-modal.tsx` — lo usa en lugar del input libre; teléfono bloqueado con cliente elegido.
- `src/components/admin/cargar-pedido-sheet.tsx` y `src/components/admin/local/new-reservation-modal.tsx` — misma regla de teléfono bloqueado (FR-007).

**No toca:** `sentarWalkIn`, `buscarClientes`, el orden del foco dentro del sheet de cargar pedido (la causa real de "aparecían productos" — queda pendiente), colores de estado, demora, motor de reservas.

> ⚠️ **Solapamiento con [spec 066](../066-teclado-operacion/) ([#103](https://github.com/gachetponzellini/RestaurantOS-app/issues/103)).** `walk-in-modal.tsx` y `salon-desktop.tsx` están siendo editados en paralelo por esa spec. Juan decidió avanzar igual sobre el mismo working tree. Las ediciones de esta spec son aditivas y en regiones distintas.
