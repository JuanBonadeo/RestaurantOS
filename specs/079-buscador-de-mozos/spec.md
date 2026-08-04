# Feature Specification: Buscador de mozos al transferir una mesa

**Feature Branch**: `079-buscador-de-mozos`

**Created**: 2026-08-04

**Status**: ✅ Implementada (2026-08-04). `pnpm typecheck` limpio, `pnpm test` con 1249 unit en verde (los 16 `*.integration.test.ts` fallan por el stack local apagado, ruido conocido), lint y prettier limpios en los archivos de la spec. Sin migración. **Pendiente:** verify en vivo con el rol real (encargado) — el modal está detrás del login. Issue [#121](https://github.com/gachetponzellini/RestaurantOS-app/issues/121). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-08-04 — *"a la hora de reasignar un mozo, poné un buscador de mozos simple"*.

## Contexto y problema

Reasignar el mozo de una mesa se hace desde el `⋯` de la mesa → **Transferir mozo**, que abre [`transfer-table-modal.tsx`](../../src/components/mozo/transfer-table-modal.tsx). El modal es el mismo en las dos superficies que lo montan: `/admin/operacion → Mesas` ([`salon-desktop.tsx`](../../src/components/admin/local/salon-desktop.tsx)) y la app del mozo full-screen ([`mozo-client.tsx`](../../src/app/[business_slug]/mozo/mozo-client.tsx)).

La lista «Pasar a» son **todos** los miembros que operan salón — `getMozosByBusiness` trae `admin`, `encargado` y `mozo` —, sin filtro y en un contenedor de `max-h-64`. Con el equipo real de golf-house eso es scrollear a ciegas buscando un nombre, en hora pico y con el dedo. El resto de la operación ya resolvió esto en todos lados donde una lista se hace larga (productos, clientes, empleados, insumos): un input arriba que filtra. Acá falta.

## Alcance

**Entra:** la lista «Pasar a» del modal Transferir mozo.

**Fuera de alcance:**

- La paleta **Distribuir mozos** ([`asignar-mozos-panel.tsx`](../../src/components/mozo/asignar-mozos-panel.tsx) y el overlay legacy del mozo mobile). Ahí el objetivo es **ver a todos a la vez** con su contador de mesas para repartir el salón: esconder la mitad de la lista detrás de una búsqueda juega en contra de para qué existe la pantalla.
- Cambiar **quién** aparece como destino (siguen siendo todos los miembros de salón menos el actual), el motivo opcional, la server action `transferTable`, permisos y notificaciones: cero cambios.
- Sin migración.

## Requisitos

### FR-001 — Buscador arriba de la lista

Un input de texto sobre la lista «Pasar a», con ícono de lupa, `placeholder` «Buscar mozo…», `aria-label` «Buscar mozo» y botón de limpiar cuando tiene texto — el mismo lenguaje que el buscador de productos del mozo ([`product-search-box.tsx`](../../src/components/mozo/product-search-box.tsx)).

Filtra por **nombre**, sin distinguir mayúsculas ni acentos («ROMAN» y «Román» encuentran a Román), y por **palabras sueltas en cualquier orden**: `perez juan` encuentra a «Juan Pérez». No filtra por rol — el rol se ve en la fila, pero tipear «mozo» no es una búsqueda, es un filtro distinto y acá no hace falta.

**No** se enfoca solo al abrir el modal: en el teléfono del mozo eso levanta el teclado y se come la lista, que es justo lo que venís a mirar.

### FR-002 — Solo cuando la lista es larga

El buscador aparece a partir de **7 candidatos**. Con un equipo chico (House) entran todos en pantalla y el input sería ruido que empuja la lista hacia abajo; con el equipo grande (Golf) es la diferencia entre tipear dos letras y scrollear.

### FR-003 — Solo se transfiere a quien está viendo

La selección vale **únicamente si está en la lista visible**. Si elegís a Juan y después buscás «ana», el destino queda vacío y el CTA se deshabilita; si borrás la búsqueda, Juan vuelve a estar seleccionado.

Es la parte no obvia: sin esto, filtrar deja al modal diciendo «Transferir mozo» con un destino elegido que ya no se ve en pantalla — el error se comete sin verlo, y transferir una mesa manda notificación al mozo destino. La selección es derivada, no un `useEffect` que la borre: nada se pierde al filtrar, solo deja de contar mientras no se ve.

### FR-004 — Sin resultados se dice

Si la búsqueda no encuentra a nadie, en lugar de la lista va un mensaje corto («Ningún mozo coincide con la búsqueda»), no un vacío mudo. La lista sin candidatos —mesa sin otros mozos posibles— sigue mostrando el mensaje que ya tiene («No hay otros mozos disponibles»).

## Criterios de aceptación

1. Mesa con 10+ miembros de salón → `⋯` → Transferir mozo → hay buscador; tipear «per» deja solo a los Pérez; tocar uno y confirmar transfiere a ese.
2. Negocio con 4 miembros → el modal se ve igual que antes, sin buscador.
3. Elegir un mozo, después tipear algo que no lo incluya → el botón queda deshabilitado; borrar la búsqueda → vuelve a estar elegido y el botón habilitado.
4. Búsqueda sin resultados → mensaje, no lista vacía.
5. Acentos y orden de palabras: «roman» encuentra «Román»; «perez juan» encuentra «Juan Pérez».
