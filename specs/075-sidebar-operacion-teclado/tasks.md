# Tasks — 075 · El sidebar de la operación se maneja entero con las flechas

Issue [#112](https://github.com/gachetponzellini/RestaurantOS-app/issues/112). Ver [`spec.md`](spec.md).

Tres fases que pueden entrar por separado: **P1** es lo que hoy tiene cero teclado, **P2** el modo más usado, **P3** la plata y la ayuda.

## Primitivas (TDD — primero el test)

- [x] T1 · `src/lib/ui/roving.ts` **(nuevo)** + `roving.test.ts` — FR-001. `nextIndex(index, delta, length)` devuelve `{kind:"index"}` o `{kind:"exit", edge:"up"|"down"}` (el borde **no** clampea: avisa para el handoff); `gridNextIndex(index, key, length, columns)` para la grilla 2-D; `indexFromDigit(key, length)`. Se apoya en `clampIndex` de [`product-search.ts`](../../src/lib/mozo/product-search.ts). Casos: lista vacía, un solo elemento, salida por arriba y por abajo, última fila incompleta de la grilla, dígito fuera de rango.
- [x] T2 · Mover `optionIndexFromKey` de `daily-menu-steps.ts` a `roving.ts` como `indexFromDigit` y reimportar en `daily-menu-wizard.tsx`. Los tests existentes de `daily-menu-steps.test.ts` que lo cubren se mudan con él.
- [x] T3 · `src/lib/ui/use-roving-list.ts` **(nuevo)** — FR-002/005. Foco real, `tabIndex` roving (0 en el activo, -1 en el resto), `scrollIntoView({block:"nearest"})`, `aria-current`, callbacks `onExitUp`/`onExitDown`. Patrón del efecto de foco de [`daily-menu-wizard.tsx:101`](../../src/components/mozo/daily-menu-wizard.tsx).
- [x] T4 · Volver a la fila de origen (FR-003). **No** por elemento: abrir un modo desmonta la lista entera, así que el `document.activeElement` guardado ya no está en el DOM cuando hay que devolver el foco. Se recuerda la **clave de la fila** (`mesa:<id>`) y se re-enfoca con `focusIndex` cuando la lista vuelve. (Se descartó `use-return-focus.ts` por eso.)

## P1 · Lista + detalle + contrato de Esc/foco

- [x] T5 · `salon-desktop.tsx` — `DemorasPanel` y `ActiveTablesList`/`ActiveTableRow` como zonas encadenadas (FR-006/007). Fila activa con ring + `aria-current`; sin `focus()` automático al entrar al panel.
- [x] T6 · `reservations-panel.tsx` — misma zona, encadenada entre Demoras y Mesas (FR-006).
- [x] T7 · `salon-desktop.tsx` · `TableDetail` — zona sobre los controles del detalle vía `useArrowFocus` (FR-008); el `⋯` se abre con Enter y ya trae sus flechas. Conserva el autofocus de la primaria de la spec 066.
- [x] T8 · `salon-desktop.tsx` — cadena de modos con `Esc`/`Backspace` en `cerrarModoActual` (FR-004), con guarda para no robarle el Esc a un modal abierto adentro del panel. Un solo lugar decide qué modo cierra cada Esc, por prioridad: cobro → cuenta → pedir/walk-in/venta rápida → detalle → deselect.
- [x] T9 · Test de componente: `↑`/`↓` recorren las tres secciones de la lista de punta a punta; `Enter` abre el detalle; `Esc` vuelve **con el foco en la fila de origen**.

## P2 · Cargar pedido, venta rápida y walk-in

- [x] T10 · `product-results-list.tsx` — de resaltado virtual (`selectedProductId`) a lista roving con foco real (FR-002/005). Mantener la firma para los tres callers.
- [x] T11 · `product-search-box.tsx` · `useProductSearch` — `↓` en el input entra a la lista, `↑` desde el primer resultado vuelve al input con el cursor al final (FR-010/011). El índice virtual queda sólo para el modo táctil.
- [x] T12 · `pedir-client.tsx` (rama `embedded`, líneas ~907-1127) — encadenar buscador → resultados/catálogo → carrito → enviar (FR-010).
- [x] T13 · `lib/mozo/use-cart-zone.ts` **(nuevo)** + test — línea del carrito operable: `←`/`→` y `−`/`+` cantidad, dígito la fija, `Supr` quita, `Enter` abre el editor de precio (FR-012). Lo comparten mesa, venta rápida y cargar pedido.
- [x] T14 · ~~Grilla 2-D~~ **no hacía falta**: desde la spec 073 el catálogo por categoría usa `ProductResultsList`, que ya es de una sola columna. `gridNextIndex` se escribió, quedó sin consumidor y se sacó junto con sus tests. Lo que sí se hizo: el catálogo y los menús del día son **una sola zona** con los resultados, y se filtra por el mismo criterio que `results` (antes `TabView` mostraba productos que el filtro de la carta online había sacado del índice de teclado).
- [x] T15 · «Escribir vuelve al buscador» (FR-014) — un handler compartido por las zonas de resultados/catálogo/carrito, salteando las teclas que ya tienen significado en la zona.
- [x] T16 · `venta-rapida-panel.tsx` — hereda las mismas zonas (buscador → resultados → carrito) + caja/método → Cobrar.
- [x] T17 · `walk-in-modal.tsx` · `WalkInPanel` — `↑`/`↓` entre Personas / Nombre / Notas / Abrir mesa + `Esc` al detalle (FR-016), sin tocar `+`/`−`/dígitos ni el Enter que abre.
- [x] T18 · Tests de componente (Testing Library + `userEvent.keyboard`): handoff buscador→resultados→carrito y vuelta; `→` sube la cantidad de una línea; una letra desde el carrito vuelve al buscador y la escribe.

## P3 · Cuenta, cobro y descubribilidad

- [x] T19 · `cuenta-client.tsx` (modo `embedded`) — ↑/↓ recorren los controles vía `useArrowFocus`; `Esc` al detalle lo maneja la cadena de modos del `<aside>` (FR-017).
- [x] T20 · `cobro-form.tsx` — selector de método con flechas + dígitos `1`–`9`, con el número visible en cada método (FR-018). **Toca plata → test primero** del guard: `Enter` en el selector elige y no cobra (FR-020).
- [x] T21 · El `Esc` de dos niveles y el `⌘/Ctrl+Enter` viven en `cobro-form.tsx`, no en `cobrar-desktop-client.tsx`: el estado `method` es del form, y el `stopPropagation` tiene que salir de ahí para que el `<aside>` no cierre el panel entero (FR-019/020). Además, elegir método ahora **mueve el foco** al botón de confirmar — sin eso el foco se caía al `<body>` y ni Esc ni ⌘Enter llegaban.
- [x] T22 · `src/components/admin/local/atajos-help.tsx` **(nuevo)** — panel `?` con los atajos del modo activo, `absolute` dentro del `<aside>`, cierra con `Esc`, más un botón `⌨` en el header (FR-022).
- [x] T23 · Chips `kbd` inline en acción primaria del detalle, botón de volver y estado vacío del carrito (FR-021).

## Cierre

- [ ] T24 · `pnpm typecheck` + `pnpm test` + `pnpm build` en verde. (⚠️ los `*.integration.test.ts` fallan con `fetch failed` sin el stack local levantado — ruido esperado, ajeno a esta spec.)
- [ ] T25 · **Verify en vivo con el rol real** (encargado, `/admin/operacion → Mesas`, nunca `service_role`): el recorrido completo del criterio de aceptación 1, sin tocar el mouse. Checklist de qa-brain.
- [ ] T26 · Regresión táctil del mozo full-screen (FR-023).
- [ ] T27 · Cerrar el loop: tildar estas tasks, actualizar la feature page del wiki, comentar + cerrar la issue #112, bumpear el puntero del submódulo en el brain y loggear en `wiki/log.md`.
