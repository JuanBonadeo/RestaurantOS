# Feature Specification: Los modificadores se navegan como el resto del panel

**Feature Branch**: `113-teclado-modificadores`

**Created**: 2026-08-09

> **Renumerada de 110 a 113.** Se commiteó como `110` (commit `3d6000c`) chocando con
> [`110-items-sin-comanda-editables`](../110-items-sin-comanda-editables/spec.md), de otra sesión que
> venía trabajando en paralelo sobre el mismo working tree. El commit y la issue [#175](https://github.com/gachetponzellini/RestaurantOS-app/issues/175) quedan con el número viejo en su texto.

**Status**: 🟡 Implementada — typecheck / suite (1585 tests) / build en verde, review con 1 hallazgo corregido. **Pendiente verificar en vivo con rol real**. Issue [#175](https://github.com/gachetponzellini/RestaurantOS-app/issues/175).

**Input**: Pedido de Juan — "la parte de los modificadores no tiene la navegabilidad que debería tener, como tenía el resto del sidebar, al cargar un item".

## Contexto y problema

Cargar un pedido en el sidebar del salón es keyboard-first desde la [spec 055](../055-carga-pedido-teclado/spec.md), y la [075](../075-sidebar-operacion-teclado/spec.md) generalizó el patrón en `useRovingList`: cada zona del panel es una lista con **foco real**, ↑/↓ mueven, y al llegar al borde la zona le pasa el foco a la vecina. Así se recorre buscador → resultados → carrito → enviar sin soltar el teclado.

Ese patrón está en ocho superficies —resultados, carrito, filas de mesa, métodos de pago, venta rápida, nueva reserva, cobro— y hasta en el **wizard del menú del día, en su propio paso de modificadores**, que ya tiene flechas, Home/End y dígitos.

El único que quedó afuera es `ProductModal`, el paso de modificadores de un producto normal. Tenía Esc, focus-trap con Tab, `+`/`−` de cantidad y `/` para marcar entrada, pero **ninguna flecha**: para llegar a la tercera salsa había que tabular tres veces, y Tab pasa por cada elemento focusable del modal.

Se cortaba justo en el paso que más se repite: casi todo producto que se carga en el salón pasa por ahí.

## Requirements *(mandatory)*

- **FR-001**: Los modificadores son una zona más del panel, con `useRovingList` — el mismo primitivo que el resto, no una implementación paralela.
- **FR-002**: **Todos los grupos, una sola zona.** Al que carga no le importa dónde termina "Punto de cocción" y empieza "Guarnición": baja con ↓ hasta lo que busca. (Y es lo único que permite un solo hook: la cantidad de grupos cambia por producto.)
- **FR-003**: ↓ en la última opción entrega el foco a «Agregar» — la zona no se come la última flecha, igual que las demás.
- **FR-004**: 1-9 eligen directo, como en el paso de modificadores del wizard del menú del día.
- **FR-005**: `role="radio"` para grupos de una sola opción, `role="checkbox"` para los múltiples, con `aria-checked`. Antes eran botones sin estado anunciable.
- **FR-006**: Cada grupo va dentro de un `role="radiogroup"` / `role="group"` con su nombre (y el "obligatorio · hasta N"). Sin eso el `role` de la opción es ARIA inválida —un `radio` necesita ese padre— y, sobre todo, la zona aplanada de FR-002 vuelve **invisible** el cruce de un grupo al siguiente: por teclado el lector diría "Papas, casilla" sin decir que cambió de grupo. Es lo que el `<h4>` y el badge resuelven visualmente.

## Implementación

| Archivo | Qué |
|---|---|
| `src/components/mozo/product-modal.tsx` | la zona, el encadenado de teclas y la semántica de las opciones |
| `src/components/mozo/product-modal.teclado.test.tsx` (nuevo) | 7 casos: foco inicial, ↑/↓ cruzando grupos, salida a «Agregar», Enter que elige y no manda, dígitos, los roles, y el contenedor con nombre de cada grupo |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅ · suite ✅ **1585 tests**.

## Review

Dos lentes (teclado / a11y-UX), 18 agentes. **Un hallazgo confirmado**, y era un descuido de este cambio: el comentario decía que copiaba el paso de modificadores del wizard, pero copió los atajos y el `role` de la opción **sin** el contenedor de grupo — que es la mitad que hace que el `role` signifique algo. El verificador lo midió: cero `radiogroup` en el árbol, y el único ancestro con nombre era el diálogo, que dice el nombre del producto. Corregido con el mismo patrón del wizard.

Rechazados por preexistentes y no agravados: que el dígito apague una opción ya elegida en un grupo obligatorio, el no-op silencioso al llegar al tope de un grupo, que `Ctrl/Cmd + dígito` también elija, y el selector del focus-trap. Y rechazado por criterio: que los dígitos numeren global en vez de por grupo — el wizard numera por grupo porque dibuja **un grupo por paso**; acá se ven todos a la vez, así que el invariante que se respeta es "el dígito indexa lo que se ve".
- ⏳ **En vivo**: abrir un producto con dos grupos de modificadores en el sidebar del salón y cargarlo entero sin tocar el mouse ni Tab.

## Qué NO entra

El wizard del menú del día ya tenía su teclado (flechas, Home/End, dígitos por grupo) y no se toca. Tampoco la tablet del mozo, que es táctil: esto no le quita nada, sólo no le suma.
