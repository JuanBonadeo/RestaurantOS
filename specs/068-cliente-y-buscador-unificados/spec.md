# Feature Specification: Un solo bloque de cliente y un solo buscador de productos para los tres flujos de carga

**Feature Branch**: `068-cliente-y-buscador-unificados`

**Created**: 2026-07-30

**Status**: ✅ Implementado (2026-07-30) — `pnpm typecheck`, `pnpm lint` y `pnpm build` verdes; `pnpm test` 894 pass / 140 skip (los 16 `*.integration.test.ts` fallan por falta del stack Supabase local, preexistente). Sin migración. **Pendiente:** verify en vivo con rol real. Issue [#105](https://github.com/gachetponzellini/RestaurantOS-app/issues/105). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"que cuando entres a abrir una mesa aparezca focuseado el nombre del cliente, lo mismo deberia de pasar con reservas, habria que unificar ahi los cambios que hiciste recien para el walkin, lo mismo para los pedidos, capaz podriamos reutilizar un mismo componente, y que al tocar enter en reservas cree la reserva"* + *"ademas el buscador de productos tambien deberia de ser el mismo, para los tres… ademas habria que agregar un filtro que pueda filtrar lo que van y no van de la web, esto aparte del fiultro ya hardcodeado"*.

## Contexto y problema

Hay **tres pantallas donde el encargado carga un pedido** y **tres donde elige un cliente**, y cada una resolvió lo mismo por su cuenta:

| | Cliente | Buscador de productos |
|---|---|---|
| Abrir mesa (walk-in) | buscador + teléfono bloqueado ([spec 067](../067-plano-nombre-cliente-y-buscador/)) | — |
| Nueva reserva | buscador propio + campos sueltos | — |
| Cargar pedido (para llevar / delivery) | buscador propio + campos sueltos | input + teclado propios |
| Mesa (`pedir-client`) | — | input + teclado propios |
| Venta rápida de mostrador | — | input + teclado propios |

La [spec 066](../066-teclado-operacion/) ya unificó **los resultados** (`ProductResultsList`) porque el mismo bug de flecha estaba escrito tres veces. Lo que quedó afuera es el **buscador** en sí: el input, el índice de teclado y el filtrado siguen copiados en tres lados — es exactamente la condición para que el próximo arreglo vuelva a aplicarse en dos de tres.

Con el cliente pasó lo mismo y ya nos costó: la regla de "el teléfono no se edita" de la spec 067 hubo que escribirla **tres veces** el mismo día.

**El filtro de la web.** [`getCatalogForMozo`](../../src/lib/mozo/catalog-query.ts) trae los productos con `is_active` + `is_available` hardcodeados. No mira `products.show_online`, que es el flag de "esto se vende por la carta pública". Resultado: al cargar un **delivery** aparecen productos que online no se venden, y no hay forma de recortarlos.

## Requisitos

### FR-001 — Un solo componente de cliente

Nace `CustomerFields`: buscador de clientes (`buscarClientes`) + nombre + teléfono, con la regla de la spec 067 adentro — **elegido un cliente, el teléfono queda de sólo lectura**, con «Quitar» para soltar la identidad, y escribir a mano en el nombre también la suelta.

Lo usan **walk-in**, **nueva reserva** y **cargar pedido**. La regla vive en un lugar; las tres pantallas la heredan.

El componente es **controlado** (`name`, `phone` los tiene el caller, que ya los maneja con react-hook-form o `useState` según el caso) y avisa por callbacks: `onNameChange`, `onPhoneChange`, `onPick`, `onClear`. El estado de "hay un cliente elegido" vive **adentro**: es del componente, no del formulario.

### FR-002 — ~~Al abrir mesa y~~ al abrir nueva reserva, el foco arranca en el cliente

> 🔴 **REVERTIDO PARA «ABRIR MESA» el 2026-07-30**, por pedido de Juan al probarlo: *"en la parte de abrir una mesa que no entre con el focus en el buscador, en el resto sí pero ahí no"*. Sigue vigente para **nueva reserva** y para **cargar pedido**.
>
> Por qué falló en la práctica: abrir una mesa es sobre todo decir **cuánta gente se sienta** — el nombre del cliente es opcional y muchas veces no se carga. Con el foco en el buscador, el caso común (mesa para 2 = Enter) seguía andando, pero los atajos `1`-`9`/`+`/`−` de la [spec 066](../066-teclado-operacion/) quedaban **inalcanzables**: `handleKeyDown` sale por el early return de `INPUT`, así que el atajo existía en el código y no se podía usar. Un keyboard-first que hay que desactivar con el mouse antes de usar el teclado no es keyboard-first.
>
> Estado actual: en «abrir mesa» el foco vuelve a «Abrir mesa» (066 FR-005), blindado con tests de componente en [`walk-in-modal.test.tsx`](../../src/components/mozo/walk-in-modal.test.tsx).

En «Nueva reserva» y «Cargar pedido», el campo Cliente se enfoca al montarse, para poder tipear el nombre sin tocar nada. Ahí no hay atajos numéricos que pisar y el cliente es el primer dato real del formulario.

### FR-003 — Enter crea la reserva

En «Nueva reserva», Enter desde cualquier campo de texto crea la reserva (el modal ya es un `<form>` con un submit; el requisito es que **nada se lo coma**).

El único que intercepta Enter es el buscador de clientes, y **sólo cuando hay un resultado marcado** con ↓/↑: ahí Enter elige ese cliente. Sin resultado marcado, Enter cae al submit. Es la misma regla que ya usa el walk-in.

### FR-004 — Un solo buscador de productos

Nace `product-search-box.tsx`, que exporta **un hook y un input**:

- `useProductSearch({ products, storageKey, onPick })` — el texto, el filtrado por nombre, el filtro de la web (FR-005) y el índice de teclado (↓/↑/Enter, sobre `moveSelection`/`resetSelection`).
- `ProductSearchInput({ api, inputRef?, autoFocus? })` — el input, su botón de limpiar y los chips del filtro.

Lo usan las tres superficies de carga: **mesa** (`pedir-client`, en sus dos vistas), **cargar pedido** y **venta rápida**. Cada una pinta los resultados con `ProductResultsList` donde su layout quiera, y conserva **su propio** navegador de catálogo por categoría (son distintos a propósito: la mesa tiene tabs + menú del día, las otras un selector simple).

**Por qué hook + input y no un componente que envuelva todo:** en las tres pantallas el buscador vive en un header fijo y los resultados en el área que scrollea. Un componente que renderizara ambos tendría que pelearse con tres layouts distintos, o forzarlos a uno solo. El `inputRef` es opcional para los callers que devuelven el foco al buscador tras agregar un producto.

### FR-005 — Filtro de la carta online

El buscador suma un filtro de tres posiciones sobre `products.show_online`:

| Opción | Qué muestra | Explicación al pie |
|---|---|---|
| **Todos** (default) | todo lo que ya pasó el filtro duro | — |
| **En la carta online** | `show_online = true` | *"Solo lo que el cliente ve y puede pedir desde la carta online."* |
| **Solo para el local** | `show_online = false` | *"Solo lo que NO se publica en la carta online: se carga únicamente desde acá."* |

**El vocabulario es el del form del producto, no uno nuevo** (fast-follow 2026-07-30 — *"no se entiende lo de va a la Web y no va, yo los renombraria"*). El form ya dice «Mostrar en la carta online» y explica que al desmarcarlo *"el producto desaparece de la carta que ve el cliente pero el mozo lo sigue teniendo para cargar en la mesa"*. Las etiquetas describen **al producto** ("está en la carta online" / "es solo para el local"), no al flag; «va a la web» no le decía nada a quien está cargando un pedido.

La explicación al pie aparece **sólo con un filtro puesto**: con «Todos» no hay nada que aclarar y sería ruido permanente en un header ya apretado.

- Es **aparte** del filtro hardcodeado de `getCatalogForMozo` (`is_active` + `is_available`), que **se conserva tal cual**: eso es "el producto existe y hoy se puede vender", y no es negociable desde la UI.
- Se guarda **por máquina + negocio** (`useStickyFilter`, [spec 065](../065-filtros-salon-y-catalogo/)), con clave por superficie: la PC que carga deliveries puede quedar fijada en «En la carta online» sin afectar a la comandera del salón.
- Sólo se muestra si el negocio **tiene** productos de los dos tipos: un catálogo entero visible online no necesita el control.

`CatalogProduct` y `getCatalogForMozo` suman `show_online`. Sin migración: la columna existe (`boolean not null default true`).

### FR-006 — Nada de esto cambia qué se puede vender

Es unificación y filtrado de **presentación**. No cambia permisos, ni el contrato de `sentarWalkIn` / `crearReserva` / la carga de pedido, ni qué productos son vendibles: el filtro duro sigue siendo el del server.

## Decisiones

**D1 — El buscador se comparte; el navegador de catálogo no.** Las tres superficies buscan igual pero **navegan** distinto (la mesa tiene tabs de categoría + menú del día + "top productos"; venta rápida un selector plano). Forzar un solo navegador sería un merge de tres UIs distintas por el gusto de compartir. Se comparte lo que es idéntico y demostró duplicarse mal (filtrado + teclado + input + resultados + filtro de la web).

**D2 — `CustomerFields` es controlado pero se guarda solo lo suyo.** `name` y `phone` los tiene el caller porque ya los tiene (RHF en el walk-in, `useState` en los otros dos). Lo que sí vive adentro es **qué cliente está elegido**, porque es el estado del que depende la regla del teléfono y ningún caller lo necesita para otra cosa — salvo «Cargar pedido», que además usa el id para traer las direcciones guardadas, y por eso `onPick` entrega el cliente entero.

**D3 — Tres posiciones, no un checkbox.** "Solo para el local" es una consulta real ("¿qué tengo sin publicar?"), no sólo el complemento. Con un checkbox habría que elegir cuál de las dos preguntas se puede hacer.

**D4 — El filtro se persiste por superficie, no globalmente.** El puesto que carga deliveries y el que toma pedidos en el salón quieren cosas distintas, y en el mismo negocio pueden ser dos máquinas.

**D5 — El foco gana sobre los atajos numéricos.** Documentado en FR-002. El pedido de Juan es explícito y el caso "escribir el nombre de quien se sienta" es más frecuente que "fijar 7 personas con el teclado"; el quick-pick de 1-6 sigue a un toque.

## Alcance

**Toca:**
- `src/lib/mozo/catalog-query.ts` — `show_online` en `CatalogProduct` + el select.
- `src/components/shared/customer-fields.tsx` **(nuevo)** — FR-001.
- `src/components/mozo/product-search-box.tsx` **(nuevo)** — `useProductSearch` + `ProductSearchInput`, FR-004/005.
- `src/components/mozo/walk-in-modal.tsx` — usa `CustomerFields`, foco en cliente.
- `src/components/admin/local/new-reservation-modal.tsx` — usa `CustomerFields`, foco en cliente, Enter crea.
- `src/components/admin/cargar-pedido-sheet.tsx` — usa `CustomerFields` y `ProductSearchBox`.
- `src/components/admin/local/venta-rapida-panel.tsx` y `src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx` — usan `ProductSearchBox`.

**No toca:** migraciones, `buscarClientes`, `sentarWalkIn`, el filtro duro de `getCatalogForMozo`, los navegadores de catálogo por categoría de cada superficie.
