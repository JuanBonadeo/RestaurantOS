# Feature Specification: Cargar el menú del día por pasos, todo con el teclado

**Feature Branch**: `072-menu-del-dia-por-pasos`

**Created**: 2026-07-30

**Status**: 🚧 En implementación. Issue [#108](https://github.com/gachetponzellini/RestaurantOS-app/issues/108). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"a la hora de cargar un menu para una mesa, la ui/ux sea mucho mejor, primero se carga la entrada, que te deja elegir los productos bajando y subiendo la flechitas, entrando con el primer producto focuseado, tiene que ser muy amigable con las flechitas y el enter, todo manejable desde el teclado"*.

## Contexto y problema

Las specs [055](../055-carga-pedido-teclado/) y [066](../066-teclado-operacion/) dejaron la carga de **productos sueltos** operable sin mouse: buscador con foco, ↓/↑/Enter sobre los resultados, `ProductModal` con foco inicial, focus-trap y `+`/`−` para la cantidad.

El **menú del día** quedó afuera. `DailyMenuModal` (hoy adentro de [`pedir-client.tsx`](../../src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx), ~220 líneas) es una hoja larga que muestra **todos** los grupos de opciones a la vez, sin foco inicial, sin atajos y sin scroll dirigido. Para un menú de entrada + principal + postre el mozo tiene que scrollear la hoja entera y dar tres toques de mouse antes de poder agregar. Es el ítem más caro de cargar del sistema y el único paso del recorrido que todavía obliga a soltar el teclado.

Además la hoja mezcla dos cosas distintas en la misma pantalla: lo que el menú **incluye** (componentes fijos, informativo) y lo que hay que **decidir** (los `choice_group`). Con tres grupos de seis opciones cada uno, lo que hay que decidir queda enterrado.

El modelo de datos ya da todo lo necesario — cada grupo es una decisión obligatoria de exactamente una opción sobre productos reales (D-MDR-4 / D-MDR-6, ver [`wiki/features/menu-del-dia.md`](../../../../wiki/features/menu-del-dia.md)) — así que la carga es literalmente un asistente de N pasos y hoy se dibuja como un formulario plano.

## Requisitos

### FR-001 — Un paso por grupo de opciones, en orden

Al abrir un menú del día, el panel arranca en el **primer grupo de opciones** (la entrada) y muestra **sólo ese grupo**. Al resolverlo pasa al siguiente, y así hasta el último; después viene el paso de confirmación (FR-005). El orden es el de `sort_order` de los componentes, que es el que el encargado definió en el admin.

El header de cada paso dice de qué se trata y dónde está parado: nombre del menú, label del grupo (`choice_group_label`) y `Paso N de M`, con puntitos de progreso.

Un menú **sin** grupos de opciones (todo fijo) abre directo en el paso de confirmación: no hay nada que decidir.

### FR-002 — Se entra con la primera opción enfocada

Al abrirse un paso, el **foco real del DOM** queda en la primera opción del grupo (`focus({ preventScroll: true })`), no en el contenedor ni en el botón de cerrar. Enter la elige sin tocar nada más.

Si el paso ya tenía una opción elegida (porque el usuario volvió atrás), el foco arranca en **esa** opción, no en la primera.

### FR-003 — ↓/↑ mueven, Enter elige y avanza

Sobre las opciones de un paso:

- `↓` / `↑` mueven el foco una opción, con clamp (sin wrap-around) — mismo criterio que los resultados del buscador.
- `Home` / `End` van a la primera / última.
- `Enter` (y `Espacio`, que es la activación nativa del botón) elige la opción enfocada **y avanza** al paso siguiente.
- `1`–`9` eligen esa opción por posición y avanzan, sin pasar por las flechas.
- `←` y `Backspace` vuelven al paso anterior.
- `Esc` cierra el panel entero.

Las opciones son una **lista de una columna**, por el mismo motivo que la spec 066: en grilla, `↓` se va al costado.

### FR-004 — La opción muestra su adicional y se ve cuál está elegida

Cada fila: número de posición (el atajo `1`–`9`), nombre del producto real, y `+$X` cuando la opción tiene `extra_price_cents > 0` (spec 29). La opción ya elegida queda marcada con el check, aunque el foco esté en otra.

El total del pie se recalcula en vivo: precio del menú + Σ adicionales elegidos, por cantidad.

### FR-005 — Paso final: qué queda armado, cuántos y Enter para agregar

El último paso muestra:

- **Incluye** — los componentes fijos (`text` / `product`), informativos.
- **Elegiste** — una fila por grupo resuelto, con su adicional. Cada fila es focusable: Enter sobre ella vuelve a ese paso para cambiar la elección (y al confirmar de nuevo se vuelve derecho al paso final, sin repetir los pasos que ya estaban resueltos).
- **Cantidad**, con `+`/`−` por teclado además de los botones — mismo atajo que `ProductModal` y que el walk-in.
- Botón **Agregar $total**, que recibe el foco al llegar al paso. Enter lo dispara.

El botón sólo se habilita con todos los grupos resueltos; por construcción del asistente, al llegar al paso final siempre lo están.

### FR-006 — Sigue siendo usable con el dedo

El mismo componente sirve al mozo en el celular: las filas son targets grandes (≥48px), el toque sobre una opción hace lo mismo que Enter (elige y avanza), y hay botón de volver y de cerrar visibles. Los atajos de teclado se muestran como pista sólo en el panel embebido del salón (desktop), donde hay teclado de verdad.

### FR-007 — El asistente vive en su propio archivo

`DailyMenuModal` sale de `pedir-client.tsx` (2300 líneas) a `src/components/mozo/daily-menu-wizard.tsx`, y la lógica de pasos —armar la lista de pasos, mover el índice, traducir una tecla a una opción— a `src/lib/mozo/daily-menu-steps.ts`, pura y testeada. Es la condición para que el asistente se pueda reusar cuando el menú del día llegue a los otros flujos de carga (para llevar, venta rápida), que hoy no lo tienen.

## Fuera de alcance

- **Buscar menús del día desde el buscador de productos.** Hoy se llega a ellos por la tarjeta del tab «Más pedidos» (que es `<button>`, o sea alcanzable con Tab). Meterlos en `useProductSearch` implica volver `CatalogProduct` una unión y tocar los tres flujos de carga: merece su propia spec.
- Menú del día en «para llevar/delivery» y en venta rápida de mostrador.
- Grupos de opciones opcionales o de más de una selección (D-MDR-4 / D-MDR-6 siguen vigentes).
- Modificadores por componente del combo dentro del asistente.

## Criterios de aceptación

1. Abrir un menú del día con tres grupos: el panel muestra sólo la entrada, con la primera opción enfocada.
2. `↓ ↓ Enter` elige la tercera opción de la entrada y deja el foco en la primera del principal.
3. `2` en el paso del principal elige la segunda opción y avanza.
4. `←` vuelve al paso anterior con la opción ya elegida enfocada y marcada.
5. En el paso final, `+` sube la cantidad y Enter agrega el menú al pedido; el ítem del carrito queda con las mismas `selected_choices` y el mismo total que antes de esta spec.
6. Un menú sin grupos de opciones abre directo en el paso final.
7. Con el dedo, en `/mozo`, el flujo completo se hace tocando: opción → opción → Agregar.
8. `pnpm typecheck` y `pnpm test` en verde.
