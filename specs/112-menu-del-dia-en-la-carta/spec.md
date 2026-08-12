# Feature Specification: El menú del día en la carta — los grupos, no las 57 opciones

**Feature Branch**: `112-menu-del-dia-en-la-carta`

**Created**: 2026-08-12

**Status**: 🟡 Implementada — typecheck / suite unitaria (1609 tests) en verde, verificada en vivo sobre golf-jcr y demo (dev contra el cloud). **Pendiente** mirarla en el celu real con el QR. Issue [#176](https://github.com/gachetponzellini/RestaurantOS-app/issues/176).

**Input**: Pedido de Juan — *"el tema del menú tendría que ser más discreto como lo muestra, y tendría que decir cuándo está disponible, que eso sería la descripción, y abajo que diga los grupos, pero sólo el nombre del grupo separados un + verticalmente"*.

## Contexto y problema

`/carta` es la carta **solo-lectura** del QR de la mesa (spec [44](../../../wiki/specs/44-carta-estetica-golf/)): el comensal mira y le pide al mozo. Ahí el menú del día se dibujaba como una caja dorada con borde y relleno que listaba **todos** sus componentes, uno por línea:

> · Agua Mineral · Agua Mineral c/Gas · Gaseosa · Medio Nuna · Medio Andes 1lt · Empanada Carne · Empanada Jamón y Queso · Sugerencia del Día 1 · …

El «Menú» de golf-jcr tiene **57 componentes**. Dos problemas, no uno:

1. **De espacio.** El bloque se comía media página antes de que empezara la carta, en la superficie donde menos margen hay (un celular, parado, en la mesa).
2. **De sentido.** Leído así parece que el menú **trae** las 57 cosas. En realidad se elige **una de cada grupo** — y esa elección no se hace en la carta, se le dice al mozo.

Lo que el comensal necesita de la carta es la forma del menú (bebida + entrada + principal + guarnición + postre), cuándo se ofrece y cuánto sale. Qué milanesa hay se pregunta en la mesa.

## Requirements *(mandatory)*

- **FR-001**: El menú del día muestra **sólo el nombre de cada grupo**, uno por línea, separados por un `+`. Nunca las opciones.
- **FR-002**: Un grupo aparece **una sola vez**, en la posición de su primera opción. El nombre sale de `daily_menu_choice_groups` (spec [087](../087-grupos-del-menu-como-entidad/)), no del componente: el catálogo público ni siquiera trae `choice_group_label` y leerlo de ahí dejaba la carta listando grupos sin nombre.
- **FR-003**: Un menú **sin grupos** (todos sus componentes sueltos, como los de `demo`) muestra esos componentes como pasos. Es el mismo concepto: lo que el menú trae, en orden.
- **FR-004**: Donde iba la descripción va **cuándo se ofrece**, derivado de `available_days`: *Todos los días* · *De lunes a viernes* · *Los sábados y domingos* · *Los lunes, miércoles y viernes*. El rango pide **tres o más** días corridos — con dos queda peor de lo que resuelve. La semana arranca el lunes, así que sábado y domingo son contiguos.
- **FR-005**: Sin días configurados no se dibuja la línea. La columna arranca en `'{}'` (spec [109](../109-menu-del-dia-solo-su-dia/)) y afirmar una disponibilidad que no existe es peor que no decir nada.
- **FR-006**: El bloque se lee de arriba a abajo y centrado —nombre en versalitas → disponibilidad en itálica → los pasos → precio— dentro de un **marco de línea dorada finita**, sin relleno. Es el único ítem de la carta que no es una fila `plato·····precio`: es un menú, no un plato.

## Decisiones

- **La fecha de hoy se fue.** El header dorado *«MIÉRCOLES 12 DE AGOSTO»* decía lo mismo dos veces ahora que cada menú dice sus días, y era ruido en un bloque que se pedía discreto. Se sacó también de `carta/page.tsx` (`todayLabel` ya no se calcula).
- **La descripción cargada a mano no se muestra.** El pedido es explícito: en ese renglón va la disponibilidad. Hoy ningún negocio la tiene cargada (`golf-jcr` las tiene vacías); si alguna vez se quiere, va en otra línea, no en esa.
- **Marco, no caja.** La primera versión iba sin marco y separando menús con un filete corto; Juan pidió el marco fino dorado. El relleno dorado del diseño viejo no vuelve: lo que se pidió es discreción.
- **`/menu` no se toca.** Ahí el menú del día se abre en un sheet donde el cliente **sí** elige, y el listado ya está acotado a 3 componentes. La misma corrección de sentido (mostrar grupos en vez de opciones sueltas) queda anotada como fast-follow.

## Implementación

| Archivo | Qué |
|---|---|
| `src/lib/daily-menus/carta-resumen.ts` (nuevo) | `pasosDelMenu()` y `disponibilidadTexto()`, puras |
| `src/lib/daily-menus/carta-resumen.test.ts` (nuevo) | 12 tests (grupos intercalados, menú sin grupos, fin de semana, sin días) |
| `src/lib/menu.ts` | `MenuDailyMenu` expone `available_days` (ya se traía del select, se descartaba en el map) |
| `src/components/menu/carta-client.tsx` | el bloque nuevo: marco fino, versalitas, disponibilidad, pasos con `+`, precio |
| `src/app/[business_slug]/(public)/carta/page.tsx` | sin `todayLabel` |

## Verify

- `pnpm typecheck` ✅ · suite unitaria ✅ **1609 tests** (los 21 archivos `*.integration.test.ts` fallan sin el stack local levantado — ruido conocido, no relacionado).
- En vivo (dev contra el cloud, 375px):
  - `golf-jcr/carta` → *MENU EJECUTIVO · De lunes a viernes · Bebida + Plato Principal + Guarnicion · $ 24.000* y *MENÚ · De lunes a jueves · Bebida + Entrada + Plato principal + Guarnición + Postre · $ 42.000*. Antes: 57 renglones.
  - `demo/carta` → *Menú Ejecutivo · De lunes a viernes · Entrada del día + Plato principal + Postre + Bebida* (FR-003, menú sin grupos).
- ⏳ Mirarla en el celular real escaneando el QR de la mesa.
