# 115 · Un solo panel de carga

**Issue:** [#178](https://github.com/gachetponzellini/RestaurantOS-app/issues/178) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Hay dos superficies donde el personal carga un pedido:

- **el panel del salón** — `src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx`,
  que vive dentro del panel derecho de Operación → Mesas;
- **la hoja de pedidos online** — `src/components/admin/cargar-pedido-sheet.tsx`.

Las piezas chicas ya son las mismas (`ProductSearchInput`, `ProductResultsList`,
`ProductModal`, `useCartZone`, la navegación por teclado de la spec 073/113). Lo
que no es lo mismo es el **shell**: cada una arma su propio layout de dos
columnas, y por eso divergieron.

| | Salón | Pedidos online |
|---|---|---|
| Corte a dos columnas | container query `@2xl` — ancho **del panel** | media query `xl` — ancho **del viewport**, + `useSheetAncho` en JS |
| Categorías | sin selector; sólo el buscador (spec 111, fase 5) | conserva el `<select>` |
| Pedido en armado | columna izquierda (`MesaColumn`) | franja al pie de la columna de carga |

La divergencia no es teórica: la spec 111 rediseñó el salón y la hoja quedó a
mitad de camino (el comentario del cuerpo de la hoja cita la 111, pero con otro
breakpoint y con el selector todavía puesto). Sin un shell común se vuelven a
separar en el próximo cambio.

El corte por viewport además está mal para una hoja de ancho fijo: entre 1280 px
de pantalla y 900 px de hoja no hay relación, y `useSheetAncho` tiene que
duplicar el breakpoint en JS para que ⌘Enter sepa en qué layout está.

## Qué se construye

### FR-001 · El shell sale a un componente

`src/components/mozo/panel-de-carga.tsx`, con tres piezas que se componen:

- **`PanelDeCarga`** — el contenedor de las dos columnas
  (`relative flex min-h-0 flex-1 flex-col @2xl:flex-row`).
- **`ColumnaLateral`** — la columna izquierda. Ancha (`@2xl`) está al lado de la
  carga con `w-[46%] max-w-[520px] shrink-0`; angosta se abre **encima** de la
  carga (`absolute inset-0 z-10`) o se esconde. El que decide si está abierta es
  el padre.
- **`ColumnaDeCarga`** — la columna derecha: `encabezado` (el buscador, en la
  franja blanca fija), la zona de resultados con scroll y su `onKeyDown`, y un
  `pie` opcional.

`useAnchoDePanel(ref)` reemplaza a `useSheetAncho`: mide el **contenedor** con
`ResizeObserver` contra el mismo umbral que la CSS (672 px = `@2xl`), así el JS
y el layout no pueden discrepar.

### FR-002 · Las dos pantallas usan el shell

Sin cambio visible en el salón: es el layout que ya tiene, movido de lugar.

En la hoja online:
- el corte pasa de `xl:` a `@2xl` sobre un `@container` en la raíz de la hoja, y
  la columna izquierda toma el mismo ancho que la del salón (46% / 520 px, contra
  38% / 360 px);
- el paso «datos» se abre **encima** de la carga cuando la hoja es angosta, que
  es como se abre la mesa en el salón, en vez de esconder la otra columna;
- **«Tu pedido» sube a la columna izquierda**, abajo de cliente y entrega, y pasa
  a ser la lista editable (antes esa columna sólo mostraba un resumen muerto de
  ítems + total). La izquierda es «el pedido y a quién va», el espejo de
  `MesaColumn` («la mesa y lo pedido»), y la derecha queda sólo buscador +
  catálogo en las dos pantallas. Angosto sobrevive una franja con el total y
  «Continuar»: es el único ancho donde el carrito no está a la vista.

### Lo que NO se unificó, y por qué

**El `<select>` de categorías se queda en la hoja.** El salón pudo sacarlo en la
spec 111 porque, sin búsqueda, muestra «Más pedidos» *y el catálogo entero*
(`TabView`). La hoja no tiene eso: sin búsqueda, la lista **es** la categoría
elegida. Sacar el selector sin portar antes el catálogo completo dejaría al
personal obligado a buscar por nombre hasta para un café.

Portarlo no entra acá: `TabView` es una función privada de `pedir-client.tsx` y
depende de `tabSections`, super-categorías y menús del día que la hoja no
calcula. Queda como el paso que falta para que las dos pantallas muestren lo
mismo cuando no hay búsqueda.

## Qué NO cambia

- **Nada de plata ni de cocina.** El gate de permisos, la validación Zod, las
  actions de envío y el ruteo a estaciones quedan intactos. Esto es layout.
- El flujo angosto de la hoja sigue siendo dos pasos (carga → datos → confirmar):
  en un teléfono no entran las dos columnas. Lo único que cambia es que el corte
  lo decide el ancho de la hoja.
- El salón conserva su pastilla «La mesa» y el salto ⌘Enter.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. Salón: abrir una mesa en Operación → la carga se ve **igual** que antes, ancha
   y angosta (achicando el panel, no la ventana).
3. Online: abrir «Cargar pedido» en un monitor ancho → cliente, entrega y el
   pedido a la izquierda; buscador y catálogo a la derecha; sin selector de
   categoría. En un teléfono, los dos pasos de siempre.
4. ⌘Enter: ancho confirma; angosto pasa a «datos» y recién ahí confirma.
5. Verify en vivo con el rol real (encargado de golf-jcr), nunca `service_role`.
