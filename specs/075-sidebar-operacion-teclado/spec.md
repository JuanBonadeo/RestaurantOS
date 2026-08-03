# Feature Specification: El sidebar de la operación se maneja entero con las flechas

**Feature Branch**: `075-sidebar-operacion-teclado`

**Created**: 2026-08-03

**Status**: 🚧 Implementada (2026-08-03) en tres fases. `pnpm typecheck` + `pnpm test` (1142 unit, 60 nuevos) + `pnpm build` en verde. **Pendiente:** verify en vivo con el rol real (encargado) — T25/T26: el panel está detrás del login y no se puede probar sin la sesión de Juan. Issue [#112](https://github.com/gachetponzellini/RestaurantOS-app/issues/112). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-08-03 — *"que el sidebar de la parte operacional tenga la mejor ux/ui con respecto a la navegabilidad con las teclas, tiene que ser todo manejable con las flechitas, y bien intuitivo"*.

## Contexto y problema

El recorrido del encargado en `/admin/operacion → Mesas` vive entero dentro del `<aside>` de [`salon-desktop.tsx`](../../src/components/admin/local/salon-desktop.tsx), un panel con **cadena de modos**: lista (demoras + reservas + mesas activas) → detalle de mesa → cargar pedido / walk-in / venta rápida / cuenta / cobro.

Tres specs ya atacaron pedazos de esa cadena:

| Spec | Qué dejó andando |
|---|---|
| [055](../055-carga-pedido-teclado/) | Buscador con foco, ↓/↑/Enter sobre los resultados, `ProductModal` con Esc/Enter, carrito siempre visible |
| [066](../066-teclado-operacion/) | Resultados en una columna (el bug de la flecha), walk-in en el panel con `+`/`−`/dígitos, foco en la acción primaria del detalle |
| [072](../072-menu-del-dia-por-pasos/) / [074](../074-grupos-condicionales-menu-del-dia/) | El asistente del menú del día: ↑↓ / Home / End / dígitos / ←-para-volver / focus-trap. **El mejor modelo de teclado que hay hoy en el repo.** |

Quedó a mitad de camino, y justo la mitad que falta es la que se toca primero en cada turno:

1. **La lista es el modo de entrada del panel y no tiene una sola tecla.** `DemorasPanel`, `ReservationsPanel` y `ActiveTablesList` son filas `<button>` sueltas, sin índice, sin fila activa y sin `aria-current`. Elegir una mesa es mouse obligado — o sea, el primer paso del recorrido corta la cadena antes de empezar.

2. **El carrito está a seis Tabs.** En la carga, el foco vive **siempre** en el `<input>` del buscador y ↑/↓ mueven un resaltado **virtual** sobre los resultados. El pedido en armado —el que la spec 055 puso a la vista justamente para poder controlarlo— sólo se toca con el mouse: corregir una cantidad o sacar una línea obliga a soltar el teclado en medio de la carga.

3. **El catálogo y los menús del día no son el mismo recorrido.** La spec 073 metió el catálogo en el índice de teclado, pero los menús del día quedaron afuera y el filtro de la carta online sacaba productos del índice **sin** sacarlos de la pantalla: el resaltado podía caer en algo que no se veía.

4. **Cuenta y cobro no tienen nada.** Ni una flecha, ni Esc, ni atajo para elegir el método de pago ([`cobro-form.tsx`](../../src/components/billing/cobro-form.tsx) pinta los métodos como una grilla de botones que sólo se clickean). Es la parte que **toca plata** y la más lenta del recorrido.

5. **Esc no es un contrato.** `useEscapeToClose` lo usan sólo `product-modal`, `walk-in-modal` y `daily-menu-wizard`. Salir de cobro, de cuenta o de la carga es clickear la flechita del header.

6. **El foco no vuelve.** Al cerrar un modo el foco queda huérfano en el `<body>`: el segundo Esc ya no hace nada y hay que volver al mouse para retomar. Esto solo alcanza para que toda la cadena se sienta rota aunque cada pieza funcione.

7. **Nada se anuncia.** El único `kbd` visible del panel es el `⌘↵` del botón Enviar. El resto de los atajos existentes (los de la 055/066) sólo los conoce quien leyó la spec.

Esta feature **no agrega funcionalidad de negocio**: unifica el modelo de teclado del panel y lo completa donde falta. Es puro UI.

## Alcance

**Entra:** el `<aside>` completo de `/admin/operacion → Mesas`, con sus siete modos — lista, detalle de mesa, cargar pedido, walk-in, venta rápida, **cuenta** y **cobro**.

**Fuera de alcance** (cada uno merece su spec):

- Navegar el **plano de mesas** (SVG) con flechas — implica un orden espacial sobre coordenadas. Ya estaba fuera en la [spec 066](../066-teclado-operacion/spec.md#fuera-de-alcance) y sigue afuera.
- **Atajos globales del operativo** para cambiar de tab (Mesas / Reservas / Comandas / Pedidos / Caja / Rendición / Fichaje).
- Rediseñar el layout del mozo full-screen (tablet táctil): hereda lo que aplique, sin layout propio.
- Datos, migraciones, RLS, permisos, `enviarComanda`, ruteo a cocina/estaciones, ARCA: **cero cambios**.

## El contrato de teclas

Es la pieza central de la spec: hoy cada panel inventa lo suyo. Se define una vez y rige en los siete modos.

| Tecla | Qué hace |
|---|---|
| `↑` / `↓` | Mover dentro de la zona activa. **En el borde pasa a la zona vecina** (no se traba) |
| `←` / `→` | Sobre una línea del carrito: `−` / `+` cantidad |
| `Enter` / `Espacio` | Activar lo que está enfocado |
| `Esc` | Subir un nivel en la cadena de modos (cobro → cuenta → detalle → lista → deseleccionar) |
| `Backspace` | Igual que `Esc`, salvo escribiendo en un campo |
| `+` `−` `1`–`9` | Cantidad / elegir la opción N — ya es la convención de `ProductModal`, walk-in y el asistente del menú |
| Escribir una letra | Desde cualquier zona el foco vuelve al buscador y arranca la búsqueda con esa letra |
| `⌘/Ctrl+Enter` | Acción primaria del modo (Enviar comanda / Cobrar) |
| `?` | Panel de atajos del modo actual |

Regla dura, ya respetada por el asistente del menú: **escribiendo en un `<input>` o `<textarea>`, los atajos de una tecla no aplican** (ahí `-` es un guion y `4` es un cuatro).

### Decisión de diseño: el foco entra de verdad a la zona

La 055 dejó el modelo *combobox*: el foco no se mueve del `<input>` y ↑/↓ mueven un resaltado virtual. Es correcto mientras la única zona sean los resultados; deja de serlo cuando hay carrito, y es lo que hoy lo vuelve inalcanzable.

Se adopta **zona activa con foco real**: `↓` desde el buscador **baja** a los resultados (el botón recibe el foco), `↑` en el primer resultado **vuelve** al buscador con el texto intacto y el cursor al final, `↓` pasado el último resultado **entra** al carrito. Una sola tecla mueve todo y no hay que aprender combinaciones.

Consecuencias que se aprovechan:

- Con el foco fuera del campo de texto, `←`/`→` y `Supr` quedan libres → una línea del carrito se opera parado encima. La restricción que la 066 documentó (no tocar ←/→ para no robarle el cursor a quien tipea) desaparece con el modelo nuevo.
- Como el foco sale del buscador, hace falta la vuelta barata: **cualquier letra** devuelve el foco al buscador y empieza a escribir. Sin eso, salir de la zona del buscador se sentiría como una trampa.
- `Tab`/`Shift+Tab` siguen funcionando como salida estándar (accesibilidad): las flechas son el camino rápido, no el único.

## Requisitos

### Contrato compartido

- **FR-001**: DEBE existir una **lógica pura y testeada** de navegación por índice que, además de mover con clamp, informe cuándo el movimiento **sale** de la lista por arriba o por abajo (para el handoff entre zonas) y cuándo una tecla es un **dígito** que selecciona la opción N. Extiende lo que ya existe en [`product-search.ts`](../../src/lib/mozo/product-search.ts) (`clampIndex` / `moveSelection` / `resetSelection`) y absorbe `optionIndexFromKey` de [`daily-menu-steps.ts`](../../src/lib/mozo/daily-menu-steps.ts), que hoy vive en el módulo del menú del día pero es genérico.

- **FR-002**: DEBE existir un hook de lista con **foco real** (roving): registra los elementos, mueve el foco, mantiene el activo a la vista con `scrollIntoView({ block: "nearest" })` y expone el handoff hacia la zona anterior/siguiente. Un solo elemento de la lista queda en el orden de tabulación (`tabIndex=0`), el resto `-1`.

- **FR-003**: Cerrar un modo DEBE devolver el foco a la fila desde la que se abrió, nunca dejarlo en el `<body>`.

  Se recuerda **la clave de la fila** (`mesa:<id>`), no el elemento: abrir un modo desmonta la lista entera, así que para cuando hay que devolver el foco el botón original ya no existe. Lo que sobrevive es la mesa.

- **FR-004**: `Esc` (y `Backspace` fuera de un campo de texto) DEBE subir **un** nivel de la cadena de modos, en el mismo orden en que se abrieron: cobro → cuenta → detalle → lista → mesa deseleccionada.

- **FR-005**: El elemento activo de cada zona DEBE distinguirse visualmente (ring, mismo lenguaje que `ProductResultsList`) y exponer `aria-current`. Sin señal visible, las flechas no se pueden usar.

### Lista de entrada (demoras + reservas + mesas activas)

- **FR-006**: Las tres secciones DEBEN ser navegables con `↑`/`↓` como **un solo recorrido** de arriba a abajo: llegar al final de Demoras y seguir bajando entra a Reservas, y así. `Enter` sobre una fila de mesa abre su detalle; sobre una reserva, su acción primaria.

- **FR-007**: Al entrar al panel sin mesa seleccionada, la primera fila DEBE quedar disponible para el teclado sin robar el foco de entrada de la página (`tabIndex=0`, no `focus()` automático): el encargado llega con Tab o con la primera flecha.

### Detalle de mesa

- **FR-008**: El detalle DEBE ser una zona: `↑`/`↓` recorren sus controles (cerrar, acción primaria, menú `⋯`) y `Enter` dispara el enfocado. Hoy sólo se autoenfoca la primaria ([spec 066, FR-007](../066-teclado-operacion/spec.md)) y el resto sólo se alcanza con Tab a ciegas.

  Los ítems del `⋯` **no** se aplanan en la zona: el menú se abre con `Enter` y ya trae sus propias flechas (Base UI). Aplanarlo sería reimplementar un `menu` que ya funciona con teclado.

- **FR-009**: `Esc` DEBE volver a la lista **con el foco en la fila de la mesa de donde vino**, no al principio de la lista.

### Cargar pedido (y venta rápida, que comparte buscador y carrito)

- **FR-010**: Las zonas del panel de carga DEBEN ser, en orden: **buscador → resultados/catálogo → carrito → acción de enviar**, encadenadas con `↑`/`↓` según FR-002.

- **FR-011**: `↑` desde el primer resultado DEBE devolver el foco al buscador **conservando el texto y dejando el cursor al final** (no seleccionar todo, no limpiar).

- **FR-012**: Sobre una línea del carrito, `→` y `+` DEBEN sumar cantidad, `←` y `−` restar (respetando el rango 1–99 existente), un dígito `1`–`9` DEBE fijarla, `Supr` DEBE quitar la línea y `Enter` DEBE abrir el editor de precio si el rol lo permite. El elemento que recibe el foco es **la línea entera**, no sus botones.

  `Backspace` **no** borra la línea: en este panel ya sube un nivel en la cadena de modos (FR-004), y que además borrara plata cargada sería una trampa.

- **FR-013**: El catálogo por categoría (sin búsqueda) DEBE ser la misma zona que los resultados, con los menús del día encabezándola: un solo `↓` recorre menús, secciones de categoría y productos sin cortes.

  *Al implementar se verificó que la grilla de 2 columnas que esta spec daba por existente ya no está: la [spec 073](../073-catalogo-como-los-resultados/) unificó el catálogo con `ProductResultsList`, que es de una sola columna. No hay navegación 2-D que hacer — `↓` ya baja de verdad. Por eso `gridNextIndex` se escribió, quedó sin consumidores y se sacó.*

- **FR-014**: Escribiendo una **letra** con el foco en resultados, catálogo o carrito, el foco DEBE volver al buscador y ese carácter DEBE quedar escrito. No aplica a las teclas que ya tienen significado en la zona: `+`, `−` y los dígitos sobre una línea del carrito son cantidad.

- **FR-015**: `⌘/Ctrl+Enter` DEBE seguir enviando la comanda desde cualquier zona del panel, respetando el anti-doble-envío existente (specs [041](../041-mozo-instantaneo/)/[042](../042-enviar-comanda-idempotente/)).

### Walk-in

- **FR-016**: El panel de walk-in DEBE navegarse con `↑`/`↓` entre Personas, Nombre, Notas y «Abrir mesa», conservando los atajos `+`/`−`/dígitos y el Enter que abre (spec 066, FR-004/005). `Esc` vuelve al detalle de la mesa.

### Cuenta y cobro

- **FR-017**: El panel de cuenta DEBE tener zonas **líneas de la cuenta → acciones (dividir / propina / descuento) → Cobrar**, con `↑`/`↓` y `Enter`. `Esc` vuelve al detalle.

- **FR-018**: El selector de método de pago DEBE navegarse con flechas **y** aceptar los dígitos `1`–`9` para elegir el método directo — es el atajo real de la caja en hora pico. El método elegido se anuncia con su número en la UI para que se aprenda solo.

- **FR-019**: `Esc` en el cobro con un método ya elegido DEBE volver al selector de método (no cerrar el panel); sin método elegido, DEBE volver a la cuenta.

- **FR-020 (plata)**: `Enter` sobre el selector de método **sólo elige**, nunca cobra. El cobro se dispara únicamente desde su botón o con `⌘/Ctrl+Enter`, y respeta los guards de `pending` existentes: un segundo disparo en vuelo no cobra dos veces.

### Descubribilidad

- **FR-021**: Los botones clave DEBEN mostrar un chip `kbd` con su tecla — acción primaria del detalle (`↵`), botón de volver (`Esc`), enviar (`⌘↵`, ya existe) — con el mismo estilo que el chip actual del botón Enviar.

- **FR-022**: `?` DEBE abrir un panel con los atajos **del modo activo**, dentro del `<aside>` (no un overlay de viewport), que cierra con `Esc`. Un botón chiquito en el header del panel ofrece el mismo acceso con el mouse.

### Sin regresión

- **FR-023**: La carga por tap del mozo full-screen (tablet táctil) NO DEBE cambiar: los atajos conviven sin estorbar y el autofocus del buscador sigue siendo exclusivo del modo `embedded` (spec 055, FR-002).

- **FR-024**: Los atajos que ya existen (Esc y Enter del `ProductModal`, `+`/`−`/dígitos, `←` para volver en el asistente del menú, `⌘↵` para enviar) NO DEBEN cambiar de significado. Esta spec los generaliza, no los redefine.

## Criterios de aceptación

1. **Recorrido completo sin mouse**, con el rol real (encargado, PC del salón): `↓↓` elegir mesa → `Enter` → `Enter` (abrir) → cargar 3 productos (dos por búsqueda, uno con modificadores) → `↓` al carrito → `→` subir una cantidad → `⌘Enter` enviar → `Esc` → `Enter` (cuenta) → elegir método con un dígito → `⌘Enter` cobrar.
2. Con el foco en un resultado, apretar una letra vuelve al buscador y la escribe.
3. Con el foco en una línea del carrito, `→` sube la cantidad y `Supr` la quita; una letra devuelve el foco al buscador y la escribe.
4. `Esc` sube exactamente un nivel de la cadena de modos, y el foco queda en el elemento que había abierto ese modo.
5. `?` muestra los atajos del modo activo; `Esc` lo cierra.
6. Ningún camino de teclado cobra dos veces ni envía dos comandas.
7. Cero regresión táctil en el mozo full-screen.
8. `pnpm typecheck` + `pnpm test` + `pnpm build` en verde.

## Assumptions

- El `<aside>` corre en la **PC del salón con teclado físico**; el mozo full-screen corre en tablet táctil.
- El carrito sigue siendo `useState` con borrador en `localStorage` (spec 055, FR-019): esta spec no cambia dónde vive el estado.
- La verificación fina de foco es en vivo; lo unit-testeable es la lógica pura de índices (FR-001) y el comportamiento de teclado de los componentes con Testing Library, que ya es convención del repo (`product-search-box.test.tsx`, `daily-menu-wizard.test.tsx`).
