# Feature Specification: Operación keyboard-first — abrir mesa con + / −, walk-in en el sidebar y resultados que bajan de verdad

**Feature Branch**: `066-teclado-operacion`

**Created**: 2026-07-30

**Status**: 🚧 En implementación. Issue [#103](https://github.com/gachetponzellini/RestaurantOS-app/issues/103). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"hay que seguir mejorando la navegabilidad a la hora de manejar la parte de operacion, que sea lo mejor posible, al abrir una mesa, el mas y el menos deberia ser teclable con el + y -, y capaz abria que embeber esa vista tambien en el sidebar, que al tocar enter abra lo mesa nomas, despues cuando esta cargando producto, si te moves con la flecha no se mueve bien como que vas para abajo y te va para el costado"*.

## Contexto y problema

La [spec 055](../055-carga-pedido-teclado/) dejó **la carga de pedido** keyboard-first dentro del sidebar del salón: buscador con foco, ↓/↑/Enter sobre los resultados, `ProductModal` operable sin mouse. Funcionó, y por eso ahora se nota lo que quedó afuera del mismo recorrido.

El recorrido completo del encargado en `/admin/operacion → Mesas` es: **elegir mesa → abrirla → cargarle productos**. Los pasos 1 y 3 ya son de teclado; el 2 no.

**Abrir la mesa.** `WalkInModal` ([`walk-in-modal.tsx`](../../src/components/mozo/walk-in-modal.tsx)) es un modal `fixed` que cubre el viewport entero, sin foco inicial y sin atajos. El stepper de personas —el único campo obligatorio— sólo se mueve con el mouse. En el 90% de los casos el encargado quiere exactamente "mesa para 2, dale": hoy eso son tres clicks y un viaje de la mano al mouse en medio de un flujo que ya era de teclado.

Además rompe la regla de layout que el propio panel estableció: cargar pedido, cuenta, cobro y venta rápida ya viven **dentro del `<aside>`** del salón (`salon-desktop.tsx`, cadena de modos del panel lateral). Walk-in es el único paso del recorrido que todavía tapa el plano con un overlay.

**Bug de la flecha.** Los resultados de búsqueda se renderizan en `grid grid-cols-2`, pero el índice del teclado se mueve con `moveSelection(i, ±1)`. En una grilla de 2 columnas, `+1` es **la celda de al lado**, no la de abajo. Resultado: apretás ↓ y la selección se va al costado; apretás ↓ de nuevo y recién ahí baja (a la columna equivocada). Está en los tres buscadores que comparten el patrón de la spec 055:

| Dónde | Archivo |
|---|---|
| Mesa (sidebar y full-screen del mozo) | [`pedir-client.tsx`](../../src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx) · `SearchResults` |
| Para llevar / delivery | [`cargar-pedido-sheet.tsx`](../../src/components/admin/cargar-pedido-sheet.tsx) |
| Venta rápida de mostrador | [`venta-rapida-panel.tsx`](../../src/components/admin/local/venta-rapida-panel.tsx) |

## Requisitos

### FR-001 — Los resultados de búsqueda son una lista de una columna

Mientras hay texto en el buscador, los resultados se muestran en **una sola columna**, no en grilla. Con eso ↓ baja y ↑ sube, que es lo único que el usuario espera.

Se descartó la alternativa —mantener la grilla y mover ±columnas con ↓/↑, ±1 con ←/→— porque el foco vive en el `<input>` de búsqueda: secuestrar ←/→ le saca al usuario el cursor del texto que está tipeando, que es peor que el bug original.

La densidad no se pierde: la fila compacta (nombre + precio en una línea, ~48px) muestra tantos resultados por pantalla como la grilla de dos columnas de 84px de alto.

El **catálogo por categoría** (sin búsqueda activa) conserva la grilla de 2 columnas: ahí no hay índice de teclado, es una superficie de toque.

### FR-002 — La fila seleccionada siempre queda a la vista

Al moverse con ↓/↑, la fila seleccionada hace `scrollIntoView({ block: "nearest" })`. Ya estaba en `pedir-client`; falta en los otros dos.

### FR-003 — Un solo componente de resultados para los tres buscadores

Los tres renders de resultados se unifican en un componente compartido. Es la condición para que el bug no vuelva por la tercera copia: hoy la misma lista está escrita tres veces con tres estilos ligeramente distintos.

### FR-004 — Abrir mesa: `+` / `−` mueven la cantidad de personas

En el walk-in, con el foco en cualquier lado del panel que no sea un campo de texto:

- `+` (y `=`, que es la misma tecla sin Shift) → +1 persona, tope 20.
- `−` → −1 persona, piso 1.
- `1`…`9` → fija esa cantidad directo.

Los dígitos son el atajo real del caso común (una mesa de 4 se carga tecleando `4`), y el mismo patrón que ya usa `ProductModal` para la cantidad de un producto (spec 055 fast-follow).

Escribiendo en Nombre / Teléfono / Notas los atajos no aplican: ahí `-` es un guion y `4` es un cuatro.

### FR-005 — Enter abre la mesa

Al abrirse el walk-in, el foco va al botón **Abrir mesa**. Enter lo dispara. El caso "mesa para 2, dale" es: mesa → Enter → Enter.

Enter dentro de los campos de texto también envía (comportamiento nativo del `<form>`, ya funciona hoy).

### FR-006 — El walk-in vive en el sidebar del salón

En `/admin/operacion → Mesas`, "Sentar walk-in" abre un **panel dentro del `<aside>`**, no un overlay: mismo header con botón de volver, mismo ancho, el plano del salón sigue visible al lado. Entra en la cadena de modos del panel con la misma prioridad que "cargar pedido" (después de cobro/cuenta, antes del detalle de mesa).

Esc y el botón de volver cierran el panel y devuelven el detalle de la mesa.

En **la app del mozo** (`/mozo`, mobile) el walk-in sigue siendo el modal de siempre: ahí no hay sidebar y el overlay es la forma correcta. Un solo componente de formulario, dos envoltorios.

### FR-007 — Seleccionar una mesa enfoca su acción primaria

Al seleccionar una mesa en el plano, el foco pasa al botón de la acción primaria del detalle (Sentar walk-in / Sentar reserva / Cargar pedido / Cobrar). Así Enter continúa el flujo sin tocar el mouse, que es lo que cierra el recorrido: click en la mesa → Enter → Enter.

El foco se pide con `preventScroll: true` para que el sidebar no salte.

## Fuera de alcance

- Navegar el **plano de mesas** con flechas (elegir mesa sin mouse). Es la pieza que falta para un recorrido 100% de teclado, pero implica un orden espacial sobre el plano y merece su propia spec.
- Atajos globales de la operación (tipo `g m` para ir a Mesas).
- Cambiar el layout del catálogo por categoría.

## Criterios de aceptación

1. Buscando un producto en cualquiera de los tres buscadores, ↓ baja una fila y ↑ sube una fila. Nunca se mueve al costado.
2. Con más resultados de los que entran en pantalla, ↓ hasta el final scrollea la lista.
3. En el walk-in del salón, `+`/`−`/dígitos mueven Personas sin tocar el mouse; escribiendo en Notas, no.
4. Mesa libre seleccionada → Enter → panel de walk-in → Enter → mesa abierta, todo sin mouse.
5. El walk-in del salón no tapa el plano; el del mozo sigue siendo modal.
6. `pnpm typecheck` y `pnpm test` en verde.
